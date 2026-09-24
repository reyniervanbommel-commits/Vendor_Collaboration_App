/**
 * Comment-rechten (#AB:328). Bewust niet in PAGE_PERMISSIONS, anders verschijnen ze
 * als instellingen-tab.
 */
export const COMMENT_PERMISSIONS = Object.freeze([
  { id: 'comments.view', label: 'View comments' },
  { id: 'comments.write', label: 'Add comments' },
  { id: 'comments.column', label: 'Show comments column' },
]);

export const COMMENT_PERMISSION_IDS = Object.freeze(COMMENT_PERMISSIONS.map((item) => item.id));

const COMMENT_ID_SET = new Set(COMMENT_PERMISSION_IDS);

/**
 * Vinkje-regels: Add en Column zetten View aan; View uit zet de andere twee uit.
 * @param {string[]} selected
 * @param {string} id
 * @returns {string[]}
 */
export function applyCommentPermissionToggle(selected, id) {
  const next = new Set(selected);
  const turningOn = !next.has(id);
  if (turningOn) {
    next.add(id);
    if (id === 'comments.write' || id === 'comments.column') next.add('comments.view');
  } else {
    next.delete(id);
    if (id === 'comments.view') {
      next.delete('comments.write');
      next.delete('comments.column');
    }
  }
  return [...next];
}

export function isCommentPermissionId(id) {
  return COMMENT_ID_SET.has(id);
}
