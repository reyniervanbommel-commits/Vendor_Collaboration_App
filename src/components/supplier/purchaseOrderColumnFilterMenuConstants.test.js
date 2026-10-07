import { describe, expect, it } from 'vitest';
import { getColumnSourceMeta, getDraftFromFilter, getDraftsFromFilter, getStickyColumnMenuText, isColumnFilterActive } from './purchaseOrderColumnFilterMenuConstants';

describe('purchaseOrderColumnFilterMenuConstants — oneOf', () => {
  const textColumn = { key: 'vendor', dataType: 'text' };

  it('getDraftFromFilter geeft een lege array voor een nieuw oneOf-filter', () => {
    const draft = getDraftFromFilter(textColumn, { operator: 'oneOf' });
    expect(draft.value).toEqual([]);
  });

  it('getDraftFromFilter geeft de bestaande oneOf-array door', () => {
    const draft = getDraftFromFilter(textColumn, { operator: 'oneOf', value: ['Acme', 'Beta'] });
    expect(draft.value).toEqual(['Acme', 'Beta']);
  });

  it('getDraftFromFilter zonder filter gebruikt de kolom-default (contains) met string-waarde', () => {
    const draft = getDraftFromFilter(textColumn, null);
    expect(draft).toEqual({ operator: 'contains', value: '', secondaryValue: '' });
  });

  it('getDraftsFromFilter maakt een draft per AND-voorwaarde', () => {
    const drafts = getDraftsFromFilter(textColumn, {
      rules: [
        { operator: 'startsWith', value: 'S' },
        { operator: 'notContains', value: 'closed' },
      ],
    });
    expect(drafts).toEqual([
      { operator: 'startsWith', value: 'S', secondaryValue: '' },
      { operator: 'notContains', value: 'closed', secondaryValue: '' },
    ]);
  });

  it('isColumnFilterActive is alleen actief met een niet-lege oneOf-array', () => {
    expect(isColumnFilterActive(textColumn, { operator: 'oneOf', value: [] })).toBe(false);
    expect(isColumnFilterActive(textColumn, { operator: 'oneOf', value: ['Acme'] })).toBe(true);
  });
});

describe('getColumnSourceMeta', () => {
  it('laat connected-status de D365-bron niet overschrijven', () => {
    expect(getColumnSourceMeta({
      source: 'd365',
      level: 'header',
      label: 'Amount',
    })).toEqual({
      key: 'purchase-orders',
      label: 'Purchase orders · Amount',
    });
  });
});

describe('getStickyColumnMenuText', () => {
  it('gebruikt Make sticky voor een niet-sticky kolom', () => {
    expect(getStickyColumnMenuText({ canUnstickSticky: false, isStickyColumn: false })).toBe('Make sticky');
  });

  it('gebruikt Unstick column wanneer losmaken mag', () => {
    expect(getStickyColumnMenuText({ canUnstickSticky: true, isStickyColumn: true, stickyColumnCount: 2 })).toBe('Unstick column');
  });
});
