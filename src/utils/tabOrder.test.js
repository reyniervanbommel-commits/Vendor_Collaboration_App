import { describe, expect, it } from 'vitest';
import {
  moveId,
  moveIdRelative,
  orderItemsByIds,
  sortItemsByName,
} from './tabOrder';

describe('tabOrder', () => {
  it('ordent items volgens ids en zet onbekende achteraan in originele volgorde', () => {
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    expect(orderItemsByIds(items, ['3', '1']).map((item) => item.id)).toEqual([3, 1, 2, 4]);
    expect(orderItemsByIds(items, []).map((item) => item.id)).toEqual([1, 2, 3, 4]);
  });

  it('verplaatst een id een stap of naar begin/eind', () => {
    const ids = ['a', 'b', 'c'];
    expect(moveId(ids, 'b', 'left')).toEqual(['b', 'a', 'c']);
    expect(moveId(ids, 'b', 'right')).toEqual(['a', 'c', 'b']);
    expect(moveId(ids, 'c', 'start')).toEqual(['c', 'a', 'b']);
    expect(moveId(ids, 'a', 'end')).toEqual(['b', 'c', 'a']);
    expect(moveId(ids, 'a', 'left')).toBe(ids);
  });

  it('verplaatst relatief voor of na een doel (slepen)', () => {
    const ids = ['a', 'b', 'c', 'd'];
    expect(moveIdRelative(ids, 'a', 'c', 'after')).toEqual(['b', 'c', 'a', 'd']);
    expect(moveIdRelative(ids, 'd', 'b', 'before')).toEqual(['a', 'd', 'b', 'c']);
    expect(moveIdRelative(ids, 'a', 'a', 'after')).toBe(ids);
  });

  it('sorteert natuurlijk op naam, oplopend en aflopend', () => {
    const items = ['Week 10', 'week 2', 'Alpha'].map((name) => ({ name }));
    expect(sortItemsByName(items, 'asc').map((item) => item.name)).toEqual(['Alpha', 'week 2', 'Week 10']);
    expect(sortItemsByName(items, 'desc').map((item) => item.name)).toEqual(['Week 10', 'week 2', 'Alpha']);
  });

  it('sorteert binnen groepen zonder de groepsposities te wijzigen', () => {
    const items = [
      { name: 'Zeta', g: 'status' },
      { name: 'Beta', g: 'vendor' },
      { name: 'Alpha', g: 'status' },
      { name: 'Alpha', g: 'vendor' },
    ];
    const sorted = sortItemsByName(items, 'asc', { getGroupKey: (item) => item.g });
    expect(sorted.map((item) => `${item.g}:${item.name}`)).toEqual([
      'status:Alpha', 'vendor:Alpha', 'status:Zeta', 'vendor:Beta',
    ]);
  });
});
