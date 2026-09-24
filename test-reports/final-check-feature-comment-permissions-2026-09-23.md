# Final check — comment permissions (#328)

**Date**: 2026-09-23
**Scope**: 31 files vs `develop`, plus one uncommitted export cleanup

## Skills

Called: ui-design-review (standard), perf-review (regression → static only), security-review subagent, browser-feature-test, project-cleanup (narrow).

## Verdicts

| Part | Verdict |
|------|---------|
| Own checks | fix applied for unused exports; size warnings remain |
| UI | VERBETERPUNTEN (dialog not opened) |
| Speed | static only |
| Security | one medium, no high/critical |
| Browser | stopped at login |
| Cleanup | nothing to delete |

## Done

Unused server exports removed from `commentPermissions.js` (not committed).

## Open

- Same-role PATCH can turn comment rights back on (`ensureCommentPermissions`).
- Files already over 300 lines: page hook, admin route, data route.
- Preview login needs a real account before the dialog can be checked in the browser.
