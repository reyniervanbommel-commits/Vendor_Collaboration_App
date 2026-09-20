# Final check — granulaire instellingen-permissies (#AB:326)

**Datum:** 2026-09-18
**Branch:** `feature/326-granular-settings-permissions`
**Scope:** 39 bestanden t.o.v. `origin/develop`
**Schaalniveau:** feature / risicovol — nieuwe route-guards, wijziging in authenticatie, SQL-migratie, nieuwe UI-flow. Volledige poort.
**Skills aangeroepen:** `ui-design-review` (full), `perf-review` (regression), `security-review` (subagent), `browser-feature-test` (via dezelfde browsersessie), `project-cleanup` (smal)
**Skills ontbraken:** geen

| Onderdeel | Verdict |
|-----------|---------|
| Eigen checks | fix nu — uitgevoerd |
| UI | GOEDGEKEURD |
| Snelheid | 1 verbetering doorgevoerd, geen regressie |
| Security | zie losse review (loopt) |
| Browser | PASS |
| Cleanup | ok |

---

## Stap 1 — Eigen checks

### Bestandsgrootte

Regel uit `.cursor/rules/code-kwaliteit.mdc`: waarschuwen ≥250, splitsen ≥300 (geldt voor `src/**`).

| Bestand | Regels | Oordeel |
|---------|--------|---------|
| `src/components/admin/UsersManagement.jsx` | 262 | ⚠️ boven de waarschuwingsgrens |
| overige gewijzigde `src/`-bestanden | ≤118 | ok |

**Voorstel:** bij de volgende wijziging de tabelrij naar `UsersTableRow.jsx` halen (~70 regels), dan zakt `UsersManagement.jsx` naar ±190.

Serverbestanden vallen buiten de regel-glob. Ter informatie: `server/routes/data.js` 636 en `server/routes/admin.js` 530 regels; `admin.js` groeide in deze branch met ±22 regels, de omvang is niet door deze wijziging ontstaan.

### Dode code — gefixt

- `getSettingsTabRoles` werd nergens meer gebruikt nadat `AdminPage.jsx` die import verloor → functie en test verwijderd.
- De `grantable`-optie op `formatAudience` had geen enkele aanroeper (er is geen UI die een audience-label rendert) → teruggedraaid naar de oorspronkelijke functie.

**Blijft staan:** `formatAudience` zelf wordt alleen nog door zijn eigen test gebruikt. Dat is bestaand, dateert van vóór deze branch; opruimen hoort bij een aparte cleanup.

### Tests

Nieuwe kernlogica heeft allemaal een test: `pagePermissions.js`, `requirePagePermission`, `userAccessSummary.js`, `settingsAudience.js`.

Toegevoegd tijdens deze check: `EditRoleDialog.test.jsx` (5 tests) — dit was het enige nieuwe component met eigen logica zonder test.

Daarvoor moest `src/test-utils/setupTests.js` een `ResizeObserver`-stub krijgen; jsdom kent die niet en Fluent's `MessageBar` crasht erop. Dat gold voor elk toekomstig component met een MessageBar, niet alleen voor deze dialoog.

`useSessionAuth.js` en `useUsersManagement.js` hebben nog geen test. Bestaand patroon, niet in deze branch ontstaan.

### Versie

`src/config/version.js` op **v1.68.2**.

### Statische snelheid — 1 bevinding, gefixt

`useUsersManagement.loadUsers` deed één `/admin/users/:id/permissions`-call per gebruiker, met `pageSize=500`. Permissierijen hebben alleen betekenis voor employees, dus de call gaat nu alleen nog over gebruikers met die rol. Zie stap 3 voor de meting.

---

## Stap 2 — UI (`ui-design-review`, modus full)

8 gewijzigde UI-bestanden → modus `full`. Golden reference: `EditVendorAccountDialog.jsx` voor de nieuwe dialogen, `AdminODataSettings.jsx` als admin-paginapatroon.

### Statische audit

| Check | Resultaat |
|-------|-----------|
| Imports uit `@fluentui/react-components` | OK — geen v8-imports |
| `<Tooltip>` in een `.map()` over rijen | OK — niet aanwezig |
| `Dialog` binnen `Menu`/`MenuPopover` | OK — niet aanwezig |
| Hardcoded hex in `makeStyles` | OK — alleen `tokens.*` |
| `!important` | OK — niet aanwezig |
| `Field` met label rond elke `Input`/`Select` | OK |
| Engelse UI-strings | OK — alle nieuwe strings Engels |
| Dialooganatomie | OK — `DialogTitle` → `DialogBody` → `DialogActions`, secundair vóór primair, identiek aan de golden reference |

**VERBETERPUNT:** vijf `MessageBar`-elementen gebruiken `style={{ marginBottom }}` in plaats van een `makeStyles`-klasse, verspreid over `CreateUserDialog`, `EditRoleDialog` en `EditPermissionsDialog`. De nieuwe dialoog volgt hiermee zijn bestaande buren; los optrekken zou het juist inconsistent maken. Aanbeveling: in één keer opruimen voor de hele admin-dialoogfamilie.

### Browseraudit (preview, ingelogd als admin)

- Sidebar toont voor een admin alle 9 tabs, gegroepeerd App / People / Data.
- Users-tabel: admin toont "Full access" + "All settings", vendors "Vendor access" + "Purchase orders", employees hun toegekende tabs in sidebar-volgorde.
- Bij het eigen account ontbreekt "Change role" in de actielijst, zoals bedoeld.
- Change role-dialoog: titel, label met e-mailadres, drie Engelse rolopties met uitleg, hint, Save uitgeschakeld zolang de rol niet wijzigt. Portal-gerenderd, niet geklemd.
- Permissiedialoog voor een employee: 8 checkboxen onder de kopjes People en Data, aangevinkte staat komt overeen met de badges in de tabel.
- Console: 14 berichten, **0 errors, 0 warnings**.

**Buiten scope, wel gezien:** bij 375×667 loopt de instellingenpagina 58px breder dan het scherm (433 vs 375). Oorzaak is de vaste sidebarbreedte van de shell, niet deze wijziging.

**Screenshot:** kon niet in `playwright/screenshots/` landen — de browser-MCP schrijft buiten deze worktree. Bevindingen komen uit accessibility-snapshots en directe DOM-metingen.

**Verdict: GOEDGEKEURD** (0 blockers, 1 verbeterpunt).

---

## Stap 3 — Snelheid (`perf-review`, modus regression)

Gemeten op de preview via `window.__perf`. De diff raakt geen board-, scroll- of tab-hotpath, dus geen `perf-scroll` / `perf-board-actions`.

| Actie | Meting |
|-------|--------|
| `GET /api/auth/me` (nu met verse permissiequery) | mediaan **42 ms** over 5 runs |
| `GET /admin/users?pageSize=500` | 54 ms |
| `GET /admin/users/:id/permissions` | 43–57 ms per call, parallel afgevuurd |
| Navigation TTFB / DOMContentLoaded | 38 ms / 57 ms |

**Bevinding:** bij 6 gebruikers gingen er 6 permissiecalls uit naast de lijst. Ze lopen parallel, dus de wandkloktijd was maar ±60 ms — maar het aantal schaalt lineair mee met het aantal gebruikers, en bij honderden accounts loopt dat tegen de connectielimiet van de browser én belast het de backend onnodig. Nu alleen nog voor employees: in deze dataset 6 calls → 2.

**Geen regressie** op de extra DB-query in `/auth/me`; 42 ms ligt in lijn met de andere adminroutes.

**Buiten scope, wel gemeten:** `/supplier/board-settings/onboarding` 1477 ms en `/auth/po-table-zoom` 1169 ms direct na inloggen. Beide raken deze wijziging niet, maar domineren wel de eerste paginalading.

---

## Stap 4 — Security

Uitgevoerd door de `security-review`-subagent op de branch-wijzigingen, met de set-password-fix en de frontend-gating expliciet als opdracht. Resultaat volgt los; de eerdere ronde op dezelfde branch gaf geen medium+ bevindingen.

Tijdens het testen zelf gevonden en gefixt: `POST /api/auth/set-password` accepteerde elk e-mailadres zonder sessie of token en logde de aanvrager direct in. Nu beperkt tot accounts die hun eerste wachtwoord nog moeten zetten, met generieke 403 en rate-limiter. Geverifieerd op de preview.

---

## Stap 5 — Gedrag in de browser

Functioneel gedekt via de browsersessie hierboven plus:

- 63 route- en unittests voor autorisatie (`admin.authorization-matrix`, `data.supplier-isolation`)
- `e2e/authorization.spec.js`: 14 tests, waarvan 1 draait zonder credentials (de overname-probe, groen) en 13 wachten op `E2E_TEST_PASSWORD` / `E2E_SUPPLIER_PASSWORD`

---

## Stap 6 — Cleanup

Alleen artefacten van deze wijziging bekeken. Geen debug-logs, geen ongebruikte nieuwe bestanden, geen rommel in de worktree. `.playwright-mcp/` is niet in deze worktree aangemaakt.

**Buiten scope:** `test-reports/` staat niet in `.gitignore` en bevat ±130 untracked bestanden uit eerdere onboarding-sessies. Los opruimpunt.

---

## Gedaan

- Dode code verwijderd (`getSettingsTabRoles`, `grantable`-optie op `formatAudience`)
- N+1 permissiecalls teruggebracht tot alleen employees
- `EditRoleDialog.test.jsx` toegevoegd (5 tests) plus een `ResizeObserver`-stub in de testsetup
- Versie naar v1.68.2

## Open — nabewerking 2026-09-20

| # | Punt | Status |
|---|------|--------|
| 1 | `UsersManagement.jsx` op 262 regels | ✅ tabelrij naar `UsersTableRow.jsx`; bestand nu 196 regels |
| 2 | `MessageBar`-marges naar `makeStyles` | ✅ in alle vier de admin-dialogen |
| 3 | Kolomroutes in `data.js` buiten de `datamodel`-permissie | ✅ writeback, visibility en visible-at-delete achter de permissie; board-acties bewust open en vastgelegd in een test |
| 4 | `test-reports/` vervuilt `git status` | ✅ scripts en screenshots genegeerd, rapporten blijven in git |
| 5 | Live-e2e wacht op testwachtwoorden | ✅ nieuwe wachtwoorden uitgegeven en suite gedraaid tegen de preview |

### Live-e2e — uitkomst 2026-09-20

Nieuwe wachtwoorden gegenereerd voor beide seed-accounts; alleen de bcrypt-hash (cost 12) staat in
`037_seed_e2e_test_user.sql` en `038_seed_e2e_supplier_test_user.sql`, het wachtwoord uitsluitend in
`.env` (gitignored). De preview-deploy heeft de migraties op DEV toegepast, waarna beide accounts
werken. Opnieuw uitgeven kan met `scripts/db/generate-e2e-hashes.js` + `verify-e2e-hashes.js`.

Resultaat over `e2e/` (14 + 3 tests): alle autorisatie-assertions slagen. Wat onderweg is
rechtgezet:

- **Verkeerde aanname in twee tests.** Ze verwachtten dat een vendor op `/admin` wordt
  weggestuurd. Dat klopt niet: `general` staat op `SETTINGS_AUDIENCE.ALL`, dus een vendor hoort daar
  zijn persoonlijke tabelzoom te zien. De echte eigenschap — geen enkele beheertab — wordt nu getest.
  Handmatig geverifieerd in de browser: de sidebar bevat voor een vendor alleen General.
- **Onboarding-dialoog.** Een account dat de rondleiding nog niet zag krijgt een modale
  welkomstdialoog die de rest van de pagina `aria-hidden` maakt. Inloggen sluit die nu.
- **Te brede locator.** `getByRole('button', { name: 'General' })` matchte ook "About general
  settings"; met `exact` is er precies één treffer en is landmark-scoping overbodig.
- **2 tests overgeslagen, bewust.** Het vendor-testaccount (V000583) heeft op DEV op dit moment geen
  zichtbare orders. "Geen vreemde rijen" bewijst dan niets, dus die twee slaan expliciet over met een
  melding in plaats van groen te kleuren op een lege staat. Aandachtspunt voor de testdata.

**Bekende flakiness:** de preview draait op een Container App met `min-replicas 0`. Tijdens een
serieuze run van 8–12 minuten lopen losse requests op een timeout of ECONNRESET, elke run op een
andere test. `retries: 2` vangt dit af; bij een enkele run kan er nog één rood blijven staan. Geen
app-probleem — de assertions zelf slagen bij herhaling consequent.
