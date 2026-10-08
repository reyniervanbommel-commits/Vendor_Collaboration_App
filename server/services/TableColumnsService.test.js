'use strict';

const {
  DATA_TYPES,
  assertMentionableColumn,
  ensureRemarksColumn,
  resolveRccpQuantityEligibility,
  resolveWriteback,
  slugify,
  findDependentFormulaColumn,
  normalizeFormulaExpression,
  validateFormulaReferences,
  validateFormulaResultTypeCompatibility,
  validateImageOptions,
  validateRemarksColumnRequest,
} = require('./TableColumnsService');

describe('TableColumnsService.resolveWriteback', () => {
  it('writable=false => mechanism altijd null', () => {
    expect(resolveWriteback({ writable: false, mechanism: 'patch' })).toEqual({ writable: 0, mechanism: null });
    expect(resolveWriteback({ writable: 0 })).toEqual({ writable: 0, mechanism: null });
  });

  it('writable=true zonder mechanisme => default patch', () => {
    expect(resolveWriteback({ writable: true })).toEqual({ writable: 1, mechanism: 'patch' });
    expect(resolveWriteback({ writable: '1', mechanism: '' })).toEqual({ writable: 1, mechanism: 'patch' });
  });

  it('accepteert geldige mechanismen', () => {
    expect(resolveWriteback({ writable: true, mechanism: 'action' })).toEqual({ writable: 1, mechanism: 'action' });
    expect(resolveWriteback({ writable: true, mechanism: 'sql' })).toEqual({ writable: 1, mechanism: 'sql' });
  });

  it('weigert een onbekend mechanisme', () => {
    expect(() => resolveWriteback({ writable: true, mechanism: 'webhook' })).toThrow();
  });
});

describe('TableColumnsService.resolveRccpQuantityEligibility', () => {
  it('accepts a synced number column', () => {
    const result = resolveRccpQuantityEligibility({ dataType: 'number', source: 'source', isActive: true });
    expect(result.eligible).toBe(true);
    expect(result.reason).toBeNull();
  });

  it('accepts a custom number column that has a formula', () => {
    const result = resolveRccpQuantityEligibility({
      dataType: 'number', source: 'custom', formulaExpr: '(a)+(b)', isActive: true,
    });
    expect(result.eligible).toBe(true);
  });

  it('rejects a custom number column without a formula (per-user rollup, always empty in RCCP)', () => {
    const result = resolveRccpQuantityEligibility({
      dataType: 'number', source: 'custom', formulaExpr: null, isActive: true,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/board settings/i);
  });

  it('rejects a non-number column', () => {
    const result = resolveRccpQuantityEligibility({ dataType: 'text', source: 'source', isActive: true });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/number/i);
  });

  // De admin-tab toont inactieve kolommen (nodig om ze te heractiveren), maar ze worden niet
  // gesynct en staan niet in de board-read — als measure leveren ze altijd 0.
  it('rejects an inactive column', () => {
    const result = resolveRccpQuantityEligibility({ dataType: 'number', source: 'source', isActive: false });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/inactive/i);
  });
});

describe('TableColumnsService.slugify', () => {
  it('normaliseert label naar een kolomsleutel', () => {
    expect(slugify('Leverancier Naam')).toBe('leverancier_naam');
    expect(slugify('  Prijs (â‚¬) ')).toContain('prijs');
  });

  it('valt terug op "kolom" bij lege input', () => {
    expect(slugify('')).toBe('kolom');
    expect(slugify('!!!')).toBe('kolom');
  });
});

describe('TableColumnsService.findDependentFormulaColumn', () => {
  it('vindt een formule die naar de doelkolom verwijst', () => {
    const dependent = findDependentFormulaColumn(
      [
        { label: 'Totale score', formula_expr: "ALS((a)>(b);'Fout';(a)+(b))" },
        { label: 'Overig', formula_expr: '(x)+(y)' },
      ],
      'b'
    );
    expect(dependent?.label).toBe('Totale score');
  });

  it('geeft null als geen formule de kolom gebruikt', () => {
    const dependent = findDependentFormulaColumn(
      [{ label: 'Overig', formula_expr: '(x)+(y)' }],
      'niet_bestaand'
    );
    expect(dependent).toBeNull();
  });
});

describe('TableColumnsService formula helpers', () => {
  it('normaliseert formule en refs', () => {
    const normalized = normalizeFormulaExpression("= ALS((a)>(b);'Fout';(a)+(b)) ");
    expect(normalized.expression).toBe("ALS((a)>(b);'Fout';(a)+(b))");
    expect(normalized.references.sort()).toEqual(['a', 'b']);
  });

  it('laat lege formule door als null', () => {
    expect(normalizeFormulaExpression('  ')).toEqual({ expression: null, references: [] });
  });

  it('weigert onbekende of formule-referenties', () => {
    const columns = [
      { key: 'budget', scope: 'master', formulaExpr: null },
      { key: 'delta', scope: 'master', formulaExpr: '(a)+(b)' },
    ];
    expect(() => validateFormulaReferences(['onbekend'], columns, 'nieuw', 'master')).toThrow(/Unknown column reference/i);
    expect(() => validateFormulaReferences(['delta'], columns, 'nieuw', 'master')).toThrow(/formula column/i);
  });

  it('weigert detail-referenties in master-formules', () => {
    const columns = [
      { key: 'quantity', scope: 'detail', formulaExpr: null },
    ];
    expect(() => validateFormulaReferences(['quantity'], columns, 'total')).toThrow(/master columns/i);
  });

  it('weigert formule met onjuist resultaattype', () => {
    const columns = [
      { key: 'a', dataType: 'number' },
      { key: 'b', dataType: 'number' },
    ];
    expect(() => validateFormulaResultTypeCompatibility(
      "ALS((a)>(b);'kleiner';'groter')",
      ['a', 'b'],
      columns,
      'number'
    )).toThrow(/result type/i);
  });

  it('accepteert formule als resultaattype klopt', () => {
    const columns = [
      { key: 'a', dataType: 'number' },
      { key: 'b', dataType: 'number' },
    ];
    expect(() => validateFormulaResultTypeCompatibility(
      "ALS((a)>(b);'kleiner';'groter')",
      ['a', 'b'],
      columns,
      'text'
    )).not.toThrow();
  });
});

describe('TableColumnsService.validateImageOptions', () => {
  it('accepteert geldige image-opties en normaliseert trims/transforms', () => {
    const validated = validateImageOptions({
      urlTemplate: ' https://cdn.example.com/img/{xxx}.png ',
      sourceColumnKey: ' itemId ',
      transforms: [
        { type: 'trim' },
        { type: 'replace', from: '-', to: '' },
      ],
    });
    expect(validated).toEqual({
      urlTemplate: 'https://cdn.example.com/img/{xxx}.png',
      sourceColumnKey: 'itemId',
      transforms: [
        { type: 'trim' },
        { type: 'replace', from: '-', to: '' },
      ],
    });
  });

  it('weigert onveilige of onvolledige templates', () => {
    expect(() => validateImageOptions({
      urlTemplate: 'javascript:alert(1)',
      sourceColumnKey: 'itemId',
    })).toThrow(/http/i);
    expect(() => validateImageOptions({
      urlTemplate: 'https://cdn.example.com/image.png',
      sourceColumnKey: 'itemId',
    })).toThrow(/\{xxx\}/i);
  });

  it('weigert ontbrekende sourceColumnKey of foutieve transforms', () => {
    expect(() => validateImageOptions({
      urlTemplate: 'https://cdn.example.com/{xxx}.png',
      sourceColumnKey: '',
    })).toThrow(/sourceColumnKey/i);
    expect(() => validateImageOptions({
      urlTemplate: 'https://cdn.example.com/{xxx}.png',
      sourceColumnKey: 'itemId',
      transforms: [{ type: 'substring', start: -1 }],
    })).toThrow(/start/i);
  });
});

describe('TableColumnsService Remarks-contract', () => {
  it('registreert remarks als geldig datatype met een vast mastercontract', () => {
    expect(DATA_TYPES).toContain('remarks');
    expect(validateRemarksColumnRequest({
      scope: 'master',
      options: null,
      formulaExpr: null,
    })).toMatchObject({
      scope: 'master',
      key: 'remarks',
      label: 'Remarks',
      source: 'custom',
      dataType: 'remarks',
    });
  });

  it('weigert detailscope, opties/imagepad en formules', () => {
    expect(() => validateRemarksColumnRequest({ scope: 'detail' })).toThrow(/master/i);
    expect(() => validateRemarksColumnRequest({ scope: 'master', options: {} })).toThrow(/imagepad/i);
    expect(() => validateRemarksColumnRequest({
      scope: 'master',
      formulaExpr: '(amount)+(tax)',
    })).toThrow(/formule/i);
  });

  it('ensure gebruikt één vergrendelde ensure/reactivate-query met het vaste contract', async () => {
    const captured = {};
    const request = {
      input: vi.fn(function input(name, type, value) {
        captured[name] = value;
        return this;
      }),
      query: vi.fn(async (text) => {
        captured.sql = text;
        return {
          recordset: [{
            id: 8,
            table_id: 7,
            scope: 'master',
            key: 'remarks',
            label: 'Remarks',
            source: 'custom',
            source_field: null,
            data_type: 'remarks',
            options_json: null,
            writable: 0,
            write_mechanism: null,
            is_default_visible: 1,
            filterable: 0,
            sortable: 0,
            is_active: 1,
            visible_at_delete: 0,
            sort_order: 80,
            formula_expr: null,
          }],
        };
      }),
    };

    const column = await ensureRemarksColumn({
      pool: { request: () => request },
      tableId: 7,
      userId: 12,
    });

    expect(captured).toMatchObject({ tableId: 7, userId: 12 });
    expect(captured.sql).toMatch(/UPDLOCK, HOLDLOCK/);
    expect(captured.sql).toMatch(/IF @remarksId IS NOT NULL[\s\S]+is_active = 1/);
    expect(captured.sql).toMatch(/ELSE[\s\S]+INSERT INTO dbo\.tb_columns/);
    expect(column).toMatchObject({
      key: 'remarks',
      label: 'Remarks',
      dataType: 'remarks',
      writable: false,
      filterable: false,
      sortable: false,
      isActive: true,
    });
  });
});

describe('TableColumnsService.assertMentionableColumn', () => {
  it('staat een D365-tekstkolom toe', () => {
    expect(() => assertMentionableColumn({ source: 'source', dataType: 'text' })).not.toThrow();
  });

  it.each([
    ['custom tekstkolom', { source: 'custom', dataType: 'text' }],
    ['D365-getalkolom', { source: 'source', dataType: 'number' }],
    ['remarks-kolom', { source: 'custom', dataType: 'remarks' }],
  ])('weigert een %s met 400', (_label, column) => {
    expect(() => assertMentionableColumn(column)).toThrow(expect.objectContaining({ status: 400 }));
  });
});
