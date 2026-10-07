import { describe, expect, it } from 'vitest';
import {
  MAX_COLUMN_FILTER_RULES,
  appendColumnFilterRule,
  extractColorFilter,
  extractValueRules,
  packColumnFilter,
} from './columnFilterState';
import { COLOR_FILTER_OPERATOR, hasActiveFilter } from './tableViewFilterUtils';

const textColumn = { key: 'vendor', dataType: 'text' };

describe('columnFilterState', () => {
  it('leest een legacy enkel filter als één waarde-regel', () => {
    const filter = { operator: 'startsWith', value: 'S', secondaryValue: '' };
    expect(extractValueRules(textColumn, filter)).toEqual([
      { operator: 'startsWith', value: 'S', secondaryValue: '' },
    ]);
    expect(extractColorFilter(filter)).toEqual([]);
  });

  it('leest meerdere regels uit een envelope', () => {
    const filter = {
      rules: [
        { operator: 'startsWith', value: 'S' },
        { operator: 'notContains', value: 'closed' },
      ],
    };
    expect(extractValueRules(textColumn, filter).map((rule) => rule.operator)).toEqual([
      'startsWith',
      'notContains',
    ]);
  });

  it('houdt kleur en waarde-regels naast elkaar', () => {
    const filter = {
      rules: [{ operator: 'contains', value: 'NL' }],
      colors: ['#ff0000'],
    };
    expect(extractValueRules(textColumn, filter)).toHaveLength(1);
    expect(extractColorFilter(filter)).toEqual(['#ff0000']);
    expect(hasActiveFilter(textColumn, filter)).toBe(true);
  });

  it('packt één regel zonder kleur terug als legacy object', () => {
    expect(packColumnFilter(
      [{ operator: 'contains', value: 'Acme', secondaryValue: '' }],
      [],
    )).toEqual({ operator: 'contains', value: 'Acme', secondaryValue: '' });
  });

  it('packt meerdere regels als envelope', () => {
    const packed = packColumnFilter(
      [
        { operator: 'startsWith', value: 'S', secondaryValue: '' },
        { operator: 'notContains', value: 'x', secondaryValue: '' },
      ],
      [],
    );
    expect(packed.rules).toHaveLength(2);
    expect(packed.operator).toBeUndefined();
  });

  it('voegt een cel-filter toe tot het maximum', () => {
    const current = { operator: 'startsWith', value: 'S', secondaryValue: '' };
    const added = appendColumnFilterRule(
      textColumn,
      current,
      { operator: 'notContains', value: 'closed', secondaryValue: '' },
    );
    expect(added.rules).toHaveLength(2);

    let next = added;
    for (let i = 0; i < 6; i += 1) {
      next = appendColumnFilterRule(
        textColumn,
        next,
        { operator: 'contains', value: `n${i}`, secondaryValue: '' },
      );
    }
    expect(extractValueRules(textColumn, next)).toHaveLength(MAX_COLUMN_FILTER_RULES);
  });

  it('laat een legacy kleurfilter als kleurfilter staan', () => {
    const filter = { operator: COLOR_FILTER_OPERATOR, colors: ['#00ff00'], value: '', secondaryValue: '' };
    expect(extractValueRules(textColumn, filter)).toEqual([]);
    expect(extractColorFilter(filter)).toEqual(['#00ff00']);
  });
});
