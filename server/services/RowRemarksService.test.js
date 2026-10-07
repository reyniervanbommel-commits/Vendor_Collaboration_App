'use strict';

const mocks = {
  queries: [],
  transactions: [],
  reactionKeys: new Set(),
  queryHandler: null,
};

class FakeRequest {
  constructor(transaction = null) {
    this.transaction = transaction;
    this.inputs = {};
  }

  input(name, type, value) {
    this.inputs[name] = value;
    return this;
  }

  query(text) {
    mocks.queries.push({ text, inputs: this.inputs, transaction: this.transaction });
    return mocks.queryHandler({ text, inputs: this.inputs, transaction: this.transaction });
  }
}

class FakeTransaction {
  constructor(pool) {
    this.pool = pool;
    this.begin = vi.fn(async () => {});
    this.commit = vi.fn(async () => {});
    this.rollback = vi.fn(async () => {});
    mocks.transactions.push(this);
  }
}

const {
  addRemark,
  deleteRemark,
  listRemarks,
  setReaction,
  setTestDependencies,
  summarizeRemarks,
} = require('./RowRemarksService');
const dataService = require('./TableDataService');
const settingsService = require('./SettingsService');
const { clearSupplierVisibleRowKeyCache } = require('../utils/supplierRowAccess');
const {
  encodeCursor,
  normalizeBody,
  normalizeCursor,
  normalizeEmoji,
} = require('./RowRemarksValidation');

const employee = { id: 12, role: 'employee' };
const admin = { id: 99, role: 'admin' };
const baseInput = { tableKey: 'purchase-orders', partitionKey: 'whsl', recordKey: 'PO-1' };

function result(recordset = [], recordsets = null) {
  return { recordset, recordsets: recordsets || [recordset] };
}

function remarkRow(overrides = {}) {
  return {
    id: 41,
    partition_key: 'whsl',
    record_key: 'PO-1',
    column_id: null,
    body: 'Server remark',
    created_by: 12,
    created_at: new Date('2026-07-13T18:00:00.000Z'),
    is_deleted: false,
    deleted_at: null,
    author_name: 'Employee',
    column_key: null,
    column_label: null,
    emoji: null,
    reaction_count: null,
    reacted_by_current_user: null,
    ...overrides,
  };
}

function defaultQueryHandler({ text, inputs }) {
  if (text.includes('SELECT TOP (1) 1 AS found')) return result([{ found: 1 }]);
  if (text.includes('INSERT INTO dbo.tb_row_remarks')) return result([{ id: 41 }]);
  if (text.includes('UPDATE r') && text.includes('deleted_at')) {
    return result([{ id: 41 }], [[{ id: 41 }], [{ created_by: 12, is_deleted: false }]]);
  }
  if (text.includes('WITH paged') && text.includes('r.id = @remarkId')) {
    return result([remarkRow({ id: inputs.remarkId })]);
  }
  if (text.includes('WITH paged')) {
    const rows = [remarkRow(), remarkRow({ emoji: '👍', reaction_count: 2 })];
    return result(rows, [rows, [{ total: 1 }]]);
  }
  if (text.includes('WITH (UPDLOCK, HOLDLOCK)') && text.includes('r.created_by')) {
    return result([{ created_by: 88, is_deleted: false }]);
  }
  if (text.includes('tb_row_remark_reactions')) {
    const key = `${inputs.remarkId}:${inputs.actorId}:${inputs.emoji}`;
    if (inputs.active) mocks.reactionKeys.add(key);
    else mocks.reactionKeys.delete(key);
    return result([]);
  }
  throw new Error(`Onverwachte testquery: ${text.slice(0, 80)}`);
}

beforeEach(() => {
  mocks.queries.length = 0;
  mocks.transactions.length = 0;
  mocks.reactionKeys.clear();
  mocks.queryHandler = defaultQueryHandler;
  setTestDependencies({
    getPool: async () => ({ request: () => new FakeRequest() }),
    getTable: async () => ({ id: 7, key: 'purchase-orders' }),
    createTransaction: (pool) => new FakeTransaction(pool),
    createRequest: (transaction) => new FakeRequest(transaction),
  });
});

describe('RowRemarksService validatie', () => {
  it('normaliseert NFC en trimt terwijl newline en tab geldig blijven', () => {
    expect(normalizeBody('  e\u0301\n\tregel  ')).toBe('é\n\tregel');
  });

  it('weigert controltekens, te lange tekst en emoji buiten de whitelist', () => {
    expect(() => normalizeBody('tekst\u0000')).toThrow();
    expect(() => normalizeBody('x'.repeat(2001))).toThrow();
    expect(() => normalizeEmoji('🔥')).toThrow();
  });

  it('maakt een opaque cursor en weigert manipulatie', () => {
    const cursor = encodeCursor({ id: 41, created_at: new Date('2026-07-13T18:00:00.000Z') });
    expect(normalizeCursor(cursor)).toEqual({
      id: 41,
      createdAt: new Date('2026-07-13T18:00:00.000Z'),
    });
    expect(() => normalizeCursor('geen-cursor')).toThrow();
  });
});

describe('RowRemarksService reads en writes', () => {
  it('lijst remarks newest-first met tombstoneveilig shape en cursorbinding', async () => {
    const response = await listRemarks({ ...baseInput, limit: 50 }, employee);
    expect(response.total).toBe(1);
    expect(response.items[0]).toMatchObject({
      id: 41,
      body: 'Server remark',
      canDelete: true,
      reactions: [{ emoji: '👍', count: 2, reactedByCurrentUser: false }],
    });
    expect(mocks.queries.some(({ inputs }) => (
      inputs.tableId === 7 && inputs.partitionKey === 'whsl' && inputs.recordKey === 'PO-1'
    ))).toBe(true);
  });

  it('bindt add aan masterrij, tabel en actieve masterkolom', async () => {
    const added = await addRemark({ ...baseInput, body: '  hallo  ', columnId: 5 }, employee);
    expect(added.body).toBe('Server remark');
    const insert = mocks.queries.find(({ text }) => text.includes('INSERT INTO dbo.tb_row_remarks'));
    expect(insert.inputs).toMatchObject({
      tableId: 7,
      partitionKey: 'whsl',
      recordKey: 'PO-1',
      actorId: 12,
      columnId: 5,
      body: 'hallo',
    });
    expect(insert.text).toMatch(/c\.table_id = @tableId[\s\S]+c\.scope = 'master'[\s\S]+c\.is_active = 1/);
  });

  it('geeft 404 als rij of kolom niet bij de tabel hoort', async () => {
    mocks.queryHandler = ({ text }) => (
      text.includes('INSERT INTO dbo.tb_row_remarks') ? result([]) : defaultQueryHandler({ text, inputs: {} })
    );
    await expect(addRemark({ ...baseInput, body: 'hallo', columnId: 999 }, employee))
      .rejects.toMatchObject({ status: 404 });
  });

  it('weigert cross-row IDOR en verwijderen zonder ownership', async () => {
    mocks.queryHandler = ({ text }) => {
      if (text.includes('SELECT TOP (1) 1 AS found')) return result([{ found: 1 }]);
      if (text.includes('UPDATE r')) return result([], [[], []]);
      return defaultQueryHandler({ text, inputs: {} });
    };
    await expect(deleteRemark({ ...baseInput, id: 41 }, employee))
      .rejects.toMatchObject({ status: 404 });

    mocks.queryHandler = ({ text }) => {
      if (text.includes('SELECT TOP (1) 1 AS found')) return result([{ found: 1 }]);
      if (text.includes('UPDATE r')) {
        return result([], [[], [{ created_by: 88, is_deleted: false }]]);
      }
      return defaultQueryHandler({ text, inputs: {} });
    };
    await expect(deleteRemark({ ...baseInput, id: 41 }, employee))
      .rejects.toMatchObject({ status: 403 });
  });

  it('staat admin-delete toe en gebruikt uitsluitend server-side deletevelden', async () => {
    const deleted = await deleteRemark({ ...baseInput, id: 41 }, admin);
    expect(deleted.id).toBe(41);
    const update = mocks.queries.find(({ text }) => text.includes('UPDATE r'));
    expect(update.inputs).toMatchObject({ actorId: 99, isAdmin: 1 });
    expect(update.text).toMatch(/deleted_at = SYSUTCDATETIME\(\)/);
  });
});

describe('RowRemarksService reactions', () => {
  it('is atomair en idempotent bij herhaalde active=true requests', async () => {
    await setReaction({ ...baseInput, id: 41, emoji: '👍', active: true }, employee);
    await setReaction({ ...baseInput, id: 41, emoji: '👍', active: true }, employee);
    expect(mocks.reactionKeys.size).toBe(1);
    expect(mocks.transactions).toHaveLength(2);
    for (const transaction of mocks.transactions) {
      expect(transaction.begin).toHaveBeenCalledOnce();
      expect(transaction.commit).toHaveBeenCalledOnce();
      expect(transaction.rollback).not.toHaveBeenCalled();
    }
    const write = mocks.queries.find(({ text }) => text.includes('IF NOT EXISTS'));
    expect(write.text).toMatch(/UPDLOCK, HOLDLOCK/);
  });

  it('weigert reageren op de eigen remark en rolt de transactie terug', async () => {
    mocks.queryHandler = ({ text }) => {
      if (text.includes('r.created_by')) return result([{ created_by: 12, is_deleted: false }]);
      return defaultQueryHandler({ text, inputs: {} });
    };
    await expect(setReaction({ ...baseInput, id: 41, emoji: '😊', active: true }, employee))
      .rejects.toMatchObject({ status: 403 });
    expect(mocks.transactions[0].rollback).toHaveBeenCalledOnce();
  });
});

describe('RowRemarksService zichtbaarheid', () => {
  const supplier = { id: 30, role: 'supplier', email: 'v@x.nl', vendor_account: 'V001' };
  const supplyChain = { id: 40, role: 'supply_chain' };
  const originalRead = dataService.read;
  const originalGetAsync = settingsService.getAsync;

  beforeEach(() => {
    clearSupplierVisibleRowKeyCache?.();
    settingsService.getAsync = vi.fn().mockResolvedValue('vendorAccount');
    dataService.read = vi.fn(async () => ({
      rows: [{ partitionKey: 'whsl', recordKey: 'PO-1', values: { vendorAccount: 'V001' } }],
    }));
  });

  afterEach(() => {
    dataService.read = originalRead;
    settingsService.getAsync = originalGetAsync;
  });

  const listQuery = () => mocks.queries.find(({ text }) => text.includes('WITH paged') && text.includes('COUNT_BIG'));

  it.each([
    ['employee', employee, 'internal'],
    ['supplier', supplier, 'vendor'],
  ])('listRemarks filtert lijst én total voor %s', async (_label, actor, expected) => {
    await listRemarks(baseInput, actor);
    const q = listQuery();
    expect(q.inputs.visibility).toBe(expected);
    expect(q.text.match(/r\.visibility = @visibility/g)).toHaveLength(2);
  });

  it.each([
    ['admin', admin],
    ['supply_chain', supplyChain],
  ])('listRemarks zonder filter voor %s', async (_label, actor) => {
    await listRemarks(baseInput, actor);
    expect(listQuery().text).not.toContain('@visibility');
    expect(listQuery().inputs).not.toHaveProperty('visibility');
  });

  it('addRemark: employee schrijft internal ondanks meegestuurd vendor', async () => {
    await addRemark({ ...baseInput, body: 'x', visibility: 'vendor' }, employee);
    const insert = mocks.queries.find(({ text }) => text.includes('INSERT INTO dbo.tb_row_remarks'));
    expect(insert.inputs.newVisibility).toBe('internal');
    expect(insert.text).toContain('@newVisibility');
  });

  it('addRemark: supplier schrijft vendor ondanks meegestuurd internal', async () => {
    await addRemark({ ...baseInput, body: 'x', visibility: 'internal' }, supplier);
    const insert = mocks.queries.find(({ text }) => text.includes('INSERT INTO dbo.tb_row_remarks'));
    expect(insert.inputs.newVisibility).toBe('vendor');
  });

  it('addRemark: supply_chain zonder keuze → 400 en geen insert', async () => {
    await expect(addRemark({ ...baseInput, body: 'x' }, supplyChain)).rejects.toMatchObject({ status: 400 });
    expect(mocks.queries.some(({ text }) => text.includes('INSERT INTO'))).toBe(false);
  });

  it('addRemark: supply_chain kiest internal en krijgt visibility in de DTO', async () => {
    mocks.queryHandler = (ctx) => (ctx.text.includes('r.id = @remarkId')
      ? result([remarkRow({ id: ctx.inputs.remarkId, created_by: 40, visibility: 'internal', author_role: 'supply_chain' })])
      : defaultQueryHandler(ctx));
    const remark = await addRemark({ ...baseInput, body: 'x', visibility: 'internal' }, supplyChain);
    const insert = mocks.queries.find(({ text }) => text.includes('INSERT INTO dbo.tb_row_remarks'));
    expect(insert.inputs.newVisibility).toBe('internal');
    expect(remark).toMatchObject({ visibility: 'internal', fromVendor: false });
  });

  it('DTO markeert vendor-auteur voor admin', async () => {
    mocks.queryHandler = (ctx) => {
      if (ctx.text.includes('WITH paged') && !ctx.text.includes('r.id = @remarkId')) {
        const rows = [remarkRow({ visibility: 'vendor', author_role: 'supplier' })];
        return result(rows, [rows, [{ total: 1 }]]);
      }
      return defaultQueryHandler(ctx);
    };
    const page = await listRemarks(baseInput, admin);
    expect(page.items[0]).toMatchObject({ visibility: 'vendor', fromVendor: true });
  });

  it('DTO verbergt visibility voor employee en supplier', async () => {
    const forEmployee = await listRemarks(baseInput, employee);
    expect(forEmployee.items[0]).not.toHaveProperty('visibility');
    expect(forEmployee.items[0]).not.toHaveProperty('fromVendor');
    const forSupplier = await listRemarks(baseInput, supplier);
    expect(forSupplier.items[0]).not.toHaveProperty('visibility');
  });

  it('setReaction op onzichtbare remark → 404', async () => {
    let lockText = '';
    mocks.queryHandler = (ctx) => {
      if (ctx.text.includes('WITH (UPDLOCK, HOLDLOCK)') && ctx.text.includes('r.created_by')) {
        lockText = ctx.text;
        return result([]);
      }
      return defaultQueryHandler(ctx);
    };
    await expect(setReaction({ ...baseInput, id: 41, emoji: '👍', active: true }, employee))
      .rejects.toMatchObject({ status: 404 });
    expect(lockText).toContain('r.visibility = @visibility');
  });

  it('deleteRemark op onzichtbare remark → 404', async () => {
    let updateText = '';
    mocks.queryHandler = (ctx) => {
      if (ctx.text.includes('UPDATE r')) {
        updateText = ctx.text;
        return result([], [[], []]);
      }
      return defaultQueryHandler(ctx);
    };
    await expect(deleteRemark({ ...baseInput, id: 41 }, employee)).rejects.toMatchObject({ status: 404 });
    expect(updateText.match(/r\.visibility = @visibility/g)).toHaveLength(2);
  });

  it('summarizeRemarks telt en kiest latest binnen het filter (employee)', async () => {
    let summary = null;
    mocks.queryHandler = (ctx) => {
      summary = ctx;
      return result([{ partition_key: 'whsl', record_key: 'PO-1', remark_count: 1, id: 41, body: 'b', author_name: 'A', created_at: new Date(), visibility: 'internal' }]);
    };
    const rows = await summarizeRemarks('purchase-orders', employee);
    expect(summary.inputs.visibility).toBe('internal');
    expect(summary.text.match(/r\.visibility = @visibility/g)).toHaveLength(2);
    expect(rows[0].latest).not.toHaveProperty('visibility');
  });

  it('summarizeRemarks geeft latest.visibility aan supply_chain, zonder filter', async () => {
    let summary = null;
    mocks.queryHandler = (ctx) => {
      summary = ctx;
      return result([{ partition_key: 'whsl', record_key: 'PO-1', remark_count: 1, id: 41, body: 'b', author_name: 'A', created_at: new Date(), visibility: 'internal' }]);
    };
    const rows = await summarizeRemarks('purchase-orders', supplyChain);
    expect(summary.text).not.toContain('@visibility');
    expect(rows[0].latest.visibility).toBe('internal');
  });
});
