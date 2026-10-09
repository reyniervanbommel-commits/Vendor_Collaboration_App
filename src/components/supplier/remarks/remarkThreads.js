import { normalizeRemarkId } from './remarksFormatters';

const sameId = (a, b) => String(normalizeRemarkId(a)) === String(normalizeRemarkId(b));

function asRoot(remark) {
  return { ...remark, replies: remark.replies || [], replyCount: remark.replyCount ?? (remark.replies || []).length };
}

/**
 * Voegt nieuwe remarks (roots en replies) samen met de geladen gesprekken. Een reply komt
 * onderaan zijn gesprek en schuift dat gesprek naar voren; een onbekend gesprek → missingRoot.
 */
export function mergeThreadItems(current, incoming) {
  let items = [...current];
  let missingRoot = false;
  // Oudste eerst verwerken zodat de nieuwste activiteit vooraan eindigt.
  [...incoming].reverse().forEach((remark) => {
    if (remark.parentId == null) {
      if (items.some((item) => sameId(item.id, remark.id))) return;
      items = [asRoot(remark), ...items];
      return;
    }
    const index = items.findIndex((item) => sameId(item.id, remark.parentId));
    if (index < 0) {
      missingRoot = true;
      return;
    }
    const thread = items[index];
    if (thread.replies.some((r) => sameId(r.id, remark.id))) return;
    const replies = [...thread.replies, remark];
    const updated = { ...thread, replies, replyCount: replies.length, lastActivityAt: remark.createdAt };
    items = [updated, ...items.slice(0, index), ...items.slice(index + 1)];
  });
  return { items, missingRoot };
}

export function updateRemarkInThreads(items, remarkId, updater) {
  return items.map((item) => {
    if (sameId(item.id, remarkId)) {
      return { ...updater(item), replies: item.replies, replyCount: item.replyCount };
    }
    if (!item.replies?.some((r) => sameId(r.id, remarkId))) return item;
    return {
      ...item,
      replies: item.replies.map((r) => (sameId(r.id, remarkId) ? updater(r) : r)),
    };
  });
}
