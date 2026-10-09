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
    this.rollback = vi.fn(async () => {
      if (mocks.rollbackError) throw mocks.rollbackError;
    });
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
    parent_id: null,
    last_activity_at: new Date('2026-07-13T18:00:00.000Z'),
    ...overrides,
  };
}

function defaultQueryHandler({ text, inputs }) {
  if (text.includes('STRING_SPLIT(@rootIds')) return result([]);
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
  mocks.rollbackError = null;
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

describe('RowRemarksService gesprekken', () => {
  const rootsQuery = () => mocks.queries.find(({ text }) => text.includes('r.parent_id IS NULL'));
  const repliesQuery = () => mocks.queries.find(({ text }) => text.includes('STRING_SPLIT(@rootIds'));

  function threadHandler(roots, replies) {
    return (ctx) => {
      if (ctx.text.includes('STRING_SPLIT(@rootIds')) return result(replies);
      if (ctx.text.includes('r.parent_id IS NULL')) return result(roots, [roots, [{ total: roots.length + replies.length }]]);
      return defaultQueryHandler(ctx);
    };
  }

  it('pagineert roots op last_activity_at en hangt replies eraan (oud → nieuw)', async () => {
    mocks.queryHandler = threadHandler(
      [remarkRow({ id: 41 }), remarkRow({ id: 40, body: 'Old root' })],
      [
        remarkRow({ id: 51, parent_id: 41, body: 'First reply', created_at: new Date('2026-07-13T18:01:00Z') }),
        remarkRow({ id: 52, parent_id: 41, body: 'Second reply', created_at: new Date('2026-07-13T18:02:00Z') }),
      ],
    );
    const page = await listRemarks(baseInput, employee);
    expect(rootsQuery().text).toMatch(/ORDER BY r\.last_activity_at DESC, r\.id DESC/);
    expect(repliesQuery().inputs.rootIds).toBe('41,40');
    expect(repliesQuery().text).toMatch(/ORDER BY p\.created_at ASC, p\.id ASC/);
    expect(page.items.map((i) => i.id)).toEqual([41, 40]);
    expect(page.items[0].replies.map((r) => r.body)).toEqual(['First reply', 'Second reply']);
    expect(page.items[0]).toMatchObject({ replyCount: 2, parentId: null });
    expect(page.items[1]).toMatchObject({ replies: [], replyCount: 0 });
    expect(page.total).toBe(4);
  });

  it('past het leesfilter ook op de replies-query toe', async () => {
    mocks.queryHandler = threadHandler([remarkRow({ id: 41 })], []);
    await listRemarks(baseInput, employee);
    expect(repliesQuery().text).toContain('r.visibility = @visibility');
    expect(repliesQuery().inputs.visibility).toBe('internal');
  });

  it('slaat de replies-query over zonder roots', async () => {
    mocks.queryHandler = threadHandler([], []);
    const page = await listRemarks(baseInput, employee);
    expect(repliesQuery()).toBeUndefined();
    expect(page.items).toEqual([]);
  });

  it('cursor gebruikt last_activity_at van de laatste root', async () => {
    const roots = [remarkRow({ id: 41, last_activity_at: new Date('2026-07-14T10:00:00.000Z') }), remarkRow({ id: 40 })];
    mocks.queryHandler = threadHandler(roots, []);
    const page = await listRemarks({ ...baseInput, limit: 1 }, employee);
    expect(normalizeCursor(page.nextCursor)).toEqual({ createdAt: new Date('2026-07-14T10:00:00.000Z'), id: 41 });
  });
});

describe('RowRemarksService replies', () => {
  const supplyChain = { id: 40, role: 'supply_chain' };
  const parentRow = (overrides = {}) => ({
    id: 41, parent_id: null, is_deleted: false, visibility: 'vendor', root_id: 41, root_deleted: false, ...overrides,
  });

  function replyHandler(parent) {
    return (ctx) => {
      if (ctx.text.includes('AS root_deleted')) return result(parent ? [parent] : []);
      if (ctx.text.includes('INSERT INTO dbo.tb_row_remarks')) return result([{ id: 60 }]);
      if (ctx.text.includes('SET last_activity_at')) return result([]);
      return defaultQueryHandler(ctx);
    };
  }
  const insertQuery = () => mocks.queries.find(({ text }) => text.includes('INSERT INTO dbo.tb_row_remarks'));

  it('erft de visibility van de root, ook als admin/supply_chain iets anders stuurt', async () => {
    mocks.queryHandler = replyHandler(parentRow({ visibility: 'internal' }));
    await addRemark({ ...baseInput, body: 'Re', parentId: 41, visibility: 'vendor' }, supplyChain);
    expect(insertQuery().inputs).toMatchObject({ newVisibility: 'internal', parentId: 41 });
    expect(insertQuery().transaction).toBeTruthy();
  });

  it('employee mag zonder visibility reageren (geen 400)', async () => {
    mocks.queryHandler = replyHandler(parentRow({ visibility: 'internal' }));
    await addRemark({ ...baseInput, body: 'Re', parentId: 41 }, employee);
    expect(insertQuery().inputs.newVisibility).toBe('internal');
  });

  it('reply op reply wordt aan de root gekoppeld', async () => {
    mocks.queryHandler = replyHandler(parentRow({ id: 51, parent_id: 41, root_id: 41 }));
    await addRemark({ ...baseInput, body: 'Re', parentId: 51 }, supplyChain);
    expect(insertQuery().inputs.parentId).toBe(41);
  });

  it('werkt last_activity_at van de root bij in dezelfde transactie', async () => {
    mocks.queryHandler = replyHandler(parentRow());
    await addRemark({ ...baseInput, body: 'Re', parentId: 41 }, supplyChain);
    const bump = mocks.queries.find(({ text }) => text.includes('SET last_activity_at'));
    expect(bump.inputs.rootId).toBe(41);
    expect(bump.transaction).toBe(insertQuery().transaction);
    expect(mocks.transactions[0].commit).toHaveBeenCalled();
  });

  it('onbekende/onzichtbare parent → 404 en rollback', async () => {
    mocks.queryHandler = replyHandler(null);
    await expect(addRemark({ ...baseInput, body: 'Re', parentId: 99 }, employee)).rejects.toMatchObject({ status: 404 });
    const lock = mocks.queries.find(({ text }) => text.includes('AS root_deleted'));
    expect(lock.text).toContain('p.visibility = @visibility');
    expect(lock.text).toContain('WITH (UPDLOCK, HOLDLOCK)');
    expect(insertQuery()).toBeUndefined();
    expect(mocks.transactions[0].rollback).toHaveBeenCalled();
  });

  it('verwijderde root → 409', async () => {
    mocks.queryHandler = replyHandler(parentRow({ id: 51, parent_id: 41, root_id: 41, root_deleted: true }));
    await expect(addRemark({ ...baseInput, body: 'Re', parentId: 51 }, supplyChain))
      .rejects.toMatchObject({ status: 409, message: 'Replying to a deleted remark is not allowed' });
  });

  it('geeft de oorspronkelijke fout door als rollback zelf faalt (afgebroken transactie)', async () => {
    mocks.queryHandler = (ctx) => {
      if (ctx.text.includes('AS root_deleted')) throw Object.assign(new Error('Deadlock victim'), { number: 1205 });
      return defaultQueryHandler(ctx);
    };
    mocks.rollbackError = new Error('EABORT');
    await expect(addRemark({ ...baseInput, body: 'Re', parentId: 41 }, employee)).rejects.toThrow('Deadlock victim');
  });
});

describe('RowRemarksService mentions', () => {
  const supplyChain = { id: 40, role: 'supply_chain' };
  const supplier = { id: 30, role: 'supplier', vendor_account: 'V1' };
  const TARGETS = [
    { partitionKey: 'whsl', recordKey: 'PO-1' },
    { partitionKey: 'whsl', recordKey: 'PO-2' },
    { partitionKey: 'whsl', recordKey: 'PO-3' },
  ];
  let resolveMentionTargets;

  beforeEach(() => {
    resolveMentionTargets = vi.fn().mockResolvedValue({ rows: TARGETS, orderCount: 3, vendorCount: 2 });
    setTestDependencies({
      getPool: async () => ({ request: () => new FakeRequest() }),
      getTable: async () => ({ id: 7, key: 'purchase-orders' }),
      createTransaction: (pool) => new FakeTransaction(pool),
      createRequest: (transaction) => new FakeRequest(transaction),
      resolveMentionTargets,
    });
  });

  function broadcastHandler(ctx) {
    if (ctx.text.includes('FROM OPENJSON(@targets)')) return result([{ id: 70 }]);
    return defaultQueryHandler(ctx);
  }

  it('plaatst één rij per doel-PO met één broadcast_id in één transactie', async () => {
    mocks.queryHandler = broadcastHandler;
    const mentions = [{ columnId: 11, value: 'A-1' }];
    await addRemark({ ...baseInput, body: 'Late @A-1', visibility: 'vendor', mentions }, supplyChain);
    expect(resolveMentionTargets).toHaveBeenCalledWith(expect.objectContaining({
      mentions, currentRow: { partitionKey: 'whsl', recordKey: 'PO-1' },
    }));
    const insert = mocks.queries.find(({ text }) => text.includes('FROM OPENJSON(@targets)'));
    expect(JSON.parse(insert.inputs.targets)).toEqual([
      { p: 'whsl', r: 'PO-1' }, { p: 'whsl', r: 'PO-2' }, { p: 'whsl', r: 'PO-3' },
    ]);
    expect(JSON.parse(insert.inputs.mentions)).toEqual([{ c: 11, v: 'A-1' }]);
    expect(insert.inputs.broadcastId).toMatch(/^[0-9a-f-]{36}$/);
    expect(insert.inputs.newVisibility).toBe('vendor');
    expect(insert.text).toContain('INSERT INTO dbo.tb_row_remark_mentions');
    expect(insert.transaction).toBeTruthy();
    expect(mocks.transactions[0].commit).toHaveBeenCalled();
  });

  it('volgt de schrijfregels: supply_chain zonder keuze → 400 zonder resolve', async () => {
    await expect(addRemark({ ...baseInput, body: 'x', mentions: [{ columnId: 11, value: 'A' }] }, supplyChain))
      .rejects.toMatchObject({ status: 400 });
    expect(resolveMentionTargets).not.toHaveBeenCalled();
  });

  it('replies met mentions → 400', async () => {
    await expect(addRemark({ ...baseInput, body: 'x', parentId: 41, mentions: [{ columnId: 11, value: 'A' }] }, employee))
      .rejects.toMatchObject({ status: 400, message: 'Mentions are not allowed in replies' });
  });

  it('een resolve-fout komt door zonder transactie', async () => {
    resolveMentionTargets.mockRejectedValue(Object.assign(new Error('No purchase orders found for @A'), { status: 400 }));
    await expect(addRemark({ ...baseInput, body: 'x', mentions: [{ columnId: 11, value: 'A' }] }, employee))
      .rejects.toMatchObject({ status: 400 });
    expect(mocks.transactions).toHaveLength(0);
  });

  it('verwijderen van een groepsremark verwijdert ook de andere kopieën', async () => {
    let deleteText = '';
    mocks.queryHandler = (ctx) => {
      if (ctx.text.includes('UPDATE r')) {
        deleteText = ctx.text;
        return result([{ id: 41 }], [[{ id: 41 }], [{ created_by: 12, is_deleted: true }]]);
      }
      return defaultQueryHandler(ctx);
    };
    await deleteRemark({ ...baseInput, id: 41 }, employee);
    expect(deleteText).toMatch(/WHERE broadcast_id = @groupId AND is_deleted = 0/);
    expect(deleteText.indexOf('broadcast_id = @groupId')).toBeLessThan(deleteText.indexOf('SELECT r.created_by'));
  });

  it('DTO: mentions voor iedereen, broadcastCount niet voor supplier', async () => {
    const row = remarkRow({
      visibility: 'vendor', broadcast_id: 'b1', broadcast_count: 3,
      mentions_json: '[{"value":"A-1","columnLabel":"Artikel"}]',
    });
    mocks.queryHandler = (ctx) => (ctx.text.includes('r.parent_id IS NULL')
      ? result([row], [[row], [{ total: 1 }]])
      : defaultQueryHandler(ctx));
    const forStaff = await listRemarks(baseInput, supplyChain);
    expect(forStaff.items[0]).toMatchObject({
      broadcastId: 'b1', broadcastCount: 3, mentions: [{ value: 'A-1', columnLabel: 'Artikel' }],
    });
    expect(mocks.queries.find(({ text }) => text.includes('r.parent_id IS NULL')).text).toContain('mentions_json');
  });

  it('DTO: supplier krijgt geen broadcastCount', async () => {
    const dataService = require('./TableDataService');
    const settingsService = require('./SettingsService');
    const { clearSupplierVisibleRowKeyCache } = require('../utils/supplierRowAccess');
    const originalRead = dataService.read;
    const originalGetAsync = settingsService.getAsync;
    clearSupplierVisibleRowKeyCache();
    settingsService.getAsync = vi.fn().mockResolvedValue('vendorAccount');
    dataService.read = vi.fn(async () => ({ rows: [{ partitionKey: 'whsl', recordKey: 'PO-1' }] }));
    try {
      const row = remarkRow({ visibility: 'vendor', broadcast_id: 'b1', broadcast_count: 3, mentions_json: null });
      mocks.queryHandler = (ctx) => (ctx.text.includes('r.parent_id IS NULL')
        ? result([row], [[row], [{ total: 1 }]])
        : defaultQueryHandler(ctx));
      const page = await listRemarks(baseInput, supplier);
      expect(page.items[0]).not.toHaveProperty('broadcastCount');
      expect(page.items[0]).toMatchObject({ broadcastId: 'b1', mentions: [] });
    } finally {
      dataService.read = originalRead;
      settingsService.getAsync = originalGetAsync;
    }
  });

  it('tombstone geeft geen mention-waarden terug', async () => {
    const row = remarkRow({
      is_deleted: true, deleted_at: new Date(), visibility: 'vendor', broadcast_id: 'b1', broadcast_count: 2,
      mentions_json: '[{"value":"A-1","columnLabel":"Artikel"}]',
    });
    mocks.queryHandler = (ctx) => (ctx.text.includes('r.parent_id IS NULL')
      ? result([row], [[row], [{ total: 1 }]])
      : defaultQueryHandler(ctx));
    const page = await listRemarks(baseInput, { id: 40, role: 'supply_chain' });
    expect(page.items[0].mentions).toEqual([]);
  });

  it('telt verwijderde opmerkingen niet mee in total', async () => {
    mocks.queryHandler = (ctx) => (ctx.text.includes('r.parent_id IS NULL')
      ? result([remarkRow()], [[remarkRow()], [{ total: 1 }]])
      : defaultQueryHandler(ctx));
    await listRemarks(baseInput, { id: 40, role: 'supply_chain' });
    const q = mocks.queries.find(({ text }) => text.includes('r.parent_id IS NULL'));
    expect(q.text).toMatch(/SELECT COUNT_BIG\(\*\) AS total[\s\S]*r\.is_deleted = 0/);
  });
});
