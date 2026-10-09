'use strict';

const mocks = { queries: [], queryHandler: null };

class FakeRequest {
  constructor() {
    this.inputs = {};
  }

  input(name, type, value) {
    this.inputs[name] = value;
    return this;
  }

  query(text) {
    mocks.queries.push({ text, inputs: this.inputs });
    return mocks.queryHandler({ text, inputs: this.inputs });
  }
}

const {
  resolveMentionTargets,
  setTestDependencies,
  suggestMentions,
} = require('./RemarkMentionsService');

const COLUMNS = [
  { id: 11, key: 'itemNumber', label: 'Artikel', scope: 'detail' },
  { id: 12, key: 'orderGroup', label: 'Order group', scope: 'master' },
  { id: 13, key: 'purchaseorderlinestatus', label: 'Line status', scope: 'detail' },
];
const TABLE = { id: 7, key: 'purchase-orders' };
const staff = { id: 4, role: 'supply_chain' };
const supplier = { id: 30, role: 'supplier', vendor_account: 'V1' };
const CURRENT = { partitionKey: 'whsl', recordKey: 'PO-1' };

function result(recordset = []) {
  return { recordset, recordsets: [recordset] };
}

let visibleKeys = new Set();

beforeEach(() => {
  mocks.queries.length = 0;
  mocks.queryHandler = () => result([]);
  visibleKeys = new Set();
  setTestDependencies({
    getPool: async () => ({ request: () => new FakeRequest() }),
    loadColumns: async () => COLUMNS,
    getVendorField: async () => 'vendorAccount',
    loadVisibleKeys: async () => visibleKeys,
  });
});

afterAll(() => setTestDependencies());

describe('suggestMentions', () => {
  it('geeft niets en doet geen query bij minder dan 2 tekens', async () => {
    expect(await suggestMentions({ table: TABLE, q: ' s ', actor: staff })).toEqual([]);
    expect(mocks.queries).toHaveLength(0);
  });

  it('zoekt per mentionable kolom op prefix met gebonden JSON-pad', async () => {
    mocks.queryHandler = ({ inputs }) => (inputs.jsonPath === '$.itemNumber'
      ? result([{ value: 'SFM-12542-00-01', order_count: 3 }])
      : result([]));
    const out = await suggestMentions({ table: TABLE, q: 'sfm', actor: staff });
    const detail = mocks.queries.find(({ inputs }) => inputs.jsonPath === '$.itemNumber');
    expect(detail.inputs.prefix).toBe('sfm%');
    expect(detail.text).toContain('TOP (10)');
    expect(detail.text).toContain("m.scope = 'master'");
    expect(mocks.queries.find(({ inputs }) => inputs.jsonPath === '$.orderGroup')).toBeDefined();
    expect(out).toEqual([{ columnId: 11, columnLabel: 'Artikel', value: 'SFM-12542-00-01', orderCount: 3 }]);
  });

  it('escapet LIKE-jokertekens in de zoekterm', async () => {
    await suggestMentions({ table: TABLE, q: 'A_1%', actor: staff });
    expect(mocks.queries[0].inputs.prefix).toBe('A[_]1[%]%');
  });

  it('sorteert over kolommen heen en houdt er maximaal 10', async () => {
    mocks.queryHandler = ({ inputs }) => result(
      Array.from({ length: 8 }, (_, i) => ({ value: `${inputs.jsonPath === '$.itemNumber' ? 'B' : 'A'}-${i}`, order_count: 1 })),
    );
    const out = await suggestMentions({ table: TABLE, q: 'ab', actor: staff });
    expect(out).toHaveLength(10);
    expect(out[0].value).toBe('A-0');
  });

  it('supplier: filtert op eigen zichtbare PO-sleutels in SQL', async () => {
    visibleKeys = new Set(['whsl|PO-1', 'whsl|PO-2']);
    mocks.queryHandler = ({ inputs }) => (inputs.jsonPath === '$.itemNumber'
      ? result([{ value: 'A-1', order_count: 2 }])
      : result([]));
    const out = await suggestMentions({ table: TABLE, q: 'a-', actor: supplier });
    const q = mocks.queries.find(({ inputs }) => inputs.jsonPath === '$.itemNumber');
    expect(q.text).toContain('OPENJSON(@visibleKeys)');
    expect(JSON.parse(q.inputs.visibleKeys)).toEqual([{ p: 'whsl', r: 'PO-1' }, { p: 'whsl', r: 'PO-2' }]);
    expect(out).toEqual([{ columnId: 11, columnLabel: 'Artikel', value: 'A-1', orderCount: 2 }]);
  });

  it('staff-query heeft geen supplier-filter', async () => {
    await suggestMentions({ table: TABLE, q: 'a-', actor: staff });
    expect(mocks.queries[0].text).not.toContain('@visibleKeys');
  });
});

describe('resolveMentionTargets', () => {
  const ROWS = [
    { partition_key: 'whsl', record_key: 'PO-2', vendor_value: 'V1' },
    { partition_key: 'whsl', record_key: 'PO-3', vendor_value: 'V2' },
  ];
  function handler(rows = ROWS) {
    return ({ text }) => (text.includes('AS current_vendor') ? result([{ current_vendor: 'V1' }]) : result(rows));
  }
  const targetQuery = () => mocks.queries.find(({ text }) => text.includes('SELECT DISTINCT TOP'));
  const resolve = (mentions, actor = staff) => resolveMentionTargets({ table: TABLE, mentions, actor, currentRow: CURRENT });

  it("één artikel: PO's met een regel met die waarde, plus huidige PO en vendortelling", async () => {
    mocks.queryHandler = handler();
    const out = await resolve([{ columnId: 11, value: ' A-1 ' }]);
    const q = targetQuery();
    expect(q.text).toContain('EXISTS');
    expect(q.inputs).toMatchObject({ p0: '$.itemNumber', v0_0: 'A-1', vendorPath: '$.vendorAccount' });
    expect(out.rows.map((r) => r.recordKey)).toEqual(['PO-1', 'PO-2', 'PO-3']);
    expect(out).toMatchObject({ orderCount: 3, vendorCount: 2 });
  });

  it('artikel + regelstatus: beide voorwaarden op dezelfde regel (één EXISTS)', async () => {
    mocks.queryHandler = handler();
    await resolve([{ columnId: 11, value: 'A-1' }, { columnId: 13, value: 'Open order' }]);
    const q = targetQuery();
    expect(q.text.match(/EXISTS/g)).toHaveLength(1);
    expect(q.inputs).toMatchObject({ p0: '$.itemNumber', v0_0: 'A-1', p1: '$.purchaseorderlinestatus', v1_0: 'Backorder' });
    expect(q.text).toMatch(/JSON_VALUE\(d\.data_json, @p0\)\)\) IN \(@v0_0\)[\s\S]*AND[\s\S]*JSON_VALUE\(d\.data_json, @p1\)\)\) IN \(@v1_0\)/);
  });

  it('zelfde kolom twee keer: OF (IN-lijst)', async () => {
    mocks.queryHandler = handler();
    await resolve([{ columnId: 11, value: 'A-1' }, { columnId: 11, value: 'A-2' }]);
    const q = targetQuery();
    expect(q.inputs).toMatchObject({ v0_0: 'A-1', v0_1: 'A-2' });
    expect(q.text).toContain('IN (@v0_0, @v0_1)');
    expect(q.inputs).not.toHaveProperty('p1');
  });

  it('kop- en regelkolom: kopvoorwaarde op de PO, regelvoorwaarde in EXISTS', async () => {
    mocks.queryHandler = handler();
    await resolve([{ columnId: 12, value: 'G-1' }, { columnId: 11, value: 'A-1' }]);
    const q = targetQuery();
    expect(q.text).toMatch(/JSON_VALUE\(m\.data_json, @p0\)\)\) IN \(@v0_0\)/);
    expect(q.text).toMatch(/EXISTS[\s\S]*JSON_VALUE\(d\.data_json, @p1\)\)\) IN \(@v1_0\)/);
  });

  it('alleen kopkolom: geen EXISTS', async () => {
    mocks.queryHandler = handler();
    await resolve([{ columnId: 12, value: 'G-1' }]);
    expect(targetQuery().text).not.toContain('EXISTS');
  });

  it('dubbele mention telt één keer', async () => {
    mocks.queryHandler = handler();
    await resolve([{ columnId: 11, value: 'A-1' }, { columnId: 11, value: 'A-1' }]);
    expect(targetQuery().inputs).not.toHaveProperty('v0_1');
  });

  it('onbekende of niet-mentionable kolom → 400', async () => {
    await expect(resolve([{ columnId: 99, value: 'X' }])).rejects.toMatchObject({ status: 400, message: 'This value cannot be mentioned' });
    expect(mocks.queries).toHaveLength(0);
  });

  it('geen treffers → 400 met alle waarden', async () => {
    mocks.queryHandler = handler([]);
    await expect(resolve([{ columnId: 11, value: 'A-1' }, { columnId: 13, value: 'Open order' }]))
      .rejects.toMatchObject({ status: 400, message: 'No purchase orders found for @A-1 @Open order' });
  });

  it("meer dan 200 PO's → 400", async () => {
    mocks.queryHandler = handler(Array.from({ length: 201 }, (_, i) => ({ partition_key: 'whsl', record_key: `X-${i}`, vendor_value: 'V1' })));
    await expect(resolve([{ columnId: 11, value: 'A-1' }])).rejects.toMatchObject({ status: 400, message: 'Too many purchase orders (max 200)' });
  });

  it('meer dan 5 mentions of lege waarde → 400', async () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ columnId: 11, value: `A-${i}` }));
    await expect(resolve(six)).rejects.toMatchObject({ status: 400 });
    await expect(resolve([{ columnId: 11, value: '' }])).rejects.toMatchObject({ status: 400 });
  });

  it('supplier: filter op eigen PO-sleutels in SQL, vendorCount 1', async () => {
    visibleKeys = new Set(['whsl|PO-1', 'whsl|PO-2']);
    mocks.queryHandler = handler([{ partition_key: 'whsl', record_key: 'PO-2', vendor_value: 'V1' }]);
    const out = await resolve([{ columnId: 11, value: 'A-1' }], supplier);
    expect(targetQuery().text).toContain('OPENJSON(@visibleKeys)');
    expect(out).toMatchObject({ orderCount: 2, vendorCount: 1 });
  });

  it("supplier: niets binnen eigen PO's → 400", async () => {
    visibleKeys = new Set(['whsl|PO-1']);
    mocks.queryHandler = handler([]);
    await expect(resolve([{ columnId: 11, value: 'A-1' }], supplier))
      .rejects.toMatchObject({ status: 400, message: 'No purchase orders found for @A-1' });
  });

  it('niet-bestaande huidige PO → 404', async () => {
    mocks.queryHandler = ({ text }) => (text.includes('AS current_vendor') ? result([]) : result(ROWS));
    await expect(resolve([{ columnId: 11, value: 'A-1' }])).rejects.toMatchObject({ status: 404 });
  });
});

describe('Open order (D365 Backorder)', () => {
  it('suggesties: "open" vindt Backorder en toont Open order', async () => {
    mocks.queryHandler = ({ inputs }) => (inputs.jsonPath === '$.purchaseorderlinestatus'
      ? result([{ value: 'Backorder', order_count: 40 }])
      : result([]));
    const out = await suggestMentions({ table: TABLE, q: 'open', actor: staff });
    const q = mocks.queries.find(({ inputs }) => inputs.jsonPath === '$.purchaseorderlinestatus');
    expect(q.inputs.aliasValue).toBe('Backorder');
    expect(q.text).toContain('= @aliasValue');
    expect(out).toEqual([{ columnId: 13, columnLabel: 'Line status', value: 'Open order', orderCount: 40 }]);
  });

  it('suggesties zonder alias-match hebben geen aliasValue', async () => {
    await suggestMentions({ table: TABLE, q: 'sfm', actor: staff });
    expect(mocks.queries[0].inputs.aliasValue).toBeNull();
  });

  it('resolve zoekt Open order als Backorder', async () => {
    mocks.queryHandler = ({ text }) => (text.includes('AS current_vendor')
      ? result([{ current_vendor: 'V1' }])
      : result([{ partition_key: 'whsl', record_key: 'PO-2', vendor_value: 'V1' }]));
    await resolveMentionTargets({
      table: TABLE, mentions: [{ columnId: 13, value: 'Open order' }], actor: staff, currentRow: CURRENT,
    });
    const q = mocks.queries.find(({ text }) => text.includes('SELECT DISTINCT TOP'));
    expect(q.inputs.v0_0).toBe('Backorder');
  });
});
