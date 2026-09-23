# UI Design Review: Comment permissions

**Date**: 2026-09-23
**Reviewer**: Cursor Agent
**Mode**: standard
**App URL**: https://preview-comment-permissions.graysand-65442c41.northeurope.azurecontainerapps.io/
**Changed files**: admin permissions dialog and checklist, board remarks gates, permission notice, tours
**Golden reference**: existing `EditPermissionsDialog` / `PermissionsChecklist` (admin dialog, not a new settings form)

---

## Summary

| Category | Status | Notes |
|----------|--------|-------|
| Static — Fluent & tokens | PASS | Checkbox, Dialog, MessageBar, tokens on section headings |
| Static — Forms & layout | PASS | Comments section sits in the existing dialog; no new full-bleed inputs |
| Static — Overlays & pitfalls | PASS | English UI strings; no Tooltip in a list; dialog not nested in a menu |
| Browser — visual consistency | SKIPPED | Preview login rejected the local admin account; dialog not opened |
| Browser — console | SKIPPED | Same login stop |

**Verdict**: VERBETERPUNTEN

---

## Static findings

| # | Severity | File | Finding | Standard |
|---|----------|------|---------|----------|
| 1 | OK | `EditPermissionsDialog.jsx` | Title, message, Cancel/Save, vendor-only Comments section | §4 overlays |
| 2 | OK | `PermissionsChecklist.jsx` | Comments heading uses the same token styles as settings sections | tokens |
| 3 | OK | `CommentPermissionNotice.jsx` | English MessageBar | app language |
| 4 | VERBETERPUNT | `usePurchaseOrdersPage.js`, `admin.js`, `data.js` | Already far over 300 lines; this feature added a small amount | component size |

---

## Browser findings

| # | Severity | Check | Result | Notes |
|---|----------|-------|--------|-------|
| 1 | | Permissions dialog | SKIPPED | Sign-in stopped on “Email address or password is incorrect” |
| 2 | | Login page | N/A | Not part of this diff |

Screenshot of the login stop: `playwright/screenshots/ui-review-comment-permissions.png` (browser temp copy).
