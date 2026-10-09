import { describe, expect, it } from 'vitest';
import { mergeThreadItems, updateRemarkInThreads } from './remarkThreads';

const root = (id, extra = {}) => ({ id, parentId: null, replies: [], replyCount: 0, createdAt: '2026-10-01T10:00:00Z', ...extra });
const reply = (id, parentId, createdAt = '2026-10-07T10:00:00Z') => ({ id, parentId, createdAt, body: `r${id}` });

describe('mergeThreadItems', () => {
  it('zet een nieuwe root vooraan en dedupliceert', () => {
    const { items } = mergeThreadItems([root(1)], [root(2), root(1)]);
    expect(items.map((i) => i.id)).toEqual([2, 1]);
    expect(items[0].replies).toEqual([]);
  });

  it('hangt een reply aan zijn gesprek en schuift dat naar voren', () => {
    const { items, missingRoot } = mergeThreadItems([root(2), root(1)], [reply(9, 1)]);
    expect(missingRoot).toBe(false);
    expect(items.map((i) => i.id)).toEqual([1, 2]);
    expect(items[0]).toMatchObject({ replyCount: 1, lastActivityAt: '2026-10-07T10:00:00Z' });
    expect(items[0].replies.map((r) => r.id)).toEqual([9]);
  });

  it('dedupliceert een reply die al in het gesprek staat', () => {
    const start = [root(1, { replies: [reply(9, 1)], replyCount: 1 })];
    const { items } = mergeThreadItems(start, [reply(9, 1)]);
    expect(items[0].replies).toHaveLength(1);
  });

  it('meldt missingRoot voor een reply op een niet-geladen gesprek', () => {
    const { items, missingRoot } = mergeThreadItems([root(1)], [reply(9, 77)]);
    expect(missingRoot).toBe(true);
    expect(items.map((i) => i.id)).toEqual([1]);
  });
});

describe('updateRemarkInThreads', () => {
  it('werkt een root bij en behoudt zijn replies', () => {
    const start = [root(1, { replies: [reply(9, 1)] })];
    const items = updateRemarkInThreads(start, 1, () => ({ id: 1, isDeleted: true, parentId: null }));
    expect(items[0]).toMatchObject({ isDeleted: true });
    expect(items[0].replies).toHaveLength(1);
  });

  it('werkt een reply binnen het gesprek bij', () => {
    const start = [root(1, { replies: [reply(9, 1)] })];
    const items = updateRemarkInThreads(start, 9, (r) => ({ ...r, reactions: [{ emoji: '👍', count: 1 }] }));
    expect(items[0].replies[0].reactions).toHaveLength(1);
  });
});
