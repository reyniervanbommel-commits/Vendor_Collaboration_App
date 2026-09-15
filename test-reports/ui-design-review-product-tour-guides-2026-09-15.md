# UI Design Review: Product tour & interactive guides (onboarding)

**Date**: 2026-09-15
**Reviewer**: Claude Code (final-check-feature step 2)
**Mode**: full (static only; shell/header + AppLayout changed, 5+ UI files)
**App URL**: n/a — localhost:5178 DOWN, no browser tooling → **Browser: skipped (static only)**
**Changed files**: `src/components/onboarding/*` (new), `src/styles/motionTokens.js` (new), `src/App.jsx`, `src/components/layout/{AppLayout,AppShellHeader,AppNavItem}.jsx`, `src/components/rccp/{RccpSettingsForm,RccpSettingsFlyout,RccpPageContent,RccpPageHeader,RccpKpiCards}.jsx`, `src/components/supplier/*` (`data-tour` attributes, formula dialog wrapper), `docs/guides/UI_DESIGN_STANDARDS.md`
**Golden reference**: `RccpSettingsFlyout.jsx` (drawer), `ConfirmDialog.jsx` (dialog), `AppLayout.jsx` (shell)

---

## Summary

| Category | Status | Notes |
|----------|--------|-------|
| Static — Fluent & tokens | PASS (with notes) | v9 imports only; tokens broadly used; a few hardcoded colors |
| Static — Forms & layout | PASS | No new form fields; wrapper divs preserve layout |
| Static — Overlays & pitfalls | PASS (with notes) | Drawer anatomy correct; no Tooltip in lists; no Dialog in Menu; z-index of page prompt and a11y inside modal dialogs need attention |
| Browser — visual consistency | SKIPPED | Server down, no Playwright |
| Browser — console | SKIPPED | |

**Verdict**: **VERBETERPUNTEN** (0 BLOCKER, 1 MAJOR, 9 MINOR)

---

## Static findings

| # | Severity | File | Finding | Standard |
|---|----------|------|---------|----------|
| 1 | MAJOR (VERBETERPUNT) | `src/components/onboarding/TourCard.jsx:110-118`, `TourOverlay.jsx:187` | Card is portaled to `document.body`. While a guide runs inside a **modal** Fluent Dialog (formula / date-period guides), tabster's modalizer marks content outside the dialog `aria-hidden`; `useUncontrolledFocus` only fixes Tab focus, not SR visibility. Card may be invisible to screen readers exactly on the guide steps. Verify with a screen reader; if confirmed, mount the card via `Portal mountNode` inside the open `.fui-DialogSurface` for in-dialog steps. | §7 (a11y) |
| 2 | MINOR | `src/components/onboarding/TourPagePrompt.jsx:13` | Prompt uses `tourLayers.overlay` (3100) but is shown independently of Fluent dialogs/drawers other than Welcome/Guides; it floats above a modal Dialog backdrop and stays clickable if the user opens e.g. the formula dialog. Use a z-index below Fluent portals (≈1500-2000) or hide the prompt while a `.fui-DialogSurface`/`.fui-OverlayDrawer` is open. | §4 Overlay rules |
| 3 | MINOR | `src/components/onboarding/onboardingMotion.js:19-23` | `pulseRing` keyframes hardcode `rgba(39,117,206,…)` — not theme/dark-mode aware and bypasses tokens. Animate `opacity`/`transform` of a pseudo-element with `boxShadow: 0 0 0 12px ${tokens.colorBrandStroke1}` instead. | §1 tokens |
| 4 | MINOR | `WelcomeDialog.jsx:34,73,80,87`; `TourCelebration.jsx:38` | Hardcoded `'#fff'` / `rgba(255,255,255,…)` in `makeStyles`. Acceptable visually (hero/badge are always dark navy gradients, so dark mode is fine), but violates "no hex outside brandTokens". Add e.g. `brandColor.onDark` / `onDarkMuted` to `brandTokens.js` or use `tokens.colorNeutralForegroundOnBrand`. | §1 |
| 5 | MINOR | `WelcomeDialog.jsx:154-161` | No `DialogTitle`; surface relies on `aria-label` while the visible heading is a separate `h2`. Give the heading an `id` and use `aria-labelledby` (or render it as `DialogTitle as="h2"`) so accessible name = visible title. | a11y / `ConfirmDialog.jsx` |
| 6 | MINOR | `TourCard.jsx:135` | `aria-live="polite"` is on an element keyed by `step.id-mode`, so the live region is remounted on every step and announcements are unreliable. Move `aria-live` to a stable wrapper (e.g. `styles.inner`) and keep the key on the inner content. | a11y |
| 7 | MINOR | `GuidesDrawer.jsx:57,79-92` | Play affordance is revealed on `:hover` only; keyboard users never see it, and `play` has no reduced-motion fallback. Add `':focus-visible [data-guide-play]'` to the card and `...reducedMotion` to `play`. | §4 Motion |
| 8 | MINOR | `GuidesDrawer.jsx:118-122,145` | Tours with status `skipped` show a **"New"** badge (done only when `completed`). Show no badge (or "Not finished") for skipped tours; reserve "New" for never-seen/version-bumped. | Copy consistency |
| 9 | MINOR | `TourPagePrompt.jsx:45,50` | `aria-label="Offer: …"` and a generic `aria-label="Close"`. Use `aria-labelledby` on the "New here?" text (or `"Tour offer: {title}"`) and `aria-label="Close tour offer"`. | a11y copy |
| 10 | MINOR | `AppShellHeader.jsx:151-160, 206-225` | Same "Guides" action uses `QuestionCircle24Regular` in the header but `BookOpen24Regular` in the avatar menu (and the WelcomeDialog). Also the new button adds `title` while neighbouring header icon buttons only use `aria-label`. Pick one icon for Guides; align tooltip/title approach with the theme toggle. | §2 App shell consistency |
| 11 | MINOR | `onboardingMotion.js:67-72` | `makeStaticStyles` with `!important` (global CSS for a component concern). Justified (overrides hover-only column trigger) and scoped by `[data-tour-reveal]`; document as exception or move to the column-header styles as a `[data-tour-reveal] &` rule. | §1 / checklist "no !important" |
| 12 | OK | `GuidesDrawer.jsx:151-174` | Drawer anatomy matches golden `RccpSettingsFlyout`: `position="end"`, `size="medium"`, `DrawerHeader` + `DrawerHeaderTitle` with subtle `Dismiss24Regular` close (`aria-label="Close guides"`), scrollable `DrawerBody`, no footer (no actions). Sentence-case title. | §4 Drawer anatomy |
| 13 | OK | `RccpSettingsForm.jsx:52-91` | New `panel` wrapper replicates root's `flex column + gap spacingVerticalL`, so fragment-returning children (`RccpSettingsDisplayFields`) keep identical spacing. No visual change. | — |
| 14 | OK | `PurchaseOrderFormulaColumnDialog.jsx:243-249` | `<div data-tour="formula-help">` wraps a single flex-column child in a 14px-gap column; spacing unchanged. | — |
| 15 | OK | all `data-tour` additions | Attributes on Fluent `Field`, `Tab`, `Button`, `DialogSurface`, `DialogActions` pass through to root DOM; no styling impact. | §4 Product tours |
| 16 | OK | onboarding/* | Fluent v9 imports only; no `<Tooltip>` in `.map()`; no Dialog inside Menu; all user-visible strings English; all components ≤300 lines (max `guidesBoard.js` 298 data, `TourCard.jsx` 229). | §5, app-taal |
| 17 | OK | `TourSpotlight.jsx`, `tourCardStyles.js`, `TourCelebration.jsx`, `WelcomeDialog.jsx` | Surfaces use `colorNeutralBackground1`, `colorNeutralStroke2`, `shadow28`, `colorBackgroundOverlay`, brand tokens → dark-mode safe. Animations use `motion` tokens with `prefers-reduced-motion` fallback (CSS) plus JS `prefersReducedMotion()` for tween/confetti. | §4 Motion |
| 18 | OK | `TourCard.jsx` | `role="dialog"`, `aria-labelledby`, labelled close button ("End guide"/"Close tour"), primary action focused on info steps, Esc/arrow keys handled in `TourOverlay`. | a11y |

---

## Browser findings

| # | Severity | Check | Result | Notes |
|---|----------|-------|--------|-------|
| 1 | | Input width | N/A | No new inputs |
| 2 | | Drawer/header anatomy | SKIPPED | Static: PASS |
| 3 | | Overlay z-index / clipping | SKIPPED | Static risk: finding #2 |
| 4 | | Dark mode / 375px | SKIPPED | Static: WelcomeDialog features grid collapses at 520px; card `maxWidth: calc(100vw - 24px)` |

**Screenshots**: none (static only)

---

## Comparison with golden reference

| Aspect | Golden reference | This feature | Match |
|--------|------------------|--------------|-------|
| Drawer position/size | `RccpSettingsFlyout`: end, medium | GuidesDrawer: end, medium | Yes |
| Drawer header + close | `DrawerHeaderTitle action` subtle Dismiss24, aria-label | Same | Yes |
| Drawer body scroll | `DrawerBody` | `DrawerBody` | Yes |
| Dialog title | `ConfirmDialog`: `DialogTitle` | WelcomeDialog: custom hero `h2` + `aria-label` | No (finding #5) |
| Dialog button order | Secondary then primary (right) | "Maybe later", "Browse guides", "Take the tour" (primary right) | Yes |
| Header actions | Subtle icon buttons with `aria-label` | Same, plus `title` | Partly (finding #10) |

---

## Recommended fixes (priority order)

1. [MAJOR] Verify screen-reader visibility of the tour card during in-dialog guide steps; mount card inside the dialog surface if hidden (#1).
2. [MINOR] Lower TourPagePrompt z-index or suppress it while a Fluent modal is open (#2).
3. [MINOR] Replace hardcoded rgba in `pulseRing` with token-based animation (#3); move `#fff`/rgba to `brandTokens` (#4).
4. [MINOR] a11y polish: WelcomeDialog `aria-labelledby` (#5), stable `aria-live` (#6), focus-visible play icon (#7), prompt labels (#9).
5. [MINOR] Copy/icon consistency: "New" badge for skipped tours (#8), single Guides icon (#10), document `!important` exception (#11).

---

## Limitations

- [x] Auth: not tested
- [x] Browser unavailable (localhost:5178 down, no Playwright in session) — static review only
- [ ] Dark mode and 375px checks deferred to `browser-feature-test`
