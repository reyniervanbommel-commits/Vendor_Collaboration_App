# Motion-stijl app-navigatie gelijktrekken met guides-drawer (DevOps)

**Work item:** Feature [#315](https://reyniervanbommel0745.visualstudio.com/Vendor-App/_workitems/edit/315)
**Doel:** Trek de motion-stijl van de guides-drawer (golden reference) door naar de overige nav- en flyout-componenten van de app, zodat animaties consistent, toegankelijk (reduced-motion) en performant (transform/opacity-only) zijn over de hele navigatie.
**Referentie in repo:** [docs/specs/dev_2026-09-15-sidebar-motion-alignment-plan.md](../specs/dev_2026-09-15-sidebar-motion-alignment-plan.md)
**Tags:** motion; ui-polish; fluent-ui; accessibility; tech-debt

---

## Doel (geen klassieke user story — technical-debt/UI-polish)

Het huidige nav-oppervlak (`AppLayout`, `AdminSettingsSidebar`, `SidebarNavItem`, diverse flyouts) mist de motion-kwaliteit van de guides-drawer (`GuidesDrawer.jsx`). Dit werk trekt dat gelijk zonder de onboarding-code te wijzigen, via gedeelde motion-helpers.

---

## Acceptatiecriteria (definitie van "klaar")

1. AppLayout-paneel + backdrop animeren in met slide/fade; de rail heeft bewust geen enter-animatie.
2. Reduced-motion (DevTools-emulatie) toont geen beweging in alle 7 aangepaste componenten.
3. `npm test` en `npm run build` slagen; `tours.test.js`, `TourOverlay.test.jsx`, `AppShellHeader.test.jsx` blijven groen.
4. Geen component boven de 300-regel-limiet; `AppLayout.jsx` is gesplitst naar `appLayoutStyles.js` vóór motion wordt toegevoegd.
5. Rapid toggle (2-3x snel achter elkaar openen/sluiten) geeft geen visuele glitch/flicker.

**Bewust besloten:** Route A (enter-only animatie). Route B (Fluent `OverlayDrawer` met enter+exit) is apart vervolgwerk, geen AC in deze scope.

---

## Wat is al gedaan (geen DevOps-tasks meer nodig tenzij verificatie)

| Item | Locatie |
|------|---------|
| Golden reference motion (guides-drawer) | `src/components/onboarding/GuidesDrawer.jsx`, `src/styles/motionTokens.js`, `src/components/onboarding/onboardingMotion.js` |
| Plan gereviewd via `review-plan-for-devops` (2026-09-15) | `docs/specs/2026-09-15-sidebar-motion-alignment-plan.md` |

---

## Backlog — child User Stories

### Story #316: Motion-fundament — gedeelde helpers naar `src/styles/motionStyles.js`
**Beschrijving:** Verplaats `reducedMotion`, `enterAnimation` en `keyframes` uit `onboardingMotion.js` naar nieuw `src/styles/motionStyles.js`. Voeg nieuw toe: `keyframes.slideInLeft`, `keyframes.slideInRight`, `staggerDelay(index)`, `interactiveTransition(properties)`. `onboardingMotion.js` wordt dunne re-export-shim. Nieuwe test `motionStyles.test.js`.
**Acceptatiecriteria:**
1. `npm test` blijft groen (`tours.test.js`, `TourOverlay.test.jsx`); `npm run build` slaagt.
2. Geen gedragswijziging aan de 8 bestaande onboarding-bestanden.

### Story #317: AppLayout + AppNavItem — paneel-motion (slide-in, fade, stagger)
**Beschrijving:** Split `AppLayout.jsx` naar `appLayoutStyles.js` vóór motion wordt toegevoegd. Paneel krijgt `slideInLeft`, backdrop `fadeIn`, railTooltip `interactiveTransition`. `AppNavItem` krijgt opt-in stagger, alleen in het paneel (niet de rail). `data-tour="nav-rail"` blijft op de rail-`aside`.
**Acceptatiecriteria:**
1. AC1 + AC5 uit de Feature.
2. `AppLayout.jsx` en `appLayoutStyles.js` blijven onder de 300-regel-limiet; `tours.test.js` blijft groen.

### Story #318: SidebarNavItem + AdminSettingsSidebar — motion-tokens en stagger
**Beschrijving:** `SidebarNavItem.jsx`: hardgecodeerde transitions vervangen door `interactiveTransition`; opt-in `animationDelay`-prop. `AdminSettingsSidebar.jsx`: `slideInLeft` + stagger via doorlopende teller.
**Acceptatiecriteria:**
1. Reduced-motion-fallback aanwezig.
2. Geen regressie op andere gebruikers van `SidebarNavItem` (opt-in only); `animationDelay` is een stabiele string (memo-vriendelijk).

### Story #323: Flyouts — RccpSettingsFlyout, PurchaseOrdersActiveRulesFlyout, ChartBuilderFlyout
**Beschrijving:** Content-laag rise-in/stagger per flyout, zonder de Fluent Drawer-surface zelf te overschrijven. `ChartBuilderFlyout` krijgt `slideInRight`, geen `width`-animatie (reflow-risico).
**Acceptatiecriteria:**
1. AC2 + AC5 uit de Feature.
2. Geen `overflow: hidden` op scroll-containers binnen de secties.

### Story #324: Docs-update en versiebump — UI_DESIGN_STANDARDS.md + version.js
**Beschrijving:** `UI_DESIGN_STANDARDS.md` §4/§6 uitbreiden met motion-recepten en golden reference; stale `RccpDrillDownPanel.jsx`-referentie herstellen. Versiebump `v1.61.5 → v1.62.0`. Afsluiten met `browser-feature-test` + `ui-design-review` (volle modus).
**Acceptatiecriteria:**
1. AC3 + AC4 uit de Feature.
2. Geen stale referenties meer in `UI_DESIGN_STANDARDS.md`.

---

## Versie document

Aangemaakt op basis van [docs/specs/dev_2026-09-15-sidebar-motion-alignment-plan.md](../specs/dev_2026-09-15-sidebar-motion-alignment-plan.md); wijzig dit bestand bij nieuwe afspraken.
