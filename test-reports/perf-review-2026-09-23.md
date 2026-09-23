# Perf review — comment permissions

**Date**: 2026-09-23
**Mode**: regression (intended) — **static only**
**URL**: preview (login blocked)

No timings. Localhost was not started. Preview sign-in failed, so board load and tab switch were not measured. No baseline update.

## Static

| Finding | Place | Estimate |
|---------|--------|----------|
| One permission list query per request, memoized on the request, wrapped in `perm_check` | `hasCommentPermission` | Small extra on remarks and board-read; not per row |
| No new client fetch; flags come from the session already loaded | `useCommentPermissions` | No extra roundtrip |
| Board read cache key includes whether the remarks column is hidden | `readInflightKey` | Same user does not share a filtered and unfiltered payload |

**Verdict**: static only — not a measured regression.
