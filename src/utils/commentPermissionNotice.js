const EVENT = 'comment-permissions-changed';
let notified = false;

/** Eén melding per sessie wanneer de server een comment-recht weigert. */
export function noteCommentPermissionDenied(error) {
  if (error?.status !== 403) return false;
  if (!notified && typeof window !== 'undefined') {
    notified = true;
    window.dispatchEvent(new CustomEvent(EVENT));
  }
  return true;
}

export const COMMENT_PERMISSION_CHANGED_EVENT = EVENT;
