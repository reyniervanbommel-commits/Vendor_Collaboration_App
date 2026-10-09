'use strict';

function iso(value) {
  return value ? new Date(value).toISOString() : null;
}

function mapRemarkRows(rows, actor) {
  const byId = new Map();
  for (const row of rows || []) {
    const id = Number(row.id);
    if (!byId.has(id)) {
      const isDeleted = Boolean(row.is_deleted);
      byId.set(id, {
        id,
        partitionKey: row.partition_key,
        recordKey: row.record_key,
        column: row.column_id ? {
          id: Number(row.column_id),
          key: row.column_key,
          label: row.column_label,
        } : null,
        body: isDeleted ? null : row.body,
        isDeleted,
        author: row.created_by ? {
          id: Number(row.created_by),
          displayName: row.author_name || null,
        } : null,
        createdAt: iso(row.created_at),
        deletedAt: iso(row.deleted_at),
        parentId: row.parent_id ? Number(row.parent_id) : null,
        lastActivityAt: iso(row.last_activity_at || row.created_at),
        broadcastId: row.broadcast_id || null,
        mentions: !isDeleted && row.mentions_json ? JSON.parse(row.mentions_json) : [],
        // Vendors zien niet op hoeveel PO's (van andere vendors) een @mention-opmerking staat.
        ...(row.broadcast_id && !actor?.isSupplier ? { broadcastCount: Number(row.broadcast_count) || 0 } : {}),
        reactions: [],
        // Alleen admin/supply_chain zien voor wie een remark is (badges in de UI).
        ...(actor?.seesVisibility ? {
          visibility: row.visibility,
          fromVendor: row.author_role === 'supplier',
        } : {}),
        // Suppliers mogen nooit remarks verwijderen, ook niet hun eigen (server blokkeert dit ook in deleteRemark).
        canDelete: !isDeleted && !actor?.isSupplier && Boolean(
          actor?.isAdmin || Number(row.created_by) === Number(actor?.id)
        ),
      });
    }
    if (row.emoji) {
      byId.get(id).reactions.push({
        emoji: row.emoji,
        count: Number(row.reaction_count),
        reactedByCurrentUser: Boolean(row.reacted_by_current_user),
      });
    }
  }
  return [...byId.values()];
}

module.exports = { iso, mapRemarkRows };
