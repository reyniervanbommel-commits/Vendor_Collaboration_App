'use strict';

const {
  computeContentHash,
  computeChangedFieldKeys,
  buildHistoryByCell,
  dedupeDetailRows,
  addLookupColumnsByScope,
  applyLookups,
  fillEmptyNumberFromFallback,
  normalizeExclusionRows,
  computeRevision,
  resolveConfiguredMaxItems,
  requiredMasterFieldsFromTable,
  compileMasterFormulaColumns,
  compileFormulaColumns,
  applyFormulaColumnsToRowValues,
  recalculateMasterRowFormulas,
  resolveSourceColumnValue,
  resolveRecordKeys,
  buildLookupCacheKey,
  buildDetailLookupSourceValues,
  detailMatchesItemsFilter,
  enrichLookupSourceFromCacheRow,
  usesMasterRecordKeysForInheritedLookup,
  calculateLinkedLineTotal,
  buildDetailRollup,
  toAdminColumn,
  applyRuntimeLinkedHeaderValues,
  assertCustomColumnWritable,
  buildLookupFieldMap,
  buildSyntheticLookupColumn,
  buildD365ChangeState,
  buildD365LedgerEntries,
  buildLedgerInsert,
  resolveLookupSourceKey,
  resolveLookupTargetSourceField,
  resolveLookupProjectionColumns,
  buildLookupDedupeSignature,
  buildLookupTargetAliases,
  combineODataFilters,
  buildOneOfFilterClause,
  fieldsProjectionEnabled,
  FETCH_ADAPTERS,
} = require('./TableDataService');

describe('TableDataService.computeContentHash', () => {
  const masterJson = JSON.stringify({ vendorAccount: 'Q000104', status: 'Open' });
  const detail1 = JSON.stringify({ lineNumber: 1, itemNumber: 'ART-1', quantity: 10 });
  const detail2 = JSON.stringify({ lineNumber: 2, itemNumber: 'ART-2', quantity: 5 });

  it('is deterministisch voor dezelfde inhoud', () => {
    expect(computeContentHash(masterJson, [detail1])).toBe(computeContentHash(masterJson, [detail1]));
  });

  it('is onafhankelijk van de detail-volgorde', () => {
    expect(computeContentHash(masterJson, [detail1, detail2]))
      .toBe(computeContentHash(masterJson, [detail2, detail1]));
  });

  it('wijzigt wanneer een masterveld verandert', () => {
    const changed = JSON.stringify({ vendorAccount: 'Q000104', status: 'Confirmed' });
    expect(computeContentHash(changed, [detail1])).not.toBe(computeContentHash(masterJson, [detail1]));
  });

  it('wijzigt wanneer een detail verandert', () => {
    const changedDetail = JSON.stringify({ lineNumber: 1, itemNumber: 'ART-1', quantity: 11 });
    expect(computeContentHash(masterJson, [changedDetail])).not.toBe(computeContentHash(masterJson, [detail1]));
  });

  it('werkt zonder details', () => {
    expect(typeof computeContentHash(masterJson, [])).toBe('string');
  });
});

describe('TableDataService.computeRevision', () => {
  const baseParts = {
    syncedAt: '2026-07-15T10:00:00.000Z',
    maxContentChangedAt: '2026-07-15T09:30:00.000Z',
    maxFirstSeenAt: '2026-07-10T08:00:00.000Z',
    maxCustomValueAt: '2026-07-15T09:45:00.000Z',
    maxLedgerAt: null,
    maxColumnsAt: '2026-07-01T00:00:00.000Z',
    exclusionCount: 3,
    maxExclusionAt: '2026-07-14T12:00:00.000Z',
    userViewedAt: '2026-07-15T09:00:00.000Z',
    userBoardSettingsAt: null,
    settingsAt: '2026-07-05T00:00:00.000Z',
    supplierAccount: null,
  };

  it('is deterministisch voor dezelfde parts', () => {
    expect(computeRevision(baseParts)).toBe(computeRevision({ ...baseParts }));
  });

  it('is onafhankelijk van de key-volgorde', () => {
    const reordered = {};
    for (const key of Object.keys(baseParts).reverse()) reordered[key] = baseParts[key];
    expect(computeRevision(reordered)).toBe(computeRevision(baseParts));
  });

  it('verandert wanneer een cel-edit binnenkomt (maxCustomValueAt)', () => {
    const changed = { ...baseParts, maxCustomValueAt: '2026-07-15T10:15:00.000Z' };
    expect(computeRevision(changed)).not.toBe(computeRevision(baseParts));
  });

  it('verandert wanneer een rij wordt verborgen/teruggezet (exclusionCount)', () => {
    expect(computeRevision({ ...baseParts, exclusionCount: 4 })).not.toBe(computeRevision(baseParts));
  });

  it('verandert wanneer een kolomdefinitie wijzigt (maxColumnsAt)', () => {
    const changed = { ...baseParts, maxColumnsAt: '2026-07-15T11:00:00.000Z' };
    expect(computeRevision(changed)).not.toBe(computeRevision(baseParts));
  });

  it('is supplier-aware: verschillende supplier → andere revision', () => {
    expect(computeRevision({ ...baseParts, supplierAccount: 'Q000104' }))
      .not.toBe(computeRevision({ ...baseParts, supplierAccount: 'Q000200' }));
  });

  it('behandelt Date en ISO-string identiek', () => {
    const withDate = { ...baseParts, syncedAt: new Date('2026-07-15T10:00:00.000Z') };
    expect(computeRevision(withDate)).toBe(computeRevision(baseParts));
  });

  it('levert altijd een niet-lege hex-string', () => {
    expect(computeRevision(baseParts)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('TableDataService.computeChangedFieldKeys', () => {
  it('detecteert gewijzigde velden op sleutelnaam', () => {
    expect(computeChangedFieldKeys(
      { status: 'Open', quantity: 10 },
      { status: 'Confirmed', quantity: 10 }
    )).toEqual(['status']);
  });

  it('normaliseert lege/whitespace strings zodat false positives wegblijven', () => {
    expect(computeChangedFieldKeys(
      { comment: '   ' },
      { comment: null }
    )).toEqual([]);
  });

  it('detecteert toegevoegde en verwijderde keys', () => {
    expect(computeChangedFieldKeys(
      { oldField: 'A' },
      { newField: 'B' }
    )).toEqual(['newField', 'oldField']);
  });
});

describe('TableDataService.dedupeDetailRows', () => {
  it('dedupliceert detailregels op partition + record + detail', () => {
    const result = dedupeDetailRows([
      { partitionKey: 'whsl', recordKey: 'WSPO-1', detailKey: 10, dataJson: '{"line":10}' },
      { partitionKey: 'whsl', recordKey: 'WSPO-1', detailKey: 10, dataJson: '{"line":10b}' },
      { partitionKey: 'whsl', recordKey: 'WSPO-1', detailKey: 20, dataJson: '{"line":20}' },
    ]);
    expect(result.duplicateCount).toBe(1);
    expect(result.rows).toEqual([
      { partitionKey: 'whsl', recordKey: 'WSPO-1', detailKey: 10, dataJson: '{"line":10b}' },
      { partitionKey: 'whsl', recordKey: 'WSPO-1', detailKey: 20, dataJson: '{"line":20}' },
    ]);
  });
});

describe('TableDataService.buildHistoryByCell', () => {
  it('groepeert custom- en write-backhistorie per cel en kolom', () => {
    const result = buildHistoryByCell([
      { column_id: 11, partition_key: 'whsl', record_key: 'PO-1', detail_key: -1 },
      { column_id: 12, partition_key: 'whsl', record_key: 'PO-1', detail_key: -1 },
      { column_id: 21, partition_key: 'whsl', record_key: 'PO-1', detail_key: 10 },
    ]);

    expect(result.get(JSON.stringify(['whsl', 'PO-1', -1]))).toEqual({ 11: true, 12: true });
    expect(result.get(JSON.stringify(['whsl', 'PO-1', 10]))).toEqual({ 21: true });
  });

  it('geeft een lege index voor ongeldige invoer', () => {
    expect(buildHistoryByCell(null).size).toBe(0);
  });
});

describe('TableDataService.applyLookups (fk_join-verrijking #AB:162)', () => {
  const vendorLookup = {
    sourceScope: 'master',
    sourceField: 'vendorAccount',
    fieldEntries: [['vendorOrgName', 'vendorName']],
    partitionless: false,
    byKey: new Map([['whsl|Q000101', { vendorName: 'Negende Generatie Beheer BV' }]]),
  };

  it('verrijkt op partition|record_key (bron-lookup)', () => {
    const v = { vendorAccount: 'Q000101' };
    applyLookups(v, 'whsl', [vendorLookup], 'master');
    expect(v.vendorOrgName).toBe('Negende Generatie Beheer BV');
  });

  it('respecteert de partition (andere dataAreaId => geen match)', () => {
    const v = { vendorAccount: 'Q000101' };
    applyLookups(v, 'anders', [vendorLookup], 'master');
    expect(v.vendorOrgName).toBeNull();
  });

  // Excel-dataset: partitie-loze match op alleen record_key.
  const excelLookup = {
    sourceScope: 'detail',
    sourceField: 'itemNumber',
    fieldEntries: [['artikelKleur', 'kleur']],
    partitionless: true,
    byKey: new Map([['ART-1', { kleur: 'Zwart' }]]),
  };

  it('matcht partitie-loos op record_key ongeacht de partition', () => {
    const a = { itemNumber: 'ART-1' };
    applyLookups(a, 'whsl', [excelLookup], 'detail');
    expect(a.artikelKleur).toBe('Zwart');
    const b = { itemNumber: 'ART-1' };
    applyLookups(b, 'andere-company', [excelLookup], 'detail');
    expect(b.artikelKleur).toBe('Zwart');
  });

  it('geeft null bij een onbekende sleutel', () => {
    const v = { itemNumber: 'ART-9' };
    applyLookups(v, 'whsl', [excelLookup], 'detail');
    expect(v.artikelKleur).toBeNull();
  });

  it('materialiseert geen lookup-keys buiten fieldEntries (inactive velden blijven weg)', () => {
    const v = { itemNumber: 'ART-1' };
    applyLookups(v, 'whsl', [excelLookup], 'detail');
    expect(Object.keys(v).sort()).toEqual(['artikelKleur', 'itemNumber']);
  });

  it('valt terug op source-json wanneer de lookup-bronkolom niet zichtbaar is', () => {
    const v = {};
    applyLookups(v, 'whsl', [vendorLookup], 'master', { vendorAccount: 'Q000101' });
    expect(v.vendorOrgName).toBe('Negende Generatie Beheer BV');
  });

  it('gebruikt alias-keys wanneer de actieve target-key nog geen waarde bevat', () => {
    const v = { vendorAccount: 'Q000101' };
    applyLookups(v, 'whsl', [{
      ...vendorLookup,
      fieldEntries: [['vendors_vendorGroupId', 'vendorGroupId']],
      byKey: new Map([['whsl|Q000101', { vendorGroup: 'GRC' }]]),
      targetAliasesByKey: { vendorGroupId: ['vendorGroup'] },
    }], 'master');
    expect(v.vendors_vendorGroupId).toBe('GRC');
  });
});

describe('TableDataService.normalizeExclusionRows', () => {
  it('trimt en behoudt geldige rijen', () => {
    expect(normalizeExclusionRows([{ partitionKey: ' whsl ', recordKey: ' PO-1 ' }]))
      .toEqual([{ partitionKey: 'whsl', recordKey: 'PO-1' }]);
  });

  it('weert rijen zonder partitie of record', () => {
    expect(normalizeExclusionRows([{ partitionKey: 'whsl' }, { recordKey: 'PO-1' }, {}])).toEqual([]);
  });

  it('dedupliceert dubbele (partitie, record)', () => {
    const out = normalizeExclusionRows([
      { partitionKey: 'whsl', recordKey: 'PO-1' },
      { partitionKey: 'whsl', recordKey: 'PO-1' },
      { partitionKey: 'whsl', recordKey: 'PO-2' },
    ]);
    expect(out).toEqual([
      { partitionKey: 'whsl', recordKey: 'PO-1' },
      { partitionKey: 'whsl', recordKey: 'PO-2' },
    ]);
  });

  it('weert te lange sleutels en niet-arrays', () => {
    expect(normalizeExclusionRows([{ partitionKey: 'x'.repeat(33), recordKey: 'PO-1' }])).toEqual([]);
    expect(normalizeExclusionRows(null)).toEqual([]);
  });
});

describe('TableDataService.formule-evaluatie in read-flow', () => {
  it('evalueert een regel-formule tot 0', () => {
    const formulas = compileFormulaColumns([
      { key: 'deliverRemainderApprox', dataType: 'number', formulaExpr: '(quantity)-(receivedpurchasequantity)' },
    ]);
    const values = { quantity: 14, receivedpurchasequantity: 14 };
    const errors = applyFormulaColumnsToRowValues(values, formulas);
    expect(values.deliverRemainderApprox).toBe(0);
    expect(errors).toEqual({});
  });

  it('compileert formulekolommen en evalueert per rij', () => {
    const formulas = compileMasterFormulaColumns([
      { key: 'delta', dataType: 'number', formulaExpr: '(inkoop)-(budget)' },
    ]);
    const values = { inkoop: 12, budget: 7 };
    const errors = applyFormulaColumnsToRowValues(values, formulas);
    expect(values.delta).toBe(5);
    expect(errors).toEqual({});
  });

  it('rapporteert formulefouten zonder crash', () => {
    const formulas = compileMasterFormulaColumns([
      { key: 'ratio', dataType: 'number', formulaExpr: '(a)/(b)' },
    ]);
    const values = { a: 10, b: 0 };
    const errors = applyFormulaColumnsToRowValues(values, formulas);
    expect(values.ratio).toBeNull();
    expect(errors.ratio).toContain('Division by zero');
  });

  it('evalueert referenties hoofdletter-onafhankelijk', () => {
    const formulas = compileMasterFormulaColumns([
      { key: 'statusCheck', dataType: 'text', formulaExpr: "ALS((requesteddeliverydate)<(confirmeddeliverydate);'kleiner';'groter')" },
    ]);
    const values = {
      requestedDeliveryDate: '2026-07-01',
      confirmedDeliveryDate: '2026-07-05',
    };
    const errors = applyFormulaColumnsToRowValues(values, formulas);
    expect(values.statusCheck).toBe('kleiner');
    expect(errors).toEqual({});
  });
});

describe('TableDataService.recalculateMasterRowFormulas (live update na cel-edit)', () => {
  it('doet geen enkele database-call als de tabel geen formulekolommen heeft (perf-guard)', async () => {
    // Geen mock van getPool/sql nodig: als de functie tóch een query zou proberen
    // uit te voeren zonder echte databaseverbinding, zou deze test crashen/timeouten.
    // Slagen bevestigt dus zowel het resultaat als de "geen DB-call"-garantie.
    const result = await recalculateMasterRowFormulas({
      table: { id: 1, key: 'purchase-orders' },
      masterCols: [{ key: 'budget', dataType: 'number', source: 'source' }],
      partitionKey: 'whsl',
      recordKey: 'PO-1',
      userId: 7,
    });
    expect(result).toEqual({ formulaValues: {}, formulaErrors: {} });
  });

  it('geeft ook zonder database-call een leeg resultaat bij ontbrekende rij-sleutels', async () => {
    const result = await recalculateMasterRowFormulas({
      table: { id: 1, key: 'purchase-orders' },
      masterCols: [{ key: 'delta', dataType: 'number', formulaExpr: '(a)-(b)' }],
      partitionKey: '',
      recordKey: '',
      userId: 7,
    });
    expect(result).toEqual({ formulaValues: {}, formulaErrors: {} });
  });
});

describe('TableDataService.assertCustomColumnWritable', () => {
  it('weigert image-kolommen voor handmatige save', () => {
    expect(() => assertCustomColumnWritable({
      source: 'custom',
      dataType: 'image',
      formulaExpr: null,
    })).toThrow(/read-only/i);
  });

  it('weigert directe custom-valuewrites naar Remarks', () => {
    expect(() => assertCustomColumnWritable({
      source: 'custom',
      dataType: 'remarks',
      formulaExpr: null,
    })).toThrow(/direct value writes/i);
  });

  it('weigert formulekolommen voor handmatige save', () => {
    expect(() => assertCustomColumnWritable({
      source: 'custom',
      formulaExpr: '(a)+(b)',
    })).toThrow(/read-only/i);
  });

  it('accepteert gewone custom kolommen', () => {
    expect(() => assertCustomColumnWritable({
      source: 'custom',
      formulaExpr: null,
    })).not.toThrow();
  });
});

describe('TableDataService.resolveSourceColumnValue', () => {
  it('gebruikt sourceField wanneer key anders is', () => {
    const sourceJson = { RequestedDeliveryDate: '2026-07-12' };
    const value = resolveSourceColumnValue(sourceJson, {
      key: 'requestedDeliveryDate',
      sourceField: 'RequestedDeliveryDate',
    });
    expect(value).toBe('2026-07-12');
  });

  it('valt terug op key wanneer sourceField ontbreekt', () => {
    const sourceJson = { requestedDeliveryDate: '2026-07-12' };
    const value = resolveSourceColumnValue(sourceJson, {
      key: 'requestedDeliveryDate',
      sourceField: null,
    });
    expect(value).toBe('2026-07-12');
  });
});

describe('TableDataService runtime linked header values', () => {
  it('berekent line total link en zet headerwaarde', () => {
    const masterValues = { aantal_total_2: null };
    const details = [
      { values: { quantity: 2 } },
      { values: { quantity: '3' } },
      { values: { quantity: null } },
    ];
    applyRuntimeLinkedHeaderValues(masterValues, details, {
      lineTotalHeaderLinks: [{ lineColumnKey: 'quantity', headerColumnKey: 'aantal_total_2' }],
      lineValueHeaderLinks: [],
    });
    expect(masterValues.aantal_total_2).toBe(5);
  });

  it('toAdminColumn geeft formulaExpr door aan de admin-UI', () => {
    const mapped = toAdminColumn({
      id: 1,
      key: 'quantity',
      label: 'Aantal',
      scope: 'detail',
      source: 'source',
      dataType: 'number',
      formulaExpr: '(a)+(b)',
    });
    expect(mapped.formulaExpr).toBe('(a)+(b)');
    expect(mapped).not.toHaveProperty('rccpMeasure');
  });

  it('calculateLinkedLineTotal telt robuust numerieke waarden', () => {
    const total = calculateLinkedLineTotal(
      [
        { values: { quantity: '1,5' } },
        { values: { quantity: '2.5' } },
        { values: { quantity: 'x' } },
      ],
      'quantity'
    );
    expect(total).toBe(4);
  });

  it('zet unieke lijnwaarden alleen op een expliciet gekoppelde headerkolom', () => {
    const masterValues = { item_values: null };
    const details = [
      { values: { items_searchName: 'Item A' } },
      { values: { items_searchName: 'Item B' } },
      { values: { items_searchName: 'Item A' } },
    ];
    applyRuntimeLinkedHeaderValues(masterValues, details, {
      lineTotalHeaderLinks: [],
      lineValueHeaderLinks: [{
        lineColumnKey: 'items_searchName',
        headerColumnKey: 'item_values',
      }],
    });
    expect(masterValues).toEqual({ item_values: 'Item A, Item B' });
  });

  it('geeft de ruwe, ontdubbelde lijnwaarden terug zodat het board ze zelf formatteert', () => {
    const linkedLineValues = applyRuntimeLinkedHeaderValues({ item_values: null }, [
      { values: { items_searchName: 'Item A' } },
      { values: { items_searchName: 'Item B' } },
      { values: { items_searchName: 'Item A' } },
      { values: { items_searchName: '' } },
    ], {
      lineValueHeaderLinks: [{ lineColumnKey: 'items_searchName', headerColumnKey: 'item_values' }],
    });
    expect(linkedLineValues).toEqual({ item_values: ['Item A', 'Item B'] });
  });
});

describe('TableDataService.buildDetailRollup', () => {
  it('vat samen wat het board van dichtgeklapte sublijnen nodig heeft', () => {
    const rollup = buildDetailRollup([
      { values: { itemNumber: 'ITEM-1' }, isNew: false, isChanged: true, isRemoved: false },
      { values: { itemNumber: 'ITEM-2' }, isNew: true, isChanged: false, isRemoved: false },
      { values: { itemNumber: 'ITEM-1' }, isNew: false, isChanged: false, isRemoved: false },
    ]);
    expect(rollup).toEqual({
      detailCount: 3,
      hasNewLine: true,
      hasChangedLine: true,
      productImageSummary: { firstItemNumber: 'ITEM-1', additionalItemCount: 1 },
    });
  });

  it('telt vervallen regels niet mee in de image-preview', () => {
    const rollup = buildDetailRollup([
      { values: { itemNumber: 'GONE' }, isRemoved: true },
      { values: { itemNumber: 'ITEM-9' } },
    ]);
    expect(rollup.hasRemovedLine).toBeUndefined();
    expect(rollup.productImageSummary).toEqual({ firstItemNumber: 'ITEM-9', additionalItemCount: 0 });
  });

  it('zet hasRemovedLine alleen bij een ongeziene verwijdering', () => {
    expect(buildDetailRollup([
      { values: { itemNumber: 'GONE' }, isRemoved: true, hasRemovalChange: true },
    ]).hasRemovedLine).toBe(true);
    expect(buildDetailRollup([
      { values: { itemNumber: 'GONE' }, isRemoved: true },
    ]).hasRemovedLine).toBeUndefined();
  });

  it('laat false-vlaggen en een lege image-preview weg uit de payload', () => {
    expect(buildDetailRollup([])).toEqual({ detailCount: 0 });
  });

  it('ziet gewijzigde velden zonder isChanged-vlag als regelwijziging', () => {
    expect(buildDetailRollup([{ values: {}, changedFieldKeys: ['qty'] }]).hasChangedLine).toBe(true);
  });
});

describe('TableDataService lookup column scopes', () => {
  it('houdt detail-lookups uit de hoofditemkolommen', () => {
    const masterCols = [];
    const detailCols = [];
    const itemColumns = [{ key: 'items_searchName', scope: 'detail' }];

    addLookupColumnsByScope('detail', itemColumns, masterCols, detailCols);

    expect(masterCols).toEqual([]);
    expect(detailCols).toEqual(itemColumns);
  });
});

describe('TableDataService fetch adapters (#195)', () => {
  it('registreert adapters voor purchase-orders, vendors en items', () => {
    expect(typeof FETCH_ADAPTERS['purchase-orders']).toBe('function');
    expect(typeof FETCH_ADAPTERS.vendors).toBe('function');
    expect(typeof FETCH_ADAPTERS.items).toBe('function');
  });
});

// Kern van de items-count binnen PO-scope: eigen items-filter (AND) gecombineerd met de
// one-of clausule op de lookup-sleutels (itemnummers uit de PO-cache).
describe('TableDataService items sync filter binnen PO-scope', () => {
  it('bouwt een one-of clausule op ItemNumber', () => {
    expect(buildOneOfFilterClause('ItemNumber', ['A-1']))
      .toBe("ItemNumber eq 'A-1'");
    expect(buildOneOfFilterClause('ItemNumber', ['A-1', 'A-2']))
      .toBe("(ItemNumber eq 'A-1' or ItemNumber eq 'A-2')");
  });

  it('escaped enkele quotes in de one-of waarden', () => {
    expect(buildOneOfFilterClause('ItemNumber', ["O'Brien"]))
      .toBe("ItemNumber eq 'O''Brien'");
  });

  it('combineert het items-filter (AND) met de PO-scope clausule', () => {
    const itemsFilter = "ItemGroupId eq 'FINISHED'";
    const poScope = "(ItemNumber eq 'A-1' or ItemNumber eq 'A-2')";
    expect(combineODataFilters(itemsFilter, poScope))
      .toBe("(ItemGroupId eq 'FINISHED') and ((ItemNumber eq 'A-1' or ItemNumber eq 'A-2'))");
  });

  it('valt terug op alleen de PO-scope wanneer er geen items-filter is (lege regels)', () => {
    const poScope = "ItemNumber eq 'A-1'";
    expect(combineODataFilters('', poScope)).toBe(poScope);
  });
});

// PO-bord-filtering op de items-syncfilter: een regel is zichtbaar zolang zijn item nog in de
// (gefilterde) items-cache staat. allowedItemKeys = partition|itemnummer van aanwezige items.
describe('TableDataService.detailMatchesItemsFilter (items-filter op PO-bord)', () => {
  const allowed = new Set(['whsl|CFM-10075-10-02']);

  it('houdt regels waarvan het item in de gefilterde items-cache zit', () => {
    const d = {
      partition_key: 'whsl', record_key: 'PO-1', detail_key: 10,
      data_json: JSON.stringify({ itemNumber: 'CFM-10075-10-02' }),
    };
    expect(detailMatchesItemsFilter(d, 'itemNumber', allowed)).toBe(true);
  });

  it('verbergt regels waarvan het item is weggefilterd (niet in de set)', () => {
    const d = {
      partition_key: 'whsl', record_key: 'PO-1', detail_key: 20,
      data_json: JSON.stringify({ itemNumber: 'BFM-30002-10-01' }),
    };
    expect(detailMatchesItemsFilter(d, 'itemNumber', allowed)).toBe(false);
  });

  it('respecteert de partition (andere dataAreaId => geen match)', () => {
    const d = {
      partition_key: 'other', record_key: 'PO-1', detail_key: 10,
      data_json: JSON.stringify({ itemNumber: 'CFM-10075-10-02' }),
    };
    expect(detailMatchesItemsFilter(d, 'itemNumber', allowed)).toBe(false);
  });
});

describe('TableDataService.resolveConfiguredMaxItems', () => {
  it('gebruikt expliciete settingwaarde wanneer geldig', () => {
    expect(resolveConfiguredMaxItems('500', 2000, 1000)).toBe(500);
  });

  it('valt terug op tabel maxRows wanneer setting ontbreekt', () => {
    expect(resolveConfiguredMaxItems(null, 10000, 2000)).toBe(10000);
  });
});

describe('TableDataService.requiredMasterFieldsFromTable', () => {
  it('forceert geen ModifiedDateTime voor generieke entiteiten', () => {
    expect(requiredMasterFieldsFromTable({
      keyFields: ['dataAreaId', 'VendorAccountNumber'],
    })).toEqual(['dataAreaId', 'VendorAccountNumber']);
  });
});

describe('TableDataService.buildLookupFieldMap', () => {
  it('behoudt bestaande derived keys wanneer dezelfde targetvelden geselecteerd blijven', () => {
    const map = buildLookupFieldMap({
      targetTableKey: 'vendors',
      targetFieldKeys: ['vendorOrganizationName', 'partyNumber'],
      existingFields: {
        vendorOrganizationName: 'vendorOrganizationName',
        vendors_partyNumber: 'partyNumber',
      },
    });
    expect(map).toEqual({
      vendorOrganizationName: 'vendorOrganizationName',
      vendors_partyNumber: 'partyNumber',
    });
  });

  it('maakt stabiele prefixed keys voor nieuw geselecteerde velden', () => {
    const map = buildLookupFieldMap({
      targetTableKey: 'items',
      targetFieldKeys: ['searchName', 'itemGroupId'],
      existingFields: {},
    });
    expect(map).toEqual({
      items_searchName: 'searchName',
      items_itemGroupId: 'itemGroupId',
    });
  });
});

describe('TableDataService.resolveLookupSourceKey', () => {
  it('mapt relation source_field naar de lokale kolomkey via sourceField', () => {
    const sourceKey = resolveLookupSourceKey(
      { sourceField: 'OrderVendorAccountNumber' },
      [
        { source: 'source', key: 'vendorAccount', sourceField: 'OrderVendorAccountNumber' },
        { source: 'source', key: 'orderNumber', sourceField: 'PurchaseOrderNumber' },
      ]
    );
    expect(sourceKey).toBe('vendorAccount');
  });

  it('is tolerant voor hoofdletters in relation source_field', () => {
    const sourceKey = resolveLookupSourceKey(
      { sourceField: 'ItemNumber' },
      [
        { source: 'source', key: 'itemNumber', sourceField: 'ItemNumber' },
      ]
    );
    expect(sourceKey).toBe('itemNumber');
  });
});

describe('TableDataService.resolveLookupTargetSourceField', () => {
  it('mapt target_key_field op kolom key naar sourceField voor D365 filter', () => {
    const targetField = resolveLookupTargetSourceField(
      { targetKeyField: 'vendorAccountNumber' },
      [
        { key: 'vendorAccountNumber', sourceField: 'VendorAccountNumber' },
        { key: 'vendorGroupId', sourceField: 'VendorGroupId' },
      ]
    );
    expect(targetField).toBe('VendorAccountNumber');
  });

  it('behoudt het veld wanneer geen kolom-mapping bestaat', () => {
    const targetField = resolveLookupTargetSourceField(
      { targetKeyField: 'ItemNumber' },
      [{ key: 'searchName', sourceField: 'SearchName' }]
    );
    expect(targetField).toBe('ItemNumber');
  });
});

describe('TableDataService.resolveLookupProjectionColumns', () => {
  it('neemt lookup-bronkolommen mee, ook als die inactief zijn', () => {
    const resolved = resolveLookupProjectionColumns({
      scope: 'master',
      activeColumns: [
        { key: 'orderNumber', source: 'source' },
      ],
      allColumns: [
        { key: 'orderNumber', source: 'source' },
        { key: 'vendorAccount', source: 'source' },
      ],
      lookups: [
        { sourceScope: 'master', sourceField: 'vendorAccount' },
      ],
    });
    expect(resolved.map((column) => column.key)).toEqual(['orderNumber', 'vendorAccount']);
  });

  it('voegt geen onbekende lookup-bronkolommen toe', () => {
    const resolved = resolveLookupProjectionColumns({
      scope: 'master',
      activeColumns: [{ key: 'orderNumber', source: 'source' }],
      allColumns: [{ key: 'orderNumber', source: 'source' }],
      lookups: [{ sourceScope: 'master', sourceField: 'vendorAccount' }],
    });
    expect(resolved.map((column) => column.key)).toEqual(['orderNumber']);
  });

  it('resolveert relation source_field via sourceField naar lokale key', () => {
    const resolved = resolveLookupProjectionColumns({
      scope: 'detail',
      activeColumns: [{ key: 'lineNumber', source: 'source' }],
      allColumns: [
        { key: 'lineNumber', source: 'source', sourceField: 'LineNumber' },
        { key: 'itemNumber', source: 'source', sourceField: 'ItemNumber' },
      ],
      lookups: [{ sourceScope: 'detail', sourceField: 'ItemNumber' }],
    });
    expect(resolved.map((column) => column.key)).toEqual(['lineNumber', 'itemNumber']);
  });
});

describe('TableDataService.buildLookupDedupeSignature', () => {
  it('dedupliceert lookup-relaties op scope + source + target table', () => {
    const a = buildLookupDedupeSignature({
      sourceScope: 'master',
      sourceFieldKey: 'vendorAccount',
      targetTableKey: 'vendors',
    });
    const b = buildLookupDedupeSignature({
      sourceScope: 'master',
      sourceFieldKey: 'vendorAccount',
      targetTableKey: 'vendors',
    });
    expect(a).toBe(b);
  });
});

describe('TableDataService.buildLookupTargetAliases', () => {
  it('neemt inactieve alias-keys met hetzelfde sourceField mee', () => {
    const aliases = buildLookupTargetAliases(
      [{ key: 'vendorGroupId', sourceField: 'VendorGroupId' }],
      [
        { key: 'vendorGroupId', sourceField: 'VendorGroupId' },
        { key: 'vendorGroup', sourceField: 'VendorGroupId' },
      ]
    );
    expect(aliases).toEqual({
      vendorGroupId: ['VendorGroupId', 'vendorGroup'],
    });
  });
});

describe('TableDataService.resolveRecordKeys', () => {
  it('bouwt een 3-veld recordKey met pipe-separated waarden', () => {
    const keys = resolveRecordKeys(
      { keyFields: ['dataAreaId', 'PurchaseOrderNumber', 'PurchaseOrderLineNumber'] },
      { dataAreaId: 'whsl', PurchaseOrderNumber: 'PO-1', PurchaseOrderLineNumber: 10 },
      'whsl',
    );
    expect(keys).toEqual({ partitionKey: 'whsl', recordKey: 'PO-1|10' });
  });

  it('normaliseert number en string naar dezelfde recordKey', () => {
    const fromNumber = resolveRecordKeys(
      { keyFields: ['dataAreaId', 'PurchaseOrderNumber', 'PurchaseOrderLineNumber'] },
      { dataAreaId: 'whsl', PurchaseOrderNumber: 'PO-1', PurchaseOrderLineNumber: 10 },
      'whsl',
    );
    const fromString = resolveRecordKeys(
      { keyFields: ['dataAreaId', 'PurchaseOrderNumber', 'PurchaseOrderLineNumber'] },
      { dataAreaId: 'whsl', PurchaseOrderNumber: 'PO-1', PurchaseOrderLineNumber: '10' },
      'whsl',
    );
    expect(fromNumber.recordKey).toBe(fromString.recordKey);
  });
});

describe('TableDataService.buildLookupCacheKey', () => {
  const compositeLookup = {
    joinKeys: [
      { sourceKey: 'purchaseOrderNumber', targetKey: 'purchaseOrderNumber' },
      { sourceKey: 'lineNumber', targetKey: 'purchaseOrderLineNumber' },
    ],
    partitionless: false,
  };

  it('bouwt een composite key voor PO-regel matching', () => {
    const key = buildLookupCacheKey('whsl', {
      purchaseOrderNumber: 'PO-1',
      lineNumber: 10,
    }, compositeLookup);
    expect(key).toBe('whsl|PO-1|10');
  });

  it('geeft null terug wanneer een composite sleuteldeel ontbreekt', () => {
    const key = buildLookupCacheKey('whsl', { purchaseOrderNumber: 'PO-1' }, compositeLookup);
    expect(key).toBeNull();
  });
});

describe('TableDataService.buildDetailLookupSourceValues', () => {
  it('vult purchaseOrderNumber en lineNumber aan vanuit master/detail sleutels', () => {
    const source = buildDetailLookupSourceValues({ itemNumber: 'ART-1' }, 'PO-100', 20);
    expect(source).toEqual({
      itemNumber: 'ART-1',
      purchaseOrderNumber: 'PO-100',
      lineNumber: 20,
      purchaseOrderLineNumber: '20',
    });
  });

  it('behoudt bestaande json-waarden wanneer aanwezig', () => {
    const source = buildDetailLookupSourceValues({
      purchaseOrderNumber: 'PO-200',
      lineNumber: 5,
    }, 'PO-100', 20);
    expect(source.purchaseOrderNumber).toBe('PO-200');
    expect(source.lineNumber).toBe(5);
    expect(source.purchaseOrderLineNumber).toBe('5');
  });
});

describe('TableDataService.enrichLookupSourceFromCacheRow', () => {
  it('vult composite sleutels aan vanuit record_key voor ontvangstregels', () => {
    const source = enrichLookupSourceFromCacheRow(
      'product-receipt-lines',
      'PO-1|10',
      { receivedPurchaseQuantity: 3 }
    );
    expect(source).toEqual({
      receivedPurchaseQuantity: 3,
      purchaseOrderNumber: 'PO-1',
      purchaseOrderLineNumber: '10',
      lineNumber: '10',
    });
  });
});

describe('TableDataService.buildD365LedgerEntries', () => {
  const base = { tableId: 1, partitionKey: 'whsl', recordKey: 'PO-1', detailKey: 2 };

  it('schrijft een nieuwe rij als één regel, niet per veld', () => {
    const entries = buildD365LedgerEntries({
      ...base,
      action: 'INSERT',
      nextValues: { quantity: 5, itemNumber: 'ART-1', description: 'x' },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].fieldKey).toBeNull();
    expect(entries[0].oldValue).toBeNull();
    // De hele rij als payload, net als bij DELETE.
    expect(JSON.parse(entries[0].newValue)).toEqual({ quantity: 5, itemNumber: 'ART-1', description: 'x' });
  });

  it('houdt UPDATE per gewijzigd veld', () => {
    const entries = buildD365LedgerEntries({
      ...base,
      action: 'UPDATE',
      previousValues: { quantity: 5, itemNumber: 'ART-1' },
      nextValues: { quantity: 8, itemNumber: 'ART-1' },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].fieldKey).toBe('quantity');
    expect(entries[0].oldValue).toBe('5');
    expect(entries[0].newValue).toBe('8');
  });

  it('schrijft niets bij een UPDATE zonder wijzigingen', () => {
    expect(buildD365LedgerEntries({
      ...base,
      action: 'UPDATE',
      previousValues: { quantity: 5 },
      nextValues: { quantity: 5 },
    })).toEqual([]);
  });

  it('houdt DELETE één regel met de hele rij', () => {
    const entries = buildD365LedgerEntries({
      ...base, action: 'DELETE', previousValues: { quantity: 5 },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].fieldKey).toBeNull();
    expect(entries[0].newValue).toBeNull();
  });
});

describe('TableDataService.buildLedgerInsert', () => {
  const entry = (over) => ({
    tableId: 1, partitionKey: 'whsl', recordKey: 'PO-1', detailKey: 2,
    fieldKey: 'quantity', source: 'D365', action: 'INSERT', newValue: '5', ...over,
  });

  it('bouwt één VALUES-tuple per entry', () => {
    const { text, params } = buildLedgerInsert([entry(), entry({ recordKey: 'PO-2' })]);
    expect(text.match(/\(@tableId\d+,/g)).toHaveLength(2);
    // 12 parameters per entry.
    expect(params).toHaveLength(24);
  });

  it('geeft elke parameter een rij-unieke naam (geen botsingen in de batch)', () => {
    const { params } = buildLedgerInsert([entry(), entry({ recordKey: 'PO-2' })]);
    const names = params.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('tableId0');
    expect(names).toContain('tableId1');
  });

  it('valt terug op het master-detailkey (-1) bij een niet-integer detailKey', () => {
    const { params } = buildLedgerInsert([entry({ detailKey: null })]);
    const detail = params.find((p) => p.name === 'detailKey0');
    expect(detail.value).toBe(-1);
  });
});

describe('TableDataService.buildD365ChangeState', () => {
  const line = (action, createdAt) => ({
    partition_key: 'whsl', record_key: 'WSPO-1', detail_key: 20, field_key: 'quantity', action, created_at: createdAt,
  });
  const stateFor = (rows) => buildD365ChangeState(rows).lineChanges.get('whsl|WSPO-1|20');

  it('markeert een regel als verwijderd bij DELETE', () => {
    expect(stateFor([line('DELETE', '2026-07-15T17:56:32Z')]).isRemoved).toBe(true);
  });

  // Een refresh schrijft DELETE + INSERT vlak na elkaar; de regel bestaat daarna gewoon.
  it('heft de verwijdering op als de regel daarna opnieuw wordt ingevoegd', () => {
    const state = stateFor([
      line('DELETE', '2026-07-15T17:56:32Z'),
      line('INSERT', '2026-07-15T17:56:57Z'),
    ]);
    expect(state.isRemoved).toBe(false);
    expect(state.isNew).toBe(true);
  });

  it('heft de verwijdering ook op bij een latere UPDATE', () => {
    const state = stateFor([
      line('DELETE', '2026-07-15T17:56:32Z'),
      line('UPDATE', '2026-07-15T18:00:00Z'),
    ]);
    expect(state.isRemoved).toBe(false);
  });

  it('houdt een DELETE die ná de INSERT komt wél vast', () => {
    const state = stateFor([
      line('INSERT', '2026-07-15T17:00:00Z'),
      line('DELETE', '2026-07-15T18:00:00Z'),
    ]);
    expect(state.isRemoved).toBe(true);
    expect(state.isNew).toBe(false);
  });

  it('markeert een order-header als verwijderd bij DELETE', () => {
    const state = buildD365ChangeState([{
      partition_key: 'whsl', record_key: 'WSPO-1', detail_key: -1, field_key: null, action: 'DELETE',
    }]).orderChanges.get('whsl|WSPO-1');
    expect(state.isRemoved).toBe(true);
    expect(state.isChanged).toBe(false);
  });

  it('heft een header-verwijdering op bij een latere INSERT', () => {
    const state = buildD365ChangeState([
      { partition_key: 'whsl', record_key: 'WSPO-1', detail_key: -1, field_key: null, action: 'DELETE' },
      { partition_key: 'whsl', record_key: 'WSPO-1', detail_key: -1, field_key: null, action: 'INSERT' },
    ]).orderChanges.get('whsl|WSPO-1');
    expect(state.isRemoved).toBe(false);
    expect(state.isNew).toBe(true);
  });
});

describe('TableDataService.buildSyntheticLookupColumn', () => {
  const base = {
    derivedKey: 'receivedPurchaseQuantity',
    targetColKey: 'receivedPurchaseQuantity',
    tableId: 1,
    sourceScope: 'detail',
    targetTableKey: 'product-receipt-lines',
    targetTableLabel: 'Ontvangstregels',
  };

  it('erft label en datatype van de doelkolom', () => {
    const column = buildSyntheticLookupColumn({
      ...base,
      targetColumn: {
        label: 'Received qty', dataType: 'number',
      },
    });
    expect(column.key).toBe('receivedPurchaseQuantity');
    expect(column.dataType).toBe('number');
    expect(column.source).toBe('lookup');
    expect(column).not.toHaveProperty('rccpMeasure');
    expect(column.lookup).toEqual({
      targetTableKey: 'product-receipt-lines',
      targetColumnKey: 'receivedPurchaseQuantity',
      targetTableLabel: 'Ontvangstregels',
      targetColumnLabel: 'Received qty',
    });
    expect(column.id).toBeNull();
  });

  it('valt terug op text zonder doelkolom', () => {
    const column = buildSyntheticLookupColumn({ ...base, targetColumn: undefined });
    expect(column.dataType).toBe('text');
    expect(column).not.toHaveProperty('rccpMeasure');
  });
});

describe('TableDataService.applyLookups composite', () => {
  const compositeLookup = {
    sourceScope: 'detail',
    sourceFieldKey: 'purchaseOrderNumber',
    joinKeys: [
      { sourceKey: 'purchaseOrderNumber', targetKey: 'purchaseOrderNumber' },
      { sourceKey: 'lineNumber', targetKey: 'purchaseOrderLineNumber' },
    ],
    partitionless: false,
    fieldEntries: [
      ['receivedPurchaseQuantity', 'receivedPurchaseQuantity'],
      ['remainingPurchaseQuantity', 'remainingPurchaseQuantity'],
    ],
    byKey: new Map([
      ['whsl|PO-1|10', { receivedPurchaseQuantity: 3, remainingPurchaseQuantity: 7 }],
    ]),
  };

  it('verrijkt PO-regels via composite fk_join lookup', () => {
    const detailValues = { itemNumber: 'ART-1' };
    const detailLookupSource = buildDetailLookupSourceValues(detailValues, 'PO-1', 10);
    applyLookups(detailValues, 'whsl', [compositeLookup], 'detail', detailLookupSource);
    expect(detailValues.receivedPurchaseQuantity).toBe(3);
    expect(detailValues.remainingPurchaseQuantity).toBe(7);
  });

  it('laat kolommen leeg bij geen match (niet 0)', () => {
    const detailValues = { itemNumber: 'ART-2' };
    const detailLookupSource = buildDetailLookupSourceValues(detailValues, 'PO-2', 20);
    applyLookups(detailValues, 'whsl', [compositeLookup], 'detail', detailLookupSource);
    expect(detailValues.receivedPurchaseQuantity).toBeNull();
    expect(detailValues.remainingPurchaseQuantity).toBeNull();
  });

  it('behoudt 0 als echte resterende hoeveelheid', () => {
    const detailValues = { itemNumber: 'ART-1' };
    const detailLookupSource = buildDetailLookupSourceValues(detailValues, 'PO-1', 10);
    const zeroLookup = {
      ...compositeLookup,
      byKey: new Map([
        ['whsl|PO-1|10', { receivedPurchaseQuantity: 14, remainingPurchaseQuantity: 0 }],
      ]),
    };
    applyLookups(detailValues, 'whsl', [zeroLookup], 'detail', detailLookupSource);
    expect(detailValues.receivedPurchaseQuantity).toBe(14);
    expect(detailValues.remainingPurchaseQuantity).toBe(0);
  });
});

describe('TableDataService.fillEmptyNumberFromFallback', () => {
  it('vult deliverRemainder met remaining qty, ook als die 0 is', () => {
    const values = { deliverRemainder: null, remainingPurchaseQuantity: 0 };
    fillEmptyNumberFromFallback(values, 'deliverRemainder', 'remainingPurchaseQuantity');
    expect(values.deliverRemainder).toBe(0);
  });

  it('overschrijft een bestaande waarde niet', () => {
    const values = { deliverRemainder: 3, remainingPurchaseQuantity: 0 };
    fillEmptyNumberFromFallback(values, 'deliverRemainder', 'remainingPurchaseQuantity');
    expect(values.deliverRemainder).toBe(3);
  });

  it('voegt de kolom niet toe als die niet in de rij zit', () => {
    const values = { remainingPurchaseQuantity: 0 };
    fillEmptyNumberFromFallback(values, 'deliverRemainder', 'remainingPurchaseQuantity');
    expect(values).not.toHaveProperty('deliverRemainder');
  });
});

describe('TableDataService.usesMasterRecordKeysForInheritedLookup', () => {
  it('gebruikt master record keys voor composite ontvangstregel-lookup', () => {
    expect(usesMasterRecordKeysForInheritedLookup({
      sourceScope: 'detail',
      targetTableKey: 'product-receipt-lines',
      joinKeys: [{ sourceKey: 'purchaseOrderNumber', targetKey: 'purchaseOrderNumber' }],
    })).toBe(true);
    expect(usesMasterRecordKeysForInheritedLookup({
      sourceScope: 'detail',
      targetTableKey: 'items',
      sourceField: 'ItemNumber',
    })).toBe(false);
  });
});

describe('TableDataService.FETCH_ADAPTERS', () => {
  it('registreert product-receipt-lines op genericMasterD365Fetch', () => {
    expect(typeof FETCH_ADAPTERS['product-receipt-lines']).toBe('function');
    expect(typeof FETCH_ADAPTERS['product-attribute-values']).toBe('function');
  });
});

// De JSON_VALUE-projectie kostte op Azure 44 s waar de volledige data_json 4,6 s kost bij ~73k
// detailregels (plan 2026-09-21, §5c/§5e). Daarom is die tak standaard uit en alleen met een
// expliciete env-schakelaar terug te zetten, zodat beide routes meetbaar blijven.
describe('TableDataService.fieldsProjectionEnabled', () => {
  const original = process.env.PO_DETAIL_FIELDS_PROJECTION;

  afterEach(() => {
    if (original === undefined) delete process.env.PO_DETAIL_FIELDS_PROJECTION;
    else process.env.PO_DETAIL_FIELDS_PROJECTION = original;
  });

  it('staat standaard uit zonder env-variabele', () => {
    delete process.env.PO_DETAIL_FIELDS_PROJECTION;
    expect(fieldsProjectionEnabled()).toBe(false);
  });

  it('gaat aan bij "1"', () => {
    process.env.PO_DETAIL_FIELDS_PROJECTION = '1';
    expect(fieldsProjectionEnabled()).toBe(true);
  });

  it('gaat aan bij "true", ongeacht hoofdletters en spaties', () => {
    process.env.PO_DETAIL_FIELDS_PROJECTION = '  TRUE ';
    expect(fieldsProjectionEnabled()).toBe(true);
  });

  it('blijft uit bij "0", "false" en een lege waarde', () => {
    for (const value of ['0', 'false', '', 'ja']) {
      process.env.PO_DETAIL_FIELDS_PROJECTION = value;
      expect(fieldsProjectionEnabled()).toBe(false);
    }
  });
});
