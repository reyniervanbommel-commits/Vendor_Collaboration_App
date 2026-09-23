# CLAUDE.md — Van Bommel App Template

## Azure DevOps

- **Bord/project: `Vendor-App`** in org `https://dev.azure.com/reyniervanbommel0745` (klassieke URL: `https://reyniervanbommel0745.visualstudio.com/Vendor-App`).
- ⚠️ Het lokale `az devops`-default staat (verkeerd) op project **`QAQC Module`** — dat is een **andere app**. Filter work-item-queries altijd expliciet op `[System.TeamProject] = 'Vendor-App'` of geef `Vendor-App` in de URL mee.
- Work items van deze app: Feature `#130` (D365 PO) en `#142` (tech-debt) met hun child-stories (`#130`–`#151`).
- Toegang: Azure DevOps REST API met een `az account get-access-token` token (geen MCP in Claude Code).

## Tech stack

- React 18 + Vite + Fluent UI v9 (`@fluentui/react-components`)
- Express + MSSQL (`mssql`) met session-based custom auth
- Azure Container Apps (dev / prod)
- **English UI** — all user-visible text (buttons, labels, errors, tooltips, aria-labels) in English; see `.cursor/rules/app-taal.mdc`

## Belangrijkste scripts

| Script | Wat |
|--------|-----|
| `npm run dev:all` | Frontend (5178) + backend (3008) tegelijk |
| `npm run migrate:db` | MSSQL-migraties uitvoeren |
| `npm run build` | Vite productie-build |
| `npm test` | Vitest tests |

## Auth-patroon

- `requireSession` + `requireRole('admin')` middleware in `server/middleware/auth.js`
- Session opgeslagen in MSSQL via `connect-mssql-v2`
- Cookie-naam via `SESSION_COOKIE_NAME` env var
- Wachtwoord-hash via bcrypt (12 rounds)
- Account vergrendeld na 3 mislukte pogingen (progressieve delay)

## CORS

`ALLOWED_ORIGINS` env var (kommagescheiden). Fallback: `['http://localhost:5173']`.

## Database

Migraties in `scripts/db/migrations/`. Altijd idempotent (`IF NOT EXISTS`).
Tabelnamen: `users`, `sessions`, `password_reset_tokens`, `mfa_backup_codes`, `audit_log`.

## Team review

`.claude/team/` bevat 9 persona-bestanden. Gebruik `/review` om parallel te reviewen.

## Skills (Claude Code)

Project skills staan in `.claude/skills/`. Belangrijkste:

| Skill | Slash command | Wanneer |
|-------|---------------|---------|
| `brd-td-feature-design` | — | Korte wens → één spec (`## BRD` / `## FRD` / `## TD`); vóór bouwplan/DevOps |
| `ui-design-review` | `/check-ui` of `/ui-design-review` | Fluent UI design-consistentie na feature (ook kleine wijzigingen) |
| `final-check-feature` | `/final-check-feature` | Ná feature/bugfix: roept UI-, perf-, security- en browser-review aan + grootte/tests |
| `browser-feature-test` | — | Functionele browser-test (gedrag, API, console) |
| `perf-review` | `/perf-check` | Laadtijden meten én toerekenen (SQL / backend / netwerk / client / render) |
| `develop-from-devops` | — | OTAP-straat: build / test / full |

Design standards: `docs/guides/UI_DESIGN_STANDARDS.md`

Triggers voor UI review: *check de ui*, *ui controleren*, *review UI design*, *design consistentie*, *ui-design-review*.

## Placeholders (vervangen bij "Use this template")

- `[APP_NAME]` — app-naam voor workflows en Container App namen
- `[app-naam]` — app-naam voor package.json en cookie-naam
- `[RESOURCE_GROUP]` — Azure resource group
- `[REGISTRY]` — Azure Container Registry naam

## App language (UI)

- Develop the app in **English** — buttons, labels, placeholders, error messages, tooltips, aria-labels, empty states, dialogs.
- Never add Dutch (or other) user-facing strings in `src/` or in API responses shown in the UI.
- When refactoring existing Dutch labels, convert them to English.
- Full rules: `.cursor/rules/app-taal.mdc`

## OTAP local-first (standaard)

Geldt voor **Claude Code** (en alle agents) tenzij `develop-from-devops` actief is.

| Laag | Omgeving |
|------|----------|
| ACC | `localhost` (`npm run dev:all`) — default ontwikkelen/testen |
| DEV | `develop` → Azure DEV — **alleen** na expliciet "push naar dev" |
| PROD | `main` → productie |

Ad-hoc: geen `git push`, geen commit zonder expliciet verzoek. DevOps-flow: feature-branch + preview via `develop-from-devops`.

Volledige regel: `.cursor/rules/otap-local-first.mdc`.

## Cursor rules

`.cursor/rules/` bevat: otap-local-first, app-taal, code-kwaliteit, kwaliteitspoort, versiebeheer, data-en-security, fluentui-valkuilen.

## Kwaliteitspoort — UI, snelheid, security (elke wijziging)

Bij **elke feature en elke snelle fix** in `src/` of `server/` — ook buiten `develop-from-devops` —
doorloop je vóór het klaarmelden van het werk, **geschaald naar de wijziging**: bij een triviale
fix (kleine diff, geen nieuwe route/auth/SQL/UI-flow, geen hot-path-impact) volstaan de eigen
checks van `final-check-feature` (stap 1) — sla `browser-feature-test` en de zware
perf-`regression`-modus dan over. Bij twijfel: behandel als feature/risicovol.

1. **UI/Fluent** — toets tegen `docs/guides/UI_DESIGN_STANDARDS.md` en `.cursor/rules/fluentui-valkuilen.mdc`.
   Daarna `final-check-feature` (die `ui-design-review` aanroept).
2. **Snelheid** — geen onnodige extra `apiRequest`-calls, queries/berekeningen in loops, of
   ontbrekende `useMemo`/`useCallback`. Kies bij twijfel de oplossing die de **ervaren** snelheid
   ten goede komt (caching, optimistic UI, memoization). `final-check-feature` roept `perf-review`
   aan (geen extra snelheid-skill; geen `perf-pipeline` na elke fix).
3. **Security** — input-validatie, geen secrets in code, `requireSession`/`requireRole` op nieuwe
   routes, SQL via parameters. `final-check-feature` roept `security-review` aan op de diff.
4. **Testen** — nieuwe of gewijzigde pure/business-logica in `server/services/`, `server/middleware/`,
 `server/utils/`, `src/utils/` of `src/hooks/` (de kernmappen) → verwacht een `.test.js`/`.test.jsx`
 ernaast, co-located zoals de rest van de repo (zie bestaande tests als voorbeeld). Dunne
 route-glue en styling-componenten zijn hiervan uitgezonderd. Geen harde CI-gate — een
 niet-blokkerende CI-job (`test-coverage-hint`, `scripts/check-core-test-coverage.js`) signaleert
 kernbestanden zonder test in de PR-jobsummary, zodat het niet op menselijk onthouden hoeft te
 steunen.
 **Lokaal draai je niet de hele suite**: `npm run test:changed` (alleen tests die de gewijzigde
 modules importeren), of `npm run test:node` / `npm run test:dom` voor één project. `npm test`
 alleen bij een gedeelde util, dependency-upgrade of wijziging in de Vitest-config. De volledige
 suite mét coverage draait toch in CI. Zie `.cursor/rules/kwaliteitspoort.mdc` → "Welke tests
 draai je lokaal".

Volledige regel: `.cursor/rules/kwaliteitspoort.mdc`. Ná de wijziging: skill
`final-check-feature` (roept `ui-design-review`, `perf-review`, `security-review`,
`browser-feature-test` aan).

## Performance / timing (verplicht bij nieuwe code)

Snelheid is standaard meetbaar via vaste "chokepoints" — houd nieuwe code daarbinnen zodat het **automatisch** getimed wordt:

| Wat je toevoegt | Hoe het getimed wordt | Actie |
|---|---|---|
| Nieuwe backend-route | `Server-Timing: app` (totale request-tijd) via de middleware in `server/server.js` | Niets — automatisch |
| Zware backend-suboperatie (DB-query, externe call, parse) | `time('label', () => ...)` uit `server/utils/timing.js` → aparte Server-Timing-metric (werkt overal, ook diep in een service; request-scoped via AsyncLocalStorage) | Wrap het blok in `time()` |
| Nieuwe frontend backend-call | `apiRequest` (`src/utils/api.js`) logt duur naar console + perf-HUD | **Altijd** `apiRequest`, nooit raw `fetch` (ESLint waarschuwt) |
| Zware client-berekening | `measure('label', () => ...)` uit `src/utils/perf.js` → User Timing + perf-HUD | Wrap het blok in `measure()` |

Zien: DevTools → Network → **Timing** (Server-Timing), de **⚡ perf-HUD** linksonder (dev/preview), `window.__perf` in de console (dev/preview), of `/perf-check` voor een gemeten review met toerekening. De HUD is dev/preview-only (`VITE_APP_ENV`), nooit in productie. Voorbeeld-instrumentatie: `TableDataService.read()` (het board leest hieruit) → `tb_read_cols` / `tb_read_sql`.
