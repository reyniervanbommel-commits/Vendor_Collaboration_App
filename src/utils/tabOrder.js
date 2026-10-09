// Pure ordering helpers for tab strips (pinned views + column view tabs). Work on id lists.

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Items ordered by `ids`; items missing from `ids` keep their original order at the end.
 */
export function orderItemsByIds(items, ids, getId = (item) => String(item.id)) {
  const rank = new Map((ids || []).map((id, index) => [String(id), index]));
  return items
    .map((item, index) => ({ item, index, rank: rank.has(getId(item)) ? rank.get(getId(item)) : Infinity }))
    .sort((a, b) => (a.rank - b.rank) || (a.index - b.index))
    .map((entry) => entry.item);
}

/** Moves `id` one step left/right or to the start/end. Returns the same list when nothing changes. */
export function moveId(ids, id, move) {
  const from = ids.indexOf(id);
  if (from < 0) return ids;
  const to = {
    start: 0,
    left: from - 1,
    right: from + 1,
    end: ids.length - 1,
  }[move];
  if (to === undefined || to < 0 || to >= ids.length || to === from) return ids;
  const next = ids.slice();
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/** Moves `sourceId` directly before/after `targetId` (drag & drop). */
export function moveIdRelative(ids, sourceId, targetId, position = 'before') {
  if (sourceId === targetId || !ids.includes(sourceId) || !ids.includes(targetId)) return ids;
  const next = ids.filter((id) => id !== sourceId);
  const targetIndex = next.indexOf(targetId) + (position === 'after' ? 1 : 0);
  next.splice(targetIndex, 0, sourceId);
  return next;
}

/**
 * Sorts by name (natural: "Week 2" before "Week 10"). With `getGroupKey`, each group is sorted
 * within the slots it already occupies, so groups keep their place in the strip.
 */
export function sortItemsByName(items, direction = 'asc', {
  getName = (item) => item.name,
  getGroupKey = () => '',
} = {}) {
  const sign = direction === 'desc' ? -1 : 1;
  const slotsByGroup = new Map();
  items.forEach((item, index) => {
    const key = getGroupKey(item);
    if (!slotsByGroup.has(key)) slotsByGroup.set(key, []);
    slotsByGroup.get(key).push(index);
  });
  const next = items.slice();
  slotsByGroup.forEach((slots) => {
    const sorted = slots
      .map((index) => items[index])
      .sort((a, b) => sign * collator.compare(String(getName(a) || ''), String(getName(b) || '')));
    slots.forEach((slot, i) => { next[slot] = sorted[i]; });
  });
  return next;
}
