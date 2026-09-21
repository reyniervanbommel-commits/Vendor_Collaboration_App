describe('columnFormatRuleUtils legacy compatibility', () => {
  it('normaliseert legacy rule-arrays naar een actief ruleset-object', () => {
    const normalized = normalizeColumnFormatRuleSet([
      { operator: '>=', compareValue: '10', color: '#FFF4CE' },
    ]);

    expect(normalized).toEqual({
      target: 'cell',
      rules: [{ op: '>=', value: 10, color: '#fff4ce' }],
    });
  });

  it('accepteert legacy conditions en compareColumnKey in map-normalisatie', () => {
    const normalized = normalizeColumnFormatRulesMap({
      amount: {
        target: 'row',
        conditions: [{ operator: '=', compareColumnKey: 'budget', color: '#E6F4FF' }],
      },
    });

    expect(normalized).toEqual({
      amount: {
        target: 'row',
        rules: [{ op: '=', valueRef: 'budget', color: '#e6f4ff' }],
      },
    });
  });
});
import {
  evalFormatRules,
  migrateFormatRulesForStatusRenames,
  normalizeColumnFormatRuleSet,
  normalizeColumnFormatRulesMap,
} from './columnFormatRuleUtils';

describe('columnFormatRuleUtils.normalizeColumnFormatRuleSet', () => {
  it('normaliseert een geldig rule-set object', () => {
    expect(normalizeColumnFormatRuleSet({
      target: 'row',
      rules: [{ op: '>', value: 10, color: '#E6F4FF' }],
    })).toEqual({
      target: 'row',
      rules: [{ op: '>', value: 10, color: '#e6f4ff' }],
    });
  });

  it('geeft null terug bij lege regels', () => {
    expect(normalizeColumnFormatRuleSet({ target: 'cell', rules: [] })).toBeNull();
  });

  it('behoudt een 8-cijferige hex-kleur met opacity', () => {
    expect(normalizeColumnFormatRuleSet({
      target: 'cell',
      rules: [{ op: '>', value: 10, color: '#E2445CB3' }],
    })).toEqual({
      target: 'cell',
      rules: [{ op: '>', value: 10, color: '#e2445cb3' }],
    });
  });
});

describe('columnFormatRuleUtils.normalizeColumnFormatRulesMap', () => {
  it('filtert op allowed keys', () => {
    const map = normalizeColumnFormatRulesMap({
      score: { target: 'cell', rules: [{ op: '>=', value: 1, color: '#E6F4FF' }] },
      bogus: { target: 'cell', rules: [{ op: '>=', value: 1, color: '#E6F4FF' }] },
    }, ['score']);
    expect(Object.keys(map)).toEqual(['score']);
  });
});

describe('columnFormatRuleUtils.evalFormatRules', () => {
  it('geeft de eerste matchende kleur', () => {
    const color = evalFormatRules(12, {
      target: 'cell',
      rules: [
        { op: '>', value: 10, color: '#E6F4FF' },
        { op: '>', value: 5, color: '#FFF4CE' },
      ],
    });
    expect(color).toBe('#e6f4ff');
  });

  it('ondersteunt valueRef vergelijking', () => {
    const color = evalFormatRules(20, {
      target: 'cell',
      rules: [{ op: '>', valueRef: 'budget', color: '#E7F4EA' }],
    }, { budget: 15 });
    expect(color).toBe('#e7f4ea');
  });

  it('geeft null bij ontbrekende valueRef kolom', () => {
    const color = evalFormatRules(20, {
      target: 'cell',
      rules: [{ op: '>', valueRef: 'budget', color: '#E7F4EA' }],
    }, {});
    expect(color).toBeNull();
  });

  it('geeft null bij errored/lege formule-uitkomst', () => {
    expect(evalFormatRules(null, {
      target: 'cell',
      rules: [{ op: '>', value: 10, color: '#E6F4FF' }],
    })).toBeNull();
  });

  it('ondersteunt lege string vergelijking', () => {
    const color = evalFormatRules('', {
      target: 'cell',
      rules: [{ op: '=', value: '', color: '#FFF4CE' }],
    });
    expect(color).toBe('#fff4ce');
  });

  it('ondersteunt contains (case-insensitive)', () => {
    const color = evalFormatRules('Hello World', {
      target: 'cell',
      rules: [{ op: 'contains', value: 'heLLo', color: '#FFF4CE' }],
    });
    expect(color).toBe('#fff4ce');
  });

  it('ondersteunt contains met valueRef vergelijking', () => {
    const color = evalFormatRules('Acme Corporation', {
      target: 'cell',
      rules: [{ op: 'contains', valueRef: 'vendor', color: '#E6F4FF' }],
    }, { vendor: 'Corp' });
    expect(color).toBe('#e6f4ff');
  });

  it('matcht statuswaarden op stabiele option id na label-rename', () => {
    const statusOptions = [{ id: 'done', label: 'Completed', color: '#00c875' }];
    const color = evalFormatRules('Completed', {
      target: 'row',
      rules: [{ op: '=', value: 'Done', color: '#E7F4EA' }],
    }, {}, statusOptions);
    expect(color).toBe('#e7f4ea');
  });

  it('matcht D365 Backorder op het schermlabel Open order', () => {
    expect(evalFormatRules('Backorder', {
      target: 'cell',
      rules: [{ op: '=', value: 'Open order', color: '#E6F4FF' }],
    })).toBe('#e6f4ff');
    expect(evalFormatRules('Backorder', {
      target: 'cell',
      rules: [{ op: 'contains', value: 'open', color: '#FFF4CE' }],
    })).toBe('#fff4ce');
    expect(evalFormatRules('Invoiced', {
      target: 'cell',
      rules: [{ op: '=', value: 'Open order', color: '#E6F4FF' }],
    })).toBeNull();
    expect(evalFormatRules('Open order', {
      target: 'cell',
      rules: [{ op: '=', value: 'Backorder', color: '#E6F4FF' }],
    })).toBe('#e6f4ff');
  });
});

describe('columnFormatRuleUtils.migrateFormatRulesForStatusRenames', () => {
  it('werkt formatregel-vergelijkingswaarden bij na statuslabel-rename', () => {
    const nextMap = migrateFormatRulesForStatusRenames({
      status: {
        target: 'row',
        rules: [{ op: '=', value: 'Done', color: '#e7f4ea' }],
      },
    }, 'status', [{ from: 'Done', to: 'Completed' }]);
    expect(nextMap.status.rules[0].value).toBe('Completed');
  });
});
