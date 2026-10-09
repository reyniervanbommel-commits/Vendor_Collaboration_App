# Header write-back: bevestiging bij afwijkende regelwaarden + D365-redenen

Vervolg op #AB:302 (`2026-09-02-header-push-line-writeback-design.md`). Parent: Feature #130 (Vendor-App).

## BRD

**Als** staff (admin of employee) op het purchase-orderboard
**wil ik** gewaarschuwd worden voordat een header-edit op een gepushte line-kolom alle regels met verschillende waarden overschrijft, en bij een D365-weigering zien **welke regel** faalde en **waarom**
**zodat** ik bewust overschrijf en zelf kan beoordelen of opnieuw proberen zin heeft of dat er in D365 iets moet gebeuren.

**Aanleiding (PROD, 2026-10-09):** header-edit `ExternalItemNumber` → `test` op `whsl|WSPO-0422062`. Regel 10 werd in D365 bijgewerkt; regel 20 faalde met D365 400 *"Item 'L-10780-02' is blocked for 'Purchase order'. validateWrite failed on data source 'PurchLine (PurchLine)'."* De gebruiker zag alleen *"Write-back failed on 1 of 2 lines"* en *"Updated: 0 … Failed: 1"*. De feature werkte dus, maar de UI verborg de oorzaak en de gedeeltelijke slag.

**Succes (toetsbaar):**
- Header-edit op een order waarvan de gepushte header `+N` toont (≥2 unieke regelwaarden) → eerst een bevestigingsdialoog. *Cancel* = geen API-call, de cel toont weer de oude waarde. *Update all lines* = huidige fan-out.
- Header-edit zonder `+N` → geen dialoog (ongewijzigd).
- Bulk over meerdere geselecteerde orders, waarvan ≥1 met `+N` → één bevestiging vooraf met het aantal orders met afwijkende waarden. Geen per-order dialoog.
- Faalt een regel in D365 → de gebruiker ziet per regel `Line <n>: <opgeschoonde D365-reden>` (eerste 3, daarna `+N more`) in de cel-tooltip en in de kolom *Error* van *Bulk edit finished*, volledig leesbaar (niet afgekapt zonder tooltip).
- Order waarbij sommige regels slaagden en andere faalden → telt als **Partially updated**, niet als *Updated: 0 / Failed: 1*. De rij toont `1 of 2 lines updated. Line 20: …`.
- De ruwe D365-fout blijft volledig in `tb_field_corrections.error` (audit ongewijzigd).

**Non-goals:**
- Geen wijziging aan *Retry* (blijft beschikbaar, ook voor permanente D365-validatiefouten).
- Geen automatisch overslaan van geblokkeerde artikelen; geen deblokkeren in D365.
- Geen vendor-header-editor (staff-gate blijft zoals nu).
- Geen nieuwe D365-calls, geen wijziging aan etag/`basedOnValue`-concurrency.
- Geen line-nummers of extra details-fetch in de board-payload.

**Constraints:** UI Engels; Fluent v9; componenten/hooks ≤300 regels; geen dialoog/portal in herhaalde header-cellen (dialoog op pagina-niveau); `apiRequest` voor calls; OTAP local-first.

**Beslissingen (2026-10-09, met gebruiker):**
- Scope = waarschuwing + D365-reden + partial-telling. Retry-gedrag ongewijzigd.
- Waarschuwing = bevestigingsdialoog (geen inline-only).
- Bulk = één waarschuwing voor alle geselecteerde orders.
- D365-reden = opgeschoond (Infolog-tekst), ruwe tekst blijft in audit.
- DevOps = nieuwe User Story onder #130, gelinkt aan #302.

## FRD

**Gekozen approach:** bevestiging client-side op basis van de al aanwezige `linkedLineValues` (aantal unieke waarden per order). De server levert per mislukte regel een opgeschoonde reden mee; de client propageert `failures` en een partial-status door de bestaande achtergrondjob.

**Afgewezen:**
- Server-side pre-check (dry-run endpoint dat regels telt) — extra round-trip vóór elke save, terwijl de client het aantal unieke waarden al heeft.
- Dialoog met de waarden per regel — vereist details-fetch per save; de unieke waarden volstaan voor de beslissing.

**Happy path — enkele order met `+N`:**
1. Staff wijzigt de gepushte header-cel (bijv. `Extern…`) en bevestigt (Enter/blur).
2. `linkedLineValues[headerKey]` van die order heeft ≥2 unieke waarden → dialoog:
   - Titel: **Overwrite different line values?**
   - Tekst: `Lines on order {orderNumber} currently have {n} different values ({v1}, {v2}{, …}). All lines will be set to "{value}" in D365.` (max 3 waarden getoond, langer → `…`; waarden afgekapt op 40 tekens.)
   - Knoppen: *Cancel* (secondary) / *Update all lines* (primary).
3. *Update all lines* → bestaande achtergrondjob (`correctAll`), ongewijzigd verder.
4. *Cancel* → geen job, geen API-call; de editor herstelt de oude waarde (zelfde pad als een geannuleerde edit).

**Bulk:**
1. Na de bestaande keuze *this order / all selected* (`showDecisionDialog`) met keuze bulk: tel geselecteerde zichtbare orders met ≥2 unieke `linkedLineValues` voor die header-kolom.
2. ≥1 → één dialoog: `{m} of {total} selected orders have different line values. All their lines will be set to "{value}" in D365.` *Cancel* / *Update all lines*.
3. 0 → direct door (geen extra dialoog).

**Fout / gedeeltelijk:**
- Server-respons `correct-all-details` bevat per failure `{ detailKey, message, rawMessage }`; `message` = opgeschoond.
- `updated > 0 && failed > 0` → rij-uitkomst `partial`; `updated === 0 && failed > 0` → `failed`.
- Rij-foutregel: `partial` → `{updated} of {attempted} lines updated. Line {n}: {message}`; `failed` → `Line {n}: {message}`. Meerdere failures: eerste 3 + `(+{k} more)`.
- Samenvatting: `Bulk edit finished. Updated: {u}. Partially updated: {p}. Skipped: {s}. Failed: {f}.`; *Partially updated* alleen tonen als `p > 0`.
- Badge rechtsboven telt `partial` + `failed` als aandacht: `Write-back: {n} need attention` (n = 1 → `Write-back: 1 needs attention`).
- Retry op een `partial`-rij stuurt dezelfde fan-out; de server slaat regels die al de doelwaarde hebben over (bestaand gedrag).
- Fout vóór de eerste regel (400/403/404 uit validatie) → status en melding komen door in productie (zelfde passthrough als `/correct`).

**Opschonen D365-melding (`summarizeD365WriteError`):**
- Input: bv. `D365 OData request failed (400): /data/PurchaseOrderLinesV2(...): Write failed for table row of type 'PurchPurchaseOrderLineV2Entity'. Infolog: Warning: Item 'L-10780-02' is blocked for 'Purchase order'.; Warning: validateWrite failed on data source 'PurchLine (PurchLine)'.`
- Output: `Item 'L-10780-02' is blocked for 'Purchase order'.`
- Regels: neem de delen na `Infolog:`, split op `;`, strip prefix `Warning:`/`Error:`/`Info:`, laat generieke ruis weg (`validateWrite failed on data source …`, `Write failed for table row …`), dedupe, join met spatie. Niets over → zonder pad/prefix de rest van de D365-detail; ook leeg → originele melding.
- Concurrency-409 (`basedOnValue`-mismatch) en andere app-meldingen blijven ongewijzigd.

## TD

**Server**
- Nieuw `server/utils/d365ErrorSummary.js` — `summarizeD365WriteError(message): string` (puur, getest).
- `server/services/TableDataService.js` `correctAllDetailFields`: in de `catch` van de regel-loop `failures.push({ detailKey, message: summarizeD365WriteError(err.message) || GENERIC_DETAIL_WRITEBACK_FAIL, rawMessage: err.message })`. Geen andere gedragswijziging.
- `server/routes/data.js` `POST /:tableKey/correct-all-details`: `catch` krijgt `if (err.status) return res.status(err.status).json({ error: err.message });` (gelijk aan `/correct`).
- Geen DB-migratie; `tb_field_corrections.error` blijft de ruwe tekst bevatten (wordt in `correctField` gezet).

**Client**
- `src/utils/lineWriteBackFailureText.js` (nieuw, puur): `formatLineFailures(failures, { max: 3 })` → `Line 20: … (+2 more)`; `formatPartialMessage({ updated, attempted, failures })`.
- `src/hooks/usePurchaseOrderCorrectAllLines.js`: bij `failed > 0` error met `message` = geformatteerde tekst, plus `err.failures`, `err.updated`, `err.attempted`, `err.partial = updated > 0`. `remainingDisplayValue` blijft.
- `src/hooks/purchaseOrderBulkEditRun.js` `runCorrectRows`: in `catch` `outcome: err.partial ? 'partial' : 'failed'`; failedRow krijgt `partial: true|false`; return `{ updated, skipped, partial, failedRows }` (partial-rijen zitten ook in `failedRows` zodat Retry werkt).
- `src/hooks/bulkWriteBackJobState.js`: `buildCorrectSummaryMessage({ updated, partial, skipped, failedCount })`; `jobBadgeLabel` → `need(s) attention`-tekst.
- `src/components/supplier/PurchaseOrderBulkEditFailedRows.jsx`: foutcel wrapt (geen ellipsis meer, max. 360px breed) zodat de volledige tekst leesbaar is; `partial`-rij krijgt een `Badge` *Partial* (warning); kopregel `N row(s) need(s) attention`.
- Nieuw `src/hooks/useMixedLineValuesConfirm.js`: `confirmMixedLineValues({ rows, headerColumnKey, value }) → Promise<boolean>`; telt orders met ≥2 unieke waarden (zelfde dedupe als `getLinkedLineValuePreview`), opent dialoog alleen als er ≥1 is.
- Nieuw `src/components/supplier/MixedLineValuesConfirmDialog.jsx`: Fluent `Dialog` (modal), single-order- en bulk-variant via props.
- `src/hooks/usePurchaseOrderBulkEdit.js` `executeWithBulkOption`: voor `mode === 'correctAll'`, vlak voor `startBackgroundCorrectJob`, `await confirmMixedLineValues(...)`; `false` → return (editor revert). Het hook-bestand zit op 296 regels: bevestigingslogica volledig in de nieuwe hook, alleen aanroep hier; zo nodig `startBackgroundCorrectJob`-helper extraheren om ≤300 te blijven.
- Dialog gerenderd op pagina-niveau naast `PurchaseOrderBulkEditDialog` (in `PurchaseOrdersPageContent.jsx`), niet in de header-cel.

**Auth/security:** ongewijzigd (staff-gate in UI, rol-check en row-scope op server). Opgeschoonde melding bevat alleen D365-validatietekst, geen URL/tenant.

**Perf:** geen extra requests. Telling van unieke waarden over geselecteerde zichtbare orders is O(rows); alleen bij save.

**Tests (Vitest):**
- `d365ErrorSummary.test.js`: PROD-melding van 2026-10-09 als fixture → `Item 'L-10780-02' is blocked for 'Purchase order'.`; melding zonder Infolog → zonder prefix/pad; lege input → origineel; 409-concurrency-tekst ongewijzigd.
- `TableDataService` fan-out (bestaande test-deps): failure bevat `message` (opgeschoond) + `rawMessage`.
- `lineWriteBackFailureText.test.js`: 1 / 3 / 5 failures, partial-tekst.
- `usePurchaseOrderCorrectAllLines`: `err.partial` + tekst.
- `purchaseOrderBulkEditRun.test.js`: outcome `partial` vs `failed`, tellingen.
- `bulkWriteBackJobState.test.js`: samenvatting met/zonder partial, badge-tekst.
- `useMixedLineValuesConfirm`: geen `+N` → `true` zonder dialoog; `+N` → dialoog; cancel → `false`; bulk-telling.
- Route-test `correct-all-details`: 400 vóór eerste regel → status + message in body.
- Daarna Playwright-check op localhost (DEV-data): dialoog, cancel, partial-weergave.

**Volgorde:** server-util + fan-out + route → client-tekstutil + hook-errors → job-state/run/partial → failed-rows-UI → confirm-hook + dialoog → wiring → versie-bump (`src/config/version.js` PATCH +1) → docs (`docs/devops/<id>-…md`, status-update `docs/devops/302-header-push-line-writeback.md`).
