import { describe, expect, it } from 'vitest';
import { activityItemKey, mergeNewest, normalizeRemarkId, toRemark } from './remarksFormatters';

describe('remarksFormatters', () => {
  it('normaliseert remark-ids uit activity-feed items', () => {
    expect(normalizeRemarkId('remark:42')).toBe(42);
    expect(normalizeRemarkId(7)).toBe(7);
  });

  it('dedupliceert POST-remarks en activity-feed items met dezelfde bron-id', () => {
    const postRemark = { id: 42, body: 'From POST', createdAt: '2026-07-14T09:47:00.000Z' };
    const activityRemark = {
      id: 'remark:42',
      type: 'remark',
      sourceId: '42',
      body: 'From POST',
      createdAt: '2026-07-14T09:47:00.000Z',
    };

    expect(activityItemKey(postRemark)).toBe('remark:42');
    expect(activityItemKey(activityRemark)).toBe('remark:42');
    expect(mergeNewest([postRemark], [activityRemark])).toHaveLength(1);
  });

  it('mapt activity-feed remarks naar remark-objecten met numerieke id', () => {
    const mapped = toRemark({
      id: 'remark:9',
      type: 'remark',
      sourceId: '9',
      body: 'Hello',
      actor: { id: 1, name: 'Reynier van Bommel' },
      createdAt: '2026-07-14T09:47:00.000Z',
    });

    expect(mapped.id).toBe(9);
    expect(mapped.author.displayName).toBe('Reynier van Bommel');
  });

  it('neemt visibility mee uit een activity-remark', () => {
    const mapped = toRemark({ type: 'remark', sourceId: '5', body: 'x', visibility: 'internal' });
    expect(mapped).toMatchObject({ id: 5, visibility: 'internal' });
  });

  it('laat visibility weg als de server die niet stuurt', () => {
    const mapped = toRemark({ type: 'remark', sourceId: '5', body: 'x' });
    expect(mapped).not.toHaveProperty('visibility');
    expect(mapped).not.toHaveProperty('fromVendor');
  });
});
