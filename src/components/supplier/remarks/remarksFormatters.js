export const REACTION_EMOJIS = ['👍', '😊', '🎉', '❤️', '😂', '😮'];

export function rowKey(partitionKey, recordKey) {
  return `${partitionKey ?? ''}\u0000${recordKey ?? ''}`;
}

export function formatDateTime(value) {
  if (!value) return 'Unknown time';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function formatDayLabel(value, now = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  const current = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const item = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDifference = Math.round((current.getTime() - item.getTime()) / 86400000);
  if (dayDifference === 0) return 'Today';
  if (dayDifference === 1) return 'Yesterday';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(date);
}

export function getActivityTimestamp(item) {
  return item?.createdAt || item?.at || item?.changedAt || null;
}

export function isRemarkActivity(item) {
  return item?.kind === 'remark' || item?.type === 'remark' || Boolean(item?.remark);
}

export function normalizeRemarkId(id) {
  if (id == null || id === '') return id;
  const stringId = String(id);
  const colonIndex = stringId.indexOf(':');
  const normalized = colonIndex >= 0 ? stringId.slice(colonIndex + 1) : stringId;
  return /^\d+$/.test(normalized) ? Number(normalized) : normalized;
}

export function activityItemKey(item) {
  const kind = item?.type || item?.kind || 'remark';
  const id = item?.sourceId != null ? String(item.sourceId) : normalizeRemarkId(item?.id);
  return `${kind}:${id ?? ''}`;
}

export function toRemark(item) {
  if (!item) return item;
  if (item.remark) {
    return { ...item.remark, id: normalizeRemarkId(item.remark.id) };
  }
  if (item.type === 'remark' || item.kind === 'remark') {
    return {
      id: normalizeRemarkId(item.sourceId ?? item.id),
      body: item.body,
      isDeleted: item.isDeleted,
      author: item.author
        ?? (item.actor
          ? { id: item.actor.id, displayName: item.actor.name || item.actor.displayName || null }
          : null),
      createdAt: item.createdAt,
      column: item.column ?? (item.columnId ? { id: item.columnId, label: item.columnLabel } : null),
      reactions: item.reactions ?? [],
      canDelete: item.canDelete,
      ...(item.visibility ? { visibility: item.visibility } : {}),
    };
  }
  return { ...item, id: normalizeRemarkId(item.id) };
}

export function mergeNewest(current, incoming) {
  const seen = new Set();
  return [...incoming, ...current].filter((item) => {
    const key = activityItemKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function mergeOlder(current, incoming) {
  const seen = new Set(current.map((item) => activityItemKey(item)));
  return [
    ...current,
    ...incoming.filter((item) => {
      const key = activityItemKey(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  ];
}
