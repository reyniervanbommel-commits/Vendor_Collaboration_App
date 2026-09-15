# UI Design Standards — Van Bommel App Template

Single source of truth for Fluent UI v9 design consistency. Used by the `ui-design-review` skill and team personas (UI Engineer, Design Lead).

**Official references:** [Fluent 2 design principles](https://fluent2.microsoft.design/design-principles) · [Fluent UI v9 tokens](https://github.com/microsoft/fluentui/blob/master/docs/architecture/design-tokens.md) · [Drawer usage](https://fluent2.microsoft.design/components/web/react/core/drawer/usage) · [Field usage](https://fluent2.microsoft.design/components/web/react/core/field/usage)

---

## 1. Theming & styling

| Rule | Microsoft | This project |
|------|-----------|--------------|
| Package | `@fluentui/react-components` only | Never `@fluentui/react` (v8) |
| Colors & spacing | `tokens.*` from `@fluentui/react-theme` | No hardcoded hex in `makeStyles` except `src/styles/brandTokens.js` and theme files |
| Styling API | `makeStyles` at module level | No `mergeStyles`, no global CSS for component-specific styles |
| Class merging | `mergeClasses` once per element | User `className` last in `mergeClasses` |
| Layout | Flex/grid via `makeStyles` | No `Stack` (removed in v9) |
| Provider | App wrapped in `FluentProvider` | See `main.jsx` |

---

## 2. Layout & page structure

### App shell (golden reference: `src/components/layout/AppLayout.jsx`)

- Persistent **left rail** for primary navigation
- Fixed **header** height from `brandTokens.layout.headerHeight`
- Content area scrolls independently
- Do not add a second primary navigation pattern (no top nav + side nav together)

### Content max-widths

Microsoft: input width should match expected content length. In v9, `Field` stretches its child to 100% of the **Field container** — constrain the container, not fight the Input.

| Context | maxWidth | Golden reference |
|---------|----------|------------------|
| Narrow control (number, short code) | ~168px | `src/components/rccp/RccpQuantityMeasuresEditor.jsx` |
| Standard form / wizard step | ~520px | `src/components/admin/datamodel/excel-link/StepUpload.jsx` |
| Settings / admin page | ~720px | `src/components/admin/AdminODataSettings.jsx` |
| Wide admin (tables inside) | ~920px | `src/components/admin/AdminRccpSettings.jsx` |
| Full-width | Board, data grid, BI dashboard | PO table, `BiPage` |

### Page header pattern (admin/settings)

Golden reference: `AdminODataSettings.jsx`

- Row: title left, primary actions right (`pageHeader` flex)
- Section blocks: `tokens.colorNeutralBackground2`, `borderRadius` 8px, padding 20px
- Section title: `Text` with semibold weight, small margin below
- Status/feedback: color **and** text (never color alone)

### Spacing

Prefer Fluent spacing tokens (`tokens.spacingVerticalM`, `shorthands.gap('16px')`) or `brandTokens.spacing` (8pt grid: 8, 12, 16, 24, 32, 48).

---

## 3. Forms

| Rule | Detail |
|------|--------|
| Always wrap controls in `Field` | Label, hint, `validationMessage` on `Field` |
| Label position | Top-aligned (default); left-aligned only when fields share consistent width |
| Input width | Set `maxWidth` on Field or form container — not full viewport for short values |
| Validation | `Field validationMessage` + optional `MessageBar` at form top for multiple errors |
| UI language | English only — see `.cursor/rules/app-taal.mdc` |

---

## 4. Overlays — when to use what

| Component | Use for | Avoid |
|-----------|---------|-------|
| **Drawer** (`OverlayDrawer` / `Drawer`) | Settings, drill-down, multi-field forms, 2–3 step flows | Long legal text, many nested modals |
| **Dialog** | Confirm destructive actions, short focused tasks | Frequent confirmations inside drawers |
| **Popover** | Short contextual info, small pickers | Complex forms, many fields |
| **Menu** | Column header actions, toolbar commands | Nesting `Dialog` inside `Menu` (Menu unmounts → Dialog disappears) |

### Drawer anatomy (required)

Golden reference: `src/components/rccp/RccpSettingsFlyout.jsx`

1. **DrawerHeader** + **DrawerHeaderTitle** (sentence case, no trailing period)
2. **DrawerBody** — scrollable content; wrap long content so body scrolls
3. **DrawerFooter** (optional) — primary action **left** of secondary buttons (Fluent 2 convention)

Defaults: `position="end"`, `size="medium"` for settings; `size="small"` for simple panels.

### Overlay rules

- Max **one** modal overlay drawer at a time
- Navigation flyouts: left; notifications/context from right — stay consistent
- `z-index`: rail 1500, panel 1800, tooltips/overlays ≥ 2000 — never below decorative elements
- Dropdowns that clip on `overflow: hidden` → portal to `document.body` (see `fluentui-valkuilen.mdc`)

### Documented exception: inline side-panel (BI chart builder)

`src/components/bi/ChartBuilderFlyout.jsx` is a **non-modal inline side-panel** (an `<aside>` that
pushes the dashboard layout rather than overlaying it). It intentionally does **not** use the Fluent
`Drawer`, because it must remain open alongside the live dashboard while editing. It still mirrors the
drawer anatomy manually: header (editable name + close), scrollable body, and its own focus management
(`tabIndex=-1`, `aria-label`, focus restore). New multi-field editors should still prefer `Drawer`
(see `RccpSettingsFlyout.jsx`); use this inline pattern only when simultaneous editing + preview is required.

### Product tours & guides (onboarding)

Golden reference: `src/components/onboarding/` (engine) + `tours.js` (content).

- **Anchors:** point steps at `data-tour="…"` attributes, never at CSS classes or visible text. When you rename
  or move an anchored element, keep its `data-tour` — `tours.test.js` fails when a tour points at an anchor
  that no longer exists.
- **Layers:** tour overlay `z-index` 3100, tour card 3200 (`tourLayers` in `src/styles/motionTokens.js`) —
  above the avatar menu (3000) and Fluent portals.
- **Interaction:** guides never change data themselves; steps inside dialogs end with “Save or Cancel —
  nothing changes until you do”. Action steps wait for the user's own click.
- **New feature?** Add or update a step/guide in `tours.js` and bump that tour's `version` so users are
  offered it again.

### Motion

- Use `motion` tokens from `src/styles/motionTokens.js` (`durationFast` 160 / `durationNormal` 240 /
  `durationSlow` 420 ms, `easeOut`) instead of ad-hoc values.
- Every animation needs a `prefers-reduced-motion: reduce` fallback (see `reducedMotion` in
  `src/components/onboarding/onboardingMotion.js`).

---

## 5. Fluent UI pitfalls (blockers)

See also `.cursor/rules/fluentui-valkuilen.mdc`.

| Issue | Rule |
|-------|------|
| Tooltip in lists | Never `<Tooltip>` inside `.map()` or scrollable panels — use `title` attribute |
| Portal components in lists | No `Menu`/`Popover`/`Tooltip` per row — use shared context menu pattern |
| Dialog inside Menu | Place `Dialog` **outside** Menu hierarchy; control open state separately |
| Nested `.fui-*` selectors | Apply classes directly; avoid tag selectors on Fluent internals |

---

## 6. Golden reference index

| Pattern | File |
|---------|------|
| App shell & navigation | `src/components/layout/AppLayout.jsx` |
| Admin settings page | `src/components/admin/AdminODataSettings.jsx` |
| Settings flyout | `src/components/rccp/RccpSettingsFlyout.jsx` |
| Form with flyout variant | `src/components/rccp/RccpSettingsForm.jsx` |
| Drill-down drawer | `src/components/rccp/RccpDrillDownPanel.jsx` |
| Column filter menu | `src/components/supplier/purchaseOrderColumnFilterMenuStyles.js` |
| Compact dialog | `src/components/shared/ConfirmDialog.jsx` |

When reviewing new UI, compare against the closest golden reference above.

---

## 7. Review severity

| Level | Meaning | Action |
|-------|---------|--------|
| **BLOCKER** | Breaks Fluent rules, a11y, or app-wide consistency | Must fix before merge |
| **VERBETERPUNT** | Works but inconsistent with standards | Fix or document exception |
| **OK** | Matches standards | None |
