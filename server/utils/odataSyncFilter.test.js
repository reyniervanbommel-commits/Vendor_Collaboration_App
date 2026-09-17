'use strict';

const { compileSyncRules, compileSyncRulesChunks, firstSyncFilterChunk, parseSyncRules, recordMatchesSyncRules, normalizeSyncLayers, recordMatchesAnyLayer, compileSyncLayerChunks, MAX_ONEOF_VALUES, MAX_LAYERS } = require('./odataSyncFilter');

describe('compileSyncRules (D365-syncfilters)', () => {
  it('compileert een tekst-regel met quoting en escaping', () => {
    expect(compileSyncRules([
      { field: 'OrderVendorAccountNumber', operator: 'eq', value: "V'01", valueType: 'text' },
    ])).toBe("OrderVendorAccountNumber eq 'V''01'");
  });

  it('compileert een enum-regel met de volledige namespace-notatie', () => {
    expect(compileSyncRules([
      { field: 'PurchaseOrderStatus', operator: 'eq', value: 'Backorder', valueType: 'enum', enumType: 'PurchStatus' },
    ])).toBe("PurchaseOrderStatus eq Microsoft.Dynamics.DataEntities.PurchStatus'Backorder'");
  });

  it('compileert getal-, datum- en contains-regels en combineert met and', () => {
    const compiled = compileSyncRules([
      { field: 'LineAmount', operator: 'ge', value: '100', valueType: 'number' },
      { field: 'RequestedDeliveryDate', operator: 'ge', value: '2026-01-01', valueType: 'date' },
      { field: 'KRFOriginCreatedDateTime', operator: 'lt', value: '2026-07-01', valueType: 'date' },
      { field: 'PurchaseOrderName', operator: 'contains', value: 'staal', valueType: 'text' },
    ]);
    expect(compiled).toContain('LineAmount ge 100');
    expect(compiled).toContain('RequestedDeliveryDate ge 2026-01-01T00:00:00.000Z');
    expect(compiled).toContain('KRFOriginCreatedDateTime lt 2026-07-01T00:00:00.000Z');
    expect(compiled).toContain("contains(PurchaseOrderName,'staal')");
    expect(compiled.split(' and ')).toHaveLength(4);
  });

  it('compileert line-level regels via any()-lambda', () => {
    const compiled = compileSyncRules([
      { level: 'line', field: 'ItemNumber', operator: 'startswith', value: 'A', valueType: 'text' },
    ]);
    expect(compiled).toBe("PurchaseOrderLines/any(l: startswith(l/ItemNumber,'A'))");
  });

  it('ondersteunt notcontains en oneof', () => {
    const compiled = compileSyncRules([
      { field: 'PurchaseOrderName', operator: 'notcontains', value: 'test', valueType: 'text' },
      { field: 'OrderVendorAccountNumber', operator: 'oneof', valueType: 'text', value: ['1001', '1002'] },
    ]);
    expect(compiled).toContain("not contains(PurchaseOrderName,'test')");
    expect(compiled).toContain("(OrderVendorAccountNumber eq '1001' or OrderVendorAccountNumber eq '1002')");
  });

  it('staat meer dan 20 one-of waarden toe en chunked ze voor D365', () => {
    const values = Array.from({ length: 25 }, (_, i) => `V${String(i).padStart(6, '0')}`);
    const rules = [{
      field: 'OrderVendorAccountNumber',
      operator: 'oneof',
      valueType: 'text',
      value: values.join(', '),
    }];
    const compiled = compileSyncRules(rules);
    expect(compiled.split(' or ')).toHaveLength(25);
    const chunks = compileSyncRulesChunks(rules);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].split(' or ')).toHaveLength(20);
    expect(chunks[1].split(' or ')).toHaveLength(5);
    expect(firstSyncFilterChunk(rules)).toBe(chunks[0]);
    expect(firstSyncFilterChunk(rules).split(' or ')).toHaveLength(20);
  });

  it('weigert twee grote one-of regels tegelijk', () => {
    const values = Array.from({ length: 21 }, (_, i) => `V${i}`);
    expect(() => compileSyncRules([
      { field: 'OrderVendorAccountNumber', operator: 'oneof', valueType: 'text', value: values },
      { field: 'PurchaseOrderName', operator: 'oneof', valueType: 'text', value: values },
    ])).toThrow(/Only one "is one of" filter/);
  });

  it(`staat ${MAX_ONEOF_VALUES} one-of waarden toe`, () => {
    const values = Array.from({ length: MAX_ONEOF_VALUES }, (_, i) => `V${i}`);
    expect(() => compileSyncRules([{
      field: 'PurchaseOrderNumber',
      operator: 'oneof',
      valueType: 'text',
      value: values,
    }])).not.toThrow();
  });

  it(`weigert meer dan ${MAX_ONEOF_VALUES} one-of waarden`, () => {
    const values = Array.from({ length: MAX_ONEOF_VALUES + 1 }, (_, i) => `V${i}`);
    expect(() => compileSyncRules([{
      field: 'OrderVendorAccountNumber',
      operator: 'oneof',
      valueType: 'text',
      value: values,
    }])).toThrow(new RegExp(`maximum ${MAX_ONEOF_VALUES} values`));
  });

  it('weigert ongeldige velden, operators en enum-waarden (injectiepreventie)', () => {
    expect(() => compileSyncRules([{ field: "Status' or 1 eq 1", operator: 'eq', value: 'x', valueType: 'text' }])).toThrow();
    expect(() => compileSyncRules([{ field: 'Status', operator: 'like', value: 'x', valueType: 'text' }])).toThrow();
    expect(() => compileSyncRules([{ field: 'Status', operator: 'eq', value: "Open'--", valueType: 'enum', enumType: 'PurchStatus' }])).toThrow();
    expect(() => compileSyncRules([{ field: 'Status', operator: 'gt', value: 'Open', valueType: 'enum', enumType: 'PurchStatus' }])).toThrow();
  });

  it('geeft een lege string bij geen regels', () => {
    expect(compileSyncRules([])).toBe('');
    expect(compileSyncRules(null)).toBe('');
  });
});

describe('parseSyncRules', () => {
  it('parseert geldige JSON en valt defensief terug op een lege lijst', () => {
    expect(parseSyncRules('[{"field":"A"}]')).toEqual([{ field: 'A' }]);
    expect(parseSyncRules('geen json')).toEqual([]);
    expect(parseSyncRules('')).toEqual([]);
    expect(parseSyncRules('{"niet":"een array"}')).toEqual([]);
  });
});

describe('recordMatchesSyncRules', () => {
  const backorderRule = [{
    level: 'header',
    field: 'PurchaseOrderStatus',
    operator: 'eq',
    value: 'Backorder',
    valueType: 'enum',
    enumType: 'PurchStatus',
  }];

  it('matcht op D365-veldnaam en status-alias', () => {
    expect(recordMatchesSyncRules(backorderRule, { PurchaseOrderStatus: 'Backorder' }, [])).toBe(true);
    expect(recordMatchesSyncRules(backorderRule, { status: 'Backorder' }, [])).toBe(true);
    expect(recordMatchesSyncRules(backorderRule, { status: 'Invoiced' }, [])).toBe(false);
  });

  it('combineert meerdere regels met AND', () => {
    const rules = [
      ...backorderRule,
      { level: 'header', field: 'OrderVendorAccountNumber', operator: 'eq', value: 'V001', valueType: 'text' },
    ];
    expect(recordMatchesSyncRules(rules, { status: 'Backorder', vendorAccount: 'V001' }, [])).toBe(true);
    expect(recordMatchesSyncRules(rules, { status: 'Backorder', vendorAccount: 'V002' }, [])).toBe(false);
  });

  it('geeft true bij geen actieve regels', () => {
    expect(recordMatchesSyncRules([], { status: 'Invoiced' }, [])).toBe(true);
  });
});

describe('normalizeSyncLayers (work item #325 - sync filter layers)', () => {
  it('wrapt een legacy platte regel-array automatisch als "Layer 1"', () => {
    const rules = [{ level: 'header', field: 'PurchaseOrderStatus', operator: 'eq', value: 'Backorder', valueType: 'enum', enumType: 'PurchStatus' }];
    const result = normalizeSyncLayers(rules);
    expect(result.layers).toHaveLength(1);
    expect(result.layers[0]).toMatchObject({ id: 'layer-1', name: 'Layer 1', active: true, rules });
  });

  it('geeft lege lagen-lijst bij lege legacy-array of niets', () => {
    expect(normalizeSyncLayers([])).toEqual({ layers: [] });
    expect(normalizeSyncLayers(null)).toEqual({ layers: [] });
    expect(normalizeSyncLayers(undefined)).toEqual({ layers: [] });
  });

  it('accepteert een { layers: [...] }-payload en normaliseert velden', () => {
    const result = normalizeSyncLayers({
      layers: [
        { id: 'layer-1', name: 'Initial load', active: true, rules: [{ field: 'A' }] },
        { active: false, rules: [] },
      ],
    });
    expect(result.layers).toHaveLength(2);
    expect(result.layers[0]).toMatchObject({ id: 'layer-1', name: 'Initial load', active: true });
    expect(result.layers[1]).toMatchObject({ id: 'layer-2', name: 'Layer 2', active: false, rules: [] });
  });

  it('gooit een 400-fout bij meer dan MAX_LAYERS actieve lagen', () => {
    const layers = Array.from({ length: MAX_LAYERS + 1 }, (_, i) => ({
      id: `layer-${i + 1}`, name: `Layer ${i + 1}`, active: true, rules: [{ field: 'A' }],
    }));
    expect(() => normalizeSyncLayers({ layers })).toThrow(/Maximum/);
  });

  it('gooit een 400-fout wanneer een actieve laag geen regels heeft', () => {
    expect(() => normalizeSyncLayers({
      layers: [{ id: 'layer-1', name: 'Layer 1', active: true, rules: [] }],
    })).toThrow(/active but has no filter rules/);
  });

  it('staat een inactieve laag zonder regels toe', () => {
    const result = normalizeSyncLayers({
      layers: [{ id: 'layer-1', name: 'Layer 1', active: false, rules: [] }],
    });
    expect(result.layers).toHaveLength(1);
  });

  // Regressietest voor een bug in de route (#325): een kale array van LAAG-objecten
  // (bv. { id, name, active, rules }[]) wordt hier als de legacy platte RULES-array gelezen en
  // dus als 1 laag gewrapt (met de laag-objecten zelf als "rules" — niet als losse lagen). Callers
  // moeten daarom altijd { layers: [...] } doorgeven, nooit de kale array. Zie server/routes/data.js.
  it('wrapt een kale array van laag-objecten NIET als losse lagen (documenteert de contract-eis)', () => {
    const layerObjects = [
      { id: 'layer-1', name: 'Layer 1', active: true, rules: [{ field: 'A', operator: 'eq', value: '1', valueType: 'text' }] },
      { id: 'layer-2', name: 'Layer 2', active: true, rules: [{ field: 'B', operator: 'eq', value: '2', valueType: 'text' }] },
    ];
    const wrongResult = normalizeSyncLayers(layerObjects);
    expect(wrongResult.layers).toHaveLength(1);
    expect(wrongResult.layers[0].rules).toBe(layerObjects);

    const correctResult = normalizeSyncLayers({ layers: layerObjects });
    expect(correctResult.layers).toHaveLength(2);
  });
});

describe('recordMatchesAnyLayer (OR tussen lagen)', () => {
  const layerBackorder = {
    id: 'layer-1', name: 'Layer 1', active: true,
    rules: [{ level: 'header', field: 'PurchaseOrderStatus', operator: 'eq', value: 'Backorder', valueType: 'enum', enumType: 'PurchStatus' }],
  };
  const layerShoes = {
    id: 'layer-2', name: 'Open shoes', active: true,
    rules: [{ level: 'header', field: 'ProductCategory', operator: 'eq', value: 'Shoes', valueType: 'text' }],
  };

  it('matcht als minstens één actieve laag matcht (OR)', () => {
    expect(recordMatchesAnyLayer([layerBackorder, layerShoes], { status: 'Backorder', ProductCategory: 'Bags' }, [])).toBe(true);
    expect(recordMatchesAnyLayer([layerBackorder, layerShoes], { status: 'Invoiced', ProductCategory: 'Shoes' }, [])).toBe(true);
    expect(recordMatchesAnyLayer([layerBackorder, layerShoes], { status: 'Invoiced', ProductCategory: 'Bags' }, [])).toBe(false);
  });

  it('negeert inactieve lagen', () => {
    const inactiveShoes = { ...layerShoes, active: false };
    expect(recordMatchesAnyLayer([layerBackorder, inactiveShoes], { status: 'Invoiced', ProductCategory: 'Shoes' }, [])).toBe(false);
  });

  it('geeft true (ongefilterd) bij geen actieve lagen', () => {
    expect(recordMatchesAnyLayer([], { status: 'Invoiced' }, [])).toBe(true);
    expect(recordMatchesAnyLayer([{ ...layerBackorder, active: false }], { status: 'Invoiced' }, [])).toBe(true);
  });
});

describe('compileSyncLayerChunks (afplatting over lagen)', () => {
  it('compileert elke actieve laag apart en plakt de chunks samen', () => {
    const layers = [
      { id: 'layer-1', name: 'Layer 1', active: true, rules: [{ field: 'OrderVendorAccountNumber', operator: 'eq', value: 'V001', valueType: 'text' }] },
      { id: 'layer-2', name: 'Layer 2', active: true, rules: [{ field: 'OrderVendorAccountNumber', operator: 'eq', value: 'V002', valueType: 'text' }] },
    ];
    const chunks = compileSyncLayerChunks(layers);
    expect(chunks).toEqual([
      "OrderVendorAccountNumber eq 'V001'",
      "OrderVendorAccountNumber eq 'V002'",
    ]);
  });

  it('slaat inactieve lagen over', () => {
    const layers = [
      { id: 'layer-1', name: 'Layer 1', active: true, rules: [{ field: 'A', operator: 'eq', value: '1', valueType: 'text' }] },
      { id: 'layer-2', name: 'Layer 2', active: false, rules: [{ field: 'B', operator: 'eq', value: '2', valueType: 'text' }] },
    ];
    expect(compileSyncLayerChunks(layers)).toEqual(["A eq '1'"]);
  });

  it('geeft [\'\'] bij geen actieve lagen (ongefilterd)', () => {
    expect(compileSyncLayerChunks([])).toEqual(['']);
  });
});
