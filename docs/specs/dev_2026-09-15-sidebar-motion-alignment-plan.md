# Plan — motion-stijl app-navigatie gelijktrekken met de guides-drawer

> Status: **plan, nog niet uitgevoerd**. Opgesteld door subagent `claude-opus-5-thinking-high` op basis van verkenning van `GuidesDrawer.jsx` (golden reference voor motion) versus achterlopende nav-componenten. Gereviewd via `review-plan-for-devops` op 2026-09-15 (🟡 BIJNA → blockers gefixt, zie onderaan).

## Doel

Trek de motion-stijl van de guides-drawer (golden reference) door naar de overige nav- en flyout-componenten van de app, zodat animaties consistent, toegankelijk (reduced-motion) en performant (transform/opacity-only) zijn over de hele navigatie.

## Acceptatiecriteria

- **AC1:** `AppLayout`-paneel + backdrop animeren in met slide/fade; de rail heeft bewust géén enter-animatie.
- **AC2:** reduced-motion (DevTools-emulatie) toont geen beweging in alle 7 aangepaste componenten.
- **AC3:** `npm test` en `npm run build` slagen; `tours.test.js`, `TourOverlay.test.jsx`, `AppShellHeader.test.jsx` blijven groen.
- **AC4:** geen component boven de 300-regel-limiet; `AppLayout.jsx` is gesplitst naar `appLayoutStyles.js` vóór motion wordt toegevoegd.
- **AC5:** rapid toggle (2-3x snel achter elkaar openen/sluiten van paneel/flyouts) geeft geen visuele glitch/flicker.

## 0. Kernprobleem en gekozen aanpak

De motion-primitives zitten nu **feature-scoped** in `src/components/onboarding/onboardingMotion.js`. Die map importeren vanuit `layout/`, `admin/`, `bi/` en `supplier/` is een verkeerde afhankelijkheidsrichting (layout gaat afhangen van onboarding). Duplicatie is óók geen optie.

**Besluit:** de generieke helpers promoveren naar `src/styles/`, en `onboardingMotion.js` wordt een dunne re-export-shim. Dan blijft de golden reference letterlijk dezelfde code gebruiken als de rest van de app en hoeven de 8 bestaande onboarding-bestanden **niet** te wijzigen.

### Stap 0a — nieuw bestand `src/styles/motionStyles.js` (~85 regels, nieuw)

Bevat (verplaatst uit `onboardingMotion.js`, ongewijzigd gedrag):

| Export | Herkomst / inhoud |
|---|---|
| `reducedMotion` | verplaatst uit `onboardingMotion.js` (`@media (prefers-reduced-motion: reduce)` → `animationName: none`, `transitionDuration: 1ms`) |
| `enterAnimation(name, duration = motion.durationNormal, delay = 0)` | verplaatst uit `onboardingMotion.js`, inclusief de `...reducedMotion`-spread |
| `keyframes` (generiek) | `fadeIn`, `cardIn`, `riseIn`, `contentIn` — verplaatst uit `onboardingMotion.js` |
| `keyframes.slideInLeft` | **nieuw**: `translateX(-16px)` + `opacity 0` → `0/1` (linker nav-paneel, admin-sidebar) |
| `keyframes.slideInRight` | **nieuw**: `translateX(16px)` + `opacity 0` → `0/1` (rechter inline-paneel BI) |
| `staggerDelay(index, base = 60, step = 50, max = 8)` | **nieuw**: vervangt de magic numbers `60 + index * 50` uit `GuidesDrawer.jsx`; `max` klemt de delay zodat lange lijsten niet traag aanvoelen |
| `interactiveTransition(properties, duration = motion.durationFast)` | **nieuw**: geeft `transitionProperty/Duration/TimingFunction` (`motion.easeOut`) + `...reducedMotion` in één spread — vervangt de hardgecodeerde `'0.12s'` / `'0.1s'` / `'140ms'` in de nav-componenten |

Importeert alleen `motion` uit `motionTokens.js`. `motionTokens.js` blijft ongewijzigd (26 regels, blijft token-only zonder Fluent-import).

### Stap 0b — `onboardingMotion.js` omvormen (73 → ~55 regels)

- Houdt tour-only zaken: `useTourPortalStyles`, `useTourRevealStyles`, en de tour-only keyframes `pulseRing`, `hintDot`, `nudge`, `float`, `confetti`.
- Exporteert `keyframes = { ...sharedKeyframes, ...tourKeyframes }` en re-exporteert `enterAnimation` + `reducedMotion`.
- **Gevolg:** `GuidesDrawer.jsx`, `tourCardStyles.js`, `TourCard.jsx`, `TourSpotlight.jsx`, `TourCelebration.jsx`, `WelcomeDialog.jsx`, `TourPagePrompt.jsx`, `TourOverlay.jsx` blijven ongewijzigd → nul regressierisico op de tours.
- Eén kleine opruiming in `GuidesDrawer.jsx` (~1 regel): `style={{ animationDelay: \`${60 + index * 50}ms\` }}` → `staggerDelay(index)`, zodat de golden reference zelf de gedeelde helper demonstreert.

### Stap 0c — nieuwe test `src/styles/motionStyles.test.js` (~45 regels, nieuw)

Pure functies in `src/styles/` vallen onder de kwaliteitspoort-testregel: `enterAnimation` bevat altijd de reduced-motion-media-query, gebruikt `motion.easeOut` en `animationFillMode: 'both'`; `staggerDelay` rekent correct en klemt op `max`; `interactiveTransition` bevat `reducedMotion`.

---

## 1. Per component

### 1.1 `src/components/layout/AppLayout.jsx` — **hoogste prioriteit**

- **Huidige situatie (261 regels, waarvan ~117 `makeStyles`):** het mobiele uitklap-paneel heeft wél `transitionProperty: 'transform, opacity'` met `140ms ease-in-out`, maar het paneel wordt **conditioneel gerenderd** (`{sidebarOpen && …}`) — een CSS-*transition* vuurt niet bij mount, dus het paneel klapt hard in beeld. De backdrop verschijnt zonder fade. `railTooltip` gebruikt hardgecodeerde `0.1s`/`0.7s`. Nergens een reduced-motion-fallback.
- **Gewenste wijziging:**
  1. **Verplicht eerst splitsen:** alle `makeStyles` naar nieuw `src/components/layout/appLayoutStyles.js` (`useAppLayoutStyles`) — conform het bestaande repo-patroon (`purchaseOrderColumnFilterMenuStyles.js`, `tourCardStyles.js`). Zonder split gaat het bestand met motion-toevoegingen boven de 300-regel-limiet.
  2. `panel`: `transition` vervangen door `...enterAnimation(keyframes.slideInLeft, motion.durationNormal)`.
  3. `panelBackdrop`: `...enterAnimation(keyframes.fadeIn, motion.durationFast)`.
  4. `railTooltip`: `transitionDuration: '0.1s'` → `...interactiveTransition(['opacity', 'visibility'])`; de `transitionDelay: 0.7s` blijft (hover-intent), maar krijgt via `reducedMotion` een `1ms`-fallback.
  5. Paneel-items staggeren: `index` doorgeven aan `AppNavItem` (zie 1.2) — **alleen in het paneel, niet in de rail**.
- **Regelimpact:** `AppLayout.jsx` 261 → ~150 regels; nieuw `appLayoutStyles.js` ~135 regels. Netto +~25 regels motion-code.
- **Risico's:**
  - De rail wordt zelf ook conditioneel gerenderd (`{!sidebarOpen && …}`). Geef de **rail geen enter-animatie/stagger**: die zou bij elk sluiten van het paneel opnieuw afspelen. Alleen het paneel + backdrop animeren.
  - `data-tour="nav-rail"` (gebruikt door `pageTours.js`) moet op exact één element blijven staan: de rail-`aside`. Niet dupliceren naar het paneel — `tours.test.js` en de tour-anchors zijn hier gevoelig voor.
  - Er komt **geen exit-animatie** (CSS-keyframes bij unmount kan niet zonder uitgestelde unmount). Bewust accepteren in fase 1; alternatief in §4 hieronder.
  - Alleen `transform`/`opacity` animeren (compositor-vriendelijk) — geen `width`/`left`, dat veroorzaakt layout-thrash op de board-pagina.

### 1.2 `src/components/layout/AppNavItem.jsx`

- **Huidige situatie (46 regels):** puur presentational, geen eigen styles (krijgt `styles` van de parent), geen motion.
- **Gewenste wijziging:** optionele prop `index` (of `animationDelay`) toevoegen en — net als `GuideCard` in de golden reference — als inline `style={{ animationDelay: staggerDelay(index) }}` op de niet-compacte `Button` zetten. De bijbehorende keyframe (`riseIn`) komt uit de nieuwe `navItem`-class in `appLayoutStyles.js`; de compacte rail-variant krijgt géén delay.
- **Regelimpact:** +~8 regels → ~54. Props 6 → 7 (onder het maximum van 10).
- **Risico:** laag. Let op dat `styles.navButton` en de nieuwe animatie-class samen via `mergeClasses` gaan, met de eigen class als laatste.

### 1.3 `src/components/shared/SidebarNavItem.jsx`

- **Huidige situatie (113 regels):** hardgecodeerde `transitionDuration: '0.12s'` op `background-color, border-color`, geen easing-token, geen reduced-motion, geen enter-animatie. Actief-indicator (`borderLeftColor`) springt.
- **Gewenste wijziging:**
  1. `item`: transition-trio vervangen door `...interactiveTransition(['background-color', 'border-color', 'color', 'transform'])`.
  2. Subtiele hover-lift in de geest van de guide-cards, maar rustiger voor een nav-lijst: `':hover': { transform: 'translateX(1px)' }` — of desgewenst alleen kleurtransitie; laat dit expliciet door `ui-design-review` bevestigen.
  3. Optionele prop `animationDelay`: wanneer gezet, `...enterAnimation(keyframes.riseIn, motion.durationSlow)` op `item` + inline delay (identiek patroon aan `GuideCard`).
  4. `icon`/`labelWrap` hoeven geen eigen animatie (voorkomt geneste, dubbele beweging).
- **Regelimpact:** +~15 regels → ~128. Blijft ruim onder 250.
- **Risico:** dit component wordt door meerdere sidebars gebruikt; de enter-animatie moet **opt-in** via de prop blijven, anders krijgen bestaande gebruikers ongevraagd beweging. Geen aparte test nodig (styling-component, uitgezonderd in de kwaliteitspoort).

### 1.4 `src/components/admin/AdminSettingsSidebar.jsx`

- **Huidige situatie (82 regels):** `aside` verschijnt hard bij het openen van `/admin`; geen enter-animatie, geen stagger, geen reduced-motion.
- **Gewenste wijziging:**
  1. `sidebar`-class: `...enterAnimation(keyframes.slideInLeft, motion.durationNormal)`.
  2. `sectionHeading`: `...enterAnimation(keyframes.riseIn, motion.durationNormal, staggerDelay(...))`.
  3. Doorlopende teller over alle secties (zelfde `cardIndex++`-truc als `GuidesDrawer.renderCard`) en `animationDelay={staggerDelay(i)}` doorgeven aan `MemoSettingsNavButton` → `SidebarNavItem`.
- **Regelimpact:** +~14 regels → ~96.
- **Risico's:** `SettingsNavButton` is `memo` — de `animationDelay`-prop moet een **stabiele string** zijn (`staggerDelay` is puur, dus geen nieuwe referentie per render; geen object doorgeven). Omdat het component bij tab-wissel niet unmount, speelt de stagger precies één keer per paginabezoek. Bij >8 items klemt `staggerDelay` op `max` zodat de laatste items niet 600 ms wachten.

### 1.5 `src/components/rccp/RccpSettingsFlyout.jsx`

- **Huidige situatie (87 regels):** Fluent `Drawer` verzorgt de surface-slide zelf (dat deel is dus al oké), maar de **inhoud** krijgt geen rise-in/stagger zoals de guide-cards. De body wordt altijd gerenderd, dus zelfs een toegevoegde enter-animatie zou alleen bij de eerste mount afspelen.
- **Gewenste wijziging:**
  1. Nieuwe `body`-class met `...enterAnimation(keyframes.riseIn, motion.durationNormal, 60)` en zet die op een wrapper-`div` binnen `DrawerBody`.
  2. Die wrapper conditioneel renderen of `key={open ? 'open' : 'closed'}` geven, zodat de enter-animatie bij elke opening opnieuw speelt — hetzelfde `{open ? … : null}`-patroon dat `PurchaseOrdersActiveRulesFlyout` al gebruikt. Dit is óók goed voor de perf-regel (geen render van zware form-inhoud terwijl de drawer dicht is).
  3. `DrawerFooter`-blok: `...enterAnimation(keyframes.riseIn, motion.durationNormal, 120)` zodat footer net na de body inkomt.
- **Regelimpact:** +~14 regels → ~101.
- **Risico's:** de `Spinner` → formulier-wissel triggert de animatie opnieuw (visueel prettig, maar controleren in de browsertest). Niet de Fluent-drawer-surface zelf overschrijven met eigen keyframes — dat botst met Fluent's eigen mount-motion (zichtbaar als dubbele beweging).

### 1.6 `src/components/supplier/PurchaseOrdersActiveRulesFlyout.jsx`

- **Huidige situatie (107 regels):** rendert de body al alleen bij `open` (goede basis), maar de twee secties verschijnen zonder fade/rise; geen reduced-motion.
- **Gewenste wijziging:** `styles.body` uitbreiden met `...enterAnimation(keyframes.riseIn, motion.durationNormal)` en beide `PurchaseOrdersActiveRulesSection`-blokken een inline `animationDelay` uit `staggerDelay(0)` / `staggerDelay(1)` geven (via een lichte wrapper-`span`/`div` met een `section`-class, zodat de sectie-component zelf niet hoeft te wijzigen).
- **Regelimpact:** +~12 regels → ~119.
- **Risico:** de uitklapbare rijen binnen de secties hebben hun eigen expand-gedrag; de enter-animatie mag geen `overflow: hidden` of `transform` op de scroll-container introduceren (anders klemmen de editors af — vergelijkbaar met de bekende valkuil "dropdown afgeknipt door `overflow: hidden`"). Alleen op de statische wrapper zetten, niet op de rijen zelf.

### 1.7 `src/components/bi/ChartBuilderFlyout.jsx`

- **Huidige situatie (87 regels):** gedocumenteerde uitzondering — non-modaal inline `<aside>` dat de layout duwt. Verschijnt volledig zonder motion; geen reduced-motion.
- **Gewenste wijziging:** `flyout`-class: `...enterAnimation(keyframes.slideInRight, motion.durationNormal)`. Optioneel `body`: `...enterAnimation(keyframes.contentIn, motion.durationNormal, 80)`.
- **Regelimpact:** +~8 regels → ~95.
- **Risico's:** de layoutverschuiving van het dashboard gebeurt direct, terwijl het paneel inslidet; houd de translate daarom klein (16 px) en kort (`durationNormal`), anders voelt het los van de layout. **Niet** `width` animeren — dat zou bij elke frame een reflow van de charts geven (perf-regel). Bestaande focus-restore in `useEffect` niet aanraken; `enterAnimation` mag de `:focus-visible`-outline niet overschrijven.

### 1.8 Optioneel — `src/components/layout/AppShellHeader.jsx` (buiten de gevraagde lijst, wel dezelfde navigatie)

- **Huidige situatie (235 regels):** het avatar-menu (`styles.menu`, z-index 3000) en de backdrop verschijnen hard; het is de laatste nav-oppervlak zonder motion.
- **Gewenste wijziging:** `menu`: `...enterAnimation(keyframes.cardIn, motion.durationFast)`; `menuBackdrop`: `...enterAnimation(keyframes.fadeIn, motion.durationFast)`.
- **Regelimpact:** +~8 regels → ~243. Dat is **boven de 250-regel-waarschuwingsgrens na de eerstvolgende wijziging**, dus splits bij deze gelegenheid de styles naar `appShellHeaderStyles.js` (header → ~140 regels).
- **Risico:** `AppShellHeader.test.jsx` bestaat — die test moet groen blijven (animaties raken de DOM-structuur niet, dus verwacht geen breuk).

---

## 2. Reduced-motion — consistent doortrekken

- Elke nieuwe/gewijzigde animatie of transitie krijgt `...reducedMotion` mee. Dat gebeurt **automatisch** zodra `enterAnimation()` of `interactiveTransition()` wordt gebruikt — daarom zijn die twee helpers de enige toegestane route. Losse `animationName`/`transitionDuration` in `makeStyles` is vanaf nu een review-bevinding.
- Opruiming van de JS-kant (dubbele detectie): `usePrefersReducedMotion` staat nu in `src/hooks/useAnimatedNumber.js` met zijn eigen `readReducedMotion()`, terwijl `motionTokens.js` al `prefersReducedMotion()` heeft. Voorstel: verplaats de hook naar `src/hooks/usePrefersReducedMotion.js`, laat die intern `prefersReducedMotion()` gebruiken, en re-exporteer uit `useAnimatedNumber.js` voor backwards compatibility (+~25 nieuwe regels, −~12 in `useAnimatedNumber.js`, geen call-site-wijzigingen). Lage prioriteit, maar het voorkomt dat er een derde variant bijkomt.
- Voor de genoemde componenten is **geen** JS-detectie nodig: alles is CSS-only, dus de media-query volstaat.

---

## 3. Voorstel docs-update — `docs/guides/UI_DESIGN_STANDARDS.md`

**§6 Golden reference index** — drie rijen toevoegen en één stale rij repareren:

| Pattern | File |
|---|---|
| Motion tokens & helpers | `src/styles/motionTokens.js` + `src/styles/motionStyles.js` |
| Animated drawer (motion reference) | `src/components/onboarding/GuidesDrawer.jsx` |
| Styles-bestand naast groot component | `src/components/layout/appLayoutStyles.js` |

De bestaande rij *Drill-down drawer → `src/components/rccp/RccpDrillDownPanel.jsx`* verwijst naar een **bestand dat niet meer bestaat** (geen enkele match op "DrillDown" in `src/`). Verwijderen of vervangen door de actuele drill-down.

**§4 Motion** — uitbreiden met:
- `reducedMotion`/`enterAnimation`/`staggerDelay`/`interactiveTransition` komen uit `src/styles/motionStyles.js` (niet meer uit `onboardingMotion.js` — dat blijft alleen een re-export voor de tour-code).
- Vaste navigatie-recepten: paneel/sidebar in = `slideInLeft` + `durationNormal`; inline rechterpaneel = `slideInRight`; overlay/backdrop = `fadeIn` + `durationFast`; lijst-items = `riseIn` + `staggerDelay` (base 60 ms, step 50 ms, geklemd); hover/active = `interactiveTransition` + `durationFast`.
- Regel: **alleen `transform` en `opacity` animeren** — nooit `width`, `height`, `left` of `top` in hot paths.
- Regel: enter-animaties spelen alleen bij mount → render drawer-/paneelinhoud conditioneel op `open` (of geef een `key`), anders zie je de animatie eenmalig en daarna nooit meer.

**§2 App shell** — noteren dat de rail bewust géén enter-animatie heeft (wordt bij paneel-toggle ge-unmount) en dat `data-tour="nav-rail"` op de rail-`aside` moet blijven.

---

## 4. Bewuste open keuze — enter-only vs. enter+exit animatie (het mobiele nav-paneel)

Dit is punt "D" uit de eerdere keuzevraag: het gaat over **hoe het mobiele uitklap-paneel in `AppLayout.jsx` weer verdwijnt** wanneer je het sluit.

**Het probleem:** het paneel wordt nu conditioneel gerenderd (`{sidebarOpen && <Panel/>}`). Zodra je het *opent*, kun je met CSS een mooie animatie geven (in-schuiven + fade), want het element wordt net aan de DOM toegevoegd — dat is de "enter-animatie" die dit plan overal toepast. Maar zodra je het weer *sluit*, wordt het element in één keer uit de DOM gehaald (`sidebarOpen` wordt `false` → React verwijdert het meteen). Een CSS-animatie kan niet afspelen op een element dat al weg is — dus het paneel "verdwijnt" nu abrupt, zonder mooie uit-animatie ("exit-animatie").

Twee routes om dit op te lossen:

- **Route A — enter-only (aanbevolen voor nu, kleinste risico):**
  Accepteer dat het paneel bij *openen* mooi animeert (zoals de guides-drawer), maar bij *sluiten* gewoon direct verdwijnt, zonder animatie. Kost geen extra state, geen extra risico, en is in lijn met dit hele plan. Dit is de standaardkeuze die het plan nu voorstelt.

- **Route B — enter én exit-animatie, via Fluent's eigen `OverlayDrawer`:**
  Vervang het huidige zelfgebouwde paneel (`{sidebarOpen && <div>...</div>}` + eigen backdrop) door de kant-en-klare Fluent UI v9-component `<OverlayDrawer position="start">`. Die component regelt zelf het "vertraagd verwijderen uit de DOM" (hij blijft nog even in de DOM tijdens het wegschuiven, en verdwijnt pas als de animatie klaar is) — dus je krijgt **gratis** zowel een mooie in- als uit-animatie, precies zoals bij een professionele drawer.
  Nadeel: dit is een grotere wijziging dan alleen "kleur en animatie toevoegen" — het raakt de structuur van het paneel (nieuwe component, andere z-index-laag, de custom backdrop verdwijnt en wordt vervangen door Fluent's eigen backdrop), en het raakt de tour-markering (`data-tour="nav-rail"`) en de wisselogica tussen rail en paneel. Daarom stelt het plan voor dit **niet** in dezelfde ronde te doen, maar als apart, klein vervolgwerkje.

**Kort gezegd:** A = "mooi opengaan, hard dichtgaan, klein werk". B = "mooi opengaan én dichtgaan, groter werk, apart oppakken".

**Besluit voor dit plan: Route A (enter-only).** Dit is geen open vraag meer — Route B (Fluent `OverlayDrawer` met enter+exit) wordt bewust niet in dit werk meegenomen en apart als vervolgwerkje gepland, zonder eigen AC in deze scope.

---

## 5. Uitvoeringsvolgorde (prioriteit)

| # | Stap | Waarom deze plek |
|---|---|---|
| **1** | `src/styles/motionStyles.js` aanmaken + `onboardingMotion.js` omvormen tot shim + `motionStyles.test.js` + `staggerDelay` in `GuidesDrawer.jsx` | Fundament; zonder dit kan de rest niet hergebruiken. Direct `npm test` — de tour-tests (`tours.test.js`, `TourOverlay.test.jsx`) moeten groen blijven, dat is de vangnet-check op de verhuizing. |
| **2** | `AppLayout.jsx` **splitsen** naar `appLayoutStyles.js` (nog zonder motion), commit-waardig als losse refactor | 261 regels; splitsen vóór het toevoegen houdt de diff leesbaar en het bestand onder de limiet. |
| **3** | `AppLayout` + `AppNavItem`: paneel `slideInLeft`, backdrop `fadeIn`, railTooltip via `interactiveTransition`, stagger in het paneel | Hoogste zichtbaarheid, expliciet hoogste prioriteit van de opdracht. |
| **4** | `SidebarNavItem.jsx` (transition-tokens + opt-in `animationDelay`) | Bouwsteen voor stap 5; raakt meerdere sidebars, dus vóór de consument doen. |
| **5** | `AdminSettingsSidebar.jsx` (slide-in + stagger via de nieuwe prop) | Direct profijt van stap 4. |
| **6** | `RccpSettingsFlyout.jsx` en `PurchaseOrdersActiveRulesFlyout.jsx` (body rise-in + stagger, body conditioneel op `open`) | Drawer-surface is al oké; dit is de content-laag. |
| **7** | `ChartBuilderFlyout.jsx` (`slideInRight`) | Gedocumenteerde uitzondering, laagste koppeling. |
| **8** | Optioneel: `AppShellHeader.jsx` (avatar-menu `cardIn` + backdrop `fadeIn`, mét styles-split) en de `usePrefersReducedMotion`-consolidatie | Nice-to-have; kan in een volgende ronde. |
| **9** | Docs-update §2/§4/§6 + versie-bump `src/config/version.js` (`v1.61.5` → **`v1.62.0`**, minor want zichtbare feature) | Afronding. |

## 6. Testaanpak

1. **Per stap** `npm test` (Vitest) — met name `tours.test.js`, `TourOverlay.test.jsx` en `AppShellHeader.test.jsx` als regressie-vangnet; plus de nieuwe `motionStyles.test.js`. Daarna `npm run build` om Griffel-compileerfouten in de keyframe-objecten eruit te halen.
2. **Handmatig/geautomatiseerd in de browser op `localhost:5178`** (local-first, geen push): paneel openen/sluiten, rail-tooltip hover, `/admin`-sidebar stagger, alle drie de flyouts openen én **opnieuw** openen (verifieert dat de enter-animatie herhaalt), en één tour starten om te bevestigen dat de tour-motion ongewijzigd is.
3. **Reduced motion verifiëren** via DevTools → Rendering → *Emulate CSS prefers-reduced-motion: reduce*: alle bovenstaande flows moeten dan zonder beweging en zonder sprongen werken.
4. **Skill `browser-feature-test`** draaien ná stap 7 — functionele browsertest inclusief console-errors en netwerk-inspectie op de nav/flyout-flows.
5. **Skill `ui-design-review`** daarna draaien (volle modus, niet light) — deze slag raakt meerdere golden references en de standaardendocumentatie, dus de review moet de nieuwe §4/§6-teksten meenemen.
6. **Perf-let-op** (kwaliteitspoort punt 2): geen extra `apiRequest`-calls, geen nieuwe re-renders; controleer in de ⚡ perf-HUD dat de PO-board-interactie niet verslechtert — de animaties zijn puur CSS op `transform`/`opacity` en mogen geen longframes toevoegen. `keyframes`/`enterAnimation`-aanroepen gebeuren op module-niveau in `*Styles.js` (buiten de render-functie), niet inline in de component-body, zodat Griffel niet per render herberekent.
7. **Rapid toggle:** paneel/flyout 2-3x snel achter elkaar openen/sluiten (dubbelklik, snelle toetsenbord-navigatie) — geen visuele glitch of flicker door herhaaldelijk (re)starten van de enter-animatie (AC5).
8. **Focus-management:** naast reduced-motion ook controleren dat `enterAnimation` de `:focus-visible`-outline niet laat "meeschuiven" of vertragen bij keyboard-navigatie — met name bij `AppLayout`/`AppNavItem` (paneel-items met stagger) en `ChartBuilderFlyout` (focus-restore mag niet worden aangeraakt).

---

## Review-aantekeningen (`review-plan-for-devops`, 2026-09-15)

- 🟡 **BIJNA → gefixt:** versienummer gecorrigeerd naar actuele waarde (`v1.61.5`), §4 omgezet van impliciete aanbeveling naar expliciet besluit (Route A).
- **Niet-blokkerende opmerkingen, verwerkt in dit document:** AC5 (rapid toggle) en focus-management toegevoegd aan testaanpak; Doel/AC-blok toegevoegd voor bord-registratie als Task/Tech-debt-item (geen user story nodig voor dit type werk).
- **Openstaand, niet verwerkt (optioneel):** §3-docs-update kan bij uitvoering expliciet vermelden welk bestand de stale `RccpDrillDownPanel.jsx`-referentie vervangt, of bevestigen dat de rij zonder vervanging vervalt — dit wordt pas duidelijk tijdens stap 9.
- **Scope-opmerking:** de 9-stappen-volgorde in §5 vormt al logische commit-grenzen; optioneel te splitsen in twee DevOps-child-items (1-3 vs. 4-9) als het op het bord komt.
