# Board Architecture Refactor (DevOps)

**Doel:** De PO-boardketen opdelen in diepe, testbare modules met kleine publieke interfaces, zonder functionele, security- of performancewijzigingen voor gebruikers, behalve de benoemde latente bugs B1, B2 en B3.
**Referentie in repo:** [.cursor/plans/dev_2026-09-23-board-architecture-refactor.plan.md](../../.cursor/plans/dev_2026-09-23-board-architecture-refactor.plan.md)
**Work item:** Feature #AB:334 (Vendor-App)
**Tags:** refactor; architecture; purchase-orders; table-data; caching; testing

---

## User story

**Als** ontwikkelteam
**wil ik** dat board reads, caching, frontend-state, leveranciersautorisatie en D365-refresh duidelijke modulegrenzen en boundary-tests krijgen
**zodat** wijzigingen veilig en zelfstandig kunnen worden ontwikkeld zonder de huidige monolithische services en hooks volledig te hoeven reconstrueren.

---

## Architectuurkeuze

Strangler + facade:

1. Bestaand gedrag eerst als contract vastleggen.
2. `TableDataService` blijft tijdens de migratie een compatibele facade.
3. Board-read publieke API: `read`, `readRowDetails`, `getRevision`.
4. Externe afhankelijkheden injecteren in clusters: registry, SQL/cache, settings, revision/projection, post-read hooks.
5. PO-beleid blijft intern per `tableKey`; geen openbaar pluginregister.
6. Nieuwe interne bronbestanden onder 300 regels; splitsen op verantwoordelijkheid.
7. HTTP-responses, supplier-scope, revision-semantiek en bestaande `Server-Timing`-labels blijven compatibel.
8. Board-read bezit alleen request-inflight; de cachemodule bezit alleen voltooide snapshots. `BoardWarmup` houdt zijn eigen tweestaps single-flight (`readBoardSnapshot` daarna `readRccpPoRows`).
9. Gedeelde caches sleutelen op `(tableKey, supplierAccount)` — nooit op `userId`.

## Buiten scope

- Geen nieuw boardgedrag of UI-functionaliteit.
- Geen wijziging van SQL-schema of opgeslagen board-layoutformaat.
- Geen wijziging van D365-filterresultaten, supplier-rechten of API-responsevelden.
- Geen algemene herschrijving van RCCP-, BI- en adminbestanden.
- Geen gelijktijdige Stories die dezelfde bestanden wijzigen.

## Latente bugs (bewuste uitzonderingen)

Deze Feature is verder gedragsbehoudend, met exact drie uitzonderingen:

| Id | Defect | Waar opgelost |
|----|--------|----------------|
| **B1** | `readInflightKey` mist `includeRemoved` en `supplierFilterColumn` en normaliseert defaults niet | Fase 0 legt huidig gedrag vast; Story 1B draait om naar de negendelige genormaliseerde `JSON.stringify`-tuple |
| **B2** | Gedeelde snapshot draagt per-gebruiker `isNew`/`isChanged` | Fase 2: snapshotlezer user-neutraal (`userId: null`, `includeChangeDecorations: false`); geen `userId` in de cachekey |
| **B3** | Suppliers kunnen persoonlijke runtime-links laten meewegen | Fase 2: staff-links zijn canoniek; suppliers slaan `lineTotalHeaderLinks` / `lineValueHeaderLinks` niet als persoonlijke override op |

---

## Acceptatiecriteria (definitie van "klaar" voor de Feature)

1. PO-boardresultaten voor staff en suppliers blijven functioneel gelijk, met uitzondering van B1, B2 en B3.
2. JSON-shape van `GET /api/data/purchase-orders` blijft compatibel.
3. Revision-, collapsed-detail-, lookup-, formule-, track-change- en supplier-scopegedrag blijven behouden.
4. Bestaande `tb_*` en relevante snapshot-`Server-Timing`-labels blijven aanwezig.
5. Geen extra API-calls, SQL-queries in loops of seriële reads in een bestaande parallelle read-fase.
6. Nieuwe of gewijzigde kernmodules krijgen co-located tests.
7. Gewijzigde componenten blijven onder 300 regels; bij 250+ opnieuw beoordelen of splitsing nodig is.
8. Iedere code-Story verhoogt `src/config/version.js`.
9. Iedere Story doorloopt `npm run test:changed`, de relevante node/dom-projecten, `npm run build` en de geschaalde `final-check-feature`.
10. Iedere Story is testbaar op de feature-preview; localhost blijft aanvullend beschikbaar op `http://localhost:5178`.
11. Performance vs Fase 0: vijf runs, zelfde account/scenario/volume. Falen bij meer dan 10% én meer dan 100 ms mediane requesttijd, of meer dan 20% op een `tb_*` onderdeel dat in de nulmeting minimaal 100 ms duurde.
12. Koude start: vijf user-perceived eerste PO-board-loads na containerherstart (healthcheck groen, asynchrone warmup actief). Zelfde grens als AC 11. Warmup vult geen PO-board GET-cache.
13. Stories die `src/` raken tonen gelijk gedrag op preview: board laden, filter toepassen/wissen, cel bewerken (optimistic + rollback), tab-switch met behoud van de actieve view.

De Feature is gereed wanneer Fase 0 tot en met 6B zijn afgerond. Apart vervolgwerk (overige 300+-componenten, RCCP/BI-monolieten) blokkeert de Feature niet.

---

## Backlog — child User Stories

### Story #AB:335 — Fase 0: Gedragscontracten en nulmeting
**Doel:** Huidig gedrag vastleggen voordat productielogica verhuist.
**Acceptatiecriteria:**
1. Tests slagen tegen de ongewijzigde productie-implementatie, inclusief B1 als huidig gedrag.
2. Fixture bevat minimaal één masterrij, detailregels, lookup, formule, track-change-meta en supplier-filterveld.
3. Contracttest detecteert verwijderen of hernoemen van bestaande responsevelden.
4. Timingtest detecteert verdwijnen van bestaande read-chokepoints.
5. Nulmeting vermeldt totale requesttijd en belangrijkste `tb_*` onderdelen, warm én koud.

### Story #AB:336 — Story 1A: Board-read internals extraheren
**Doel:** Interne read-onderdelen uit `TableDataService` halen; `read` blijft de orchestrator.
**Afhankelijk van:** #335
**Acceptatiecriteria:**
1. Alle Fase 0-contracttests blijven groen; geen wijziging van de B1-assertie.
2. Geen productiecalls omgezet naar een nieuwe orchestrator.
3. Geen nieuw modulebestand groter dan 300 regels; geen nieuwe circulaire imports.
4. SQL-queryvormen, parallelle readstructuur en Server-Timing-labels blijven gelijk.

### Story #AB:337 — Story 1B: Board-read orchestrator activeren
**Doel:** `createBoardReadService` + drie entrypoints activeren en B1 fixen.
**Afhankelijk van:** #336
**Acceptatiecriteria:**
1. Fase 0-contracttests blijven groen, met alleen de benoemde B1-omdraaiing.
2. `TableDataService.read` bevat alleen compatibiliteitsdelegatie.
3. Inflight-key is `JSON.stringify` van negen genormaliseerde waarden; `null` ≠ `''`; `includeRemoved` en `supplierFilterColumn` splitsen reads.
4. Callers werken via `TableDataService`; `supplierRowAccess` importeert TDS niet meer zelf.
5. Resultaten blijven binnen de globale performancegrens.

### Story #AB:338 — Fase 2: Centraal cache- en invalidatiebeheer
**Doel:** Eén eigenaar voor snapshots/signatures/invalidatie; B2 en B3 dichten.
**Afhankelijk van:** #337
**Acceptatiecriteria:**
1. Elke mutatie leidt tot verse data via gewijzigde signatuur of bewezen `invalidate`; redundante invalidate is verwijderd.
2. Geen route bezit nog een eigen board-snapshot-Map; geen cachekey bevat `userId`.
3. Supplier A kan nooit cachedata van supplier B of staff ontvangen.
4. Gedeelde snapshot bevat geen per-gebruiker `isNew`/`isChanged` (B2).
5. Staff-links zijn canoniek; suppliers kunnen header-links niet persoonlijk overschrijven (B3).
6. `BoardWarmup` vult de staff snapshot- en KPI-entry voor BI/RCCP; PO-board GET gebruikt die entry niet.
7. Warme read binnen AC 11; koude PO-boardmeting binnen AC 12.

### Story #AB:339 — Fase 3: Frontend board-model en persistence
**Doel:** `usePurchaseOrdersPage` als compositiehook; `src/features/` + ADR-007.
**Afhankelijk van:** #337
**Acceptatiecriteria:**
1. `usePurchaseOrdersPage.js` blijft onder 300 regels en retourneert exact `data`, `settings`, `mutations`, `columns`.
2. Geen gewijzigde hook retourneert meer dan tien top-level waarden.
3. Geen raw `fetch`; alle calls via `apiRequest`.
4. Load, revision-skip, optimistic save, settings-persist en rollback zijn boundary-getest.
5. Geen extra API-calls; zichtbaar gedrag gelijk (AC 13).
6. `docs/adr/007-board-feature-mappen.md` bestaat.
7. Pure modeltests `src/features/**/*.model.test.js` draaien in het node-project.

### Story #AB:340 — Fase 4: Zichtbaar-board-state
**Doel:** Filters, sessie en saved views achter één modulegrens; geen tweede board-viewconstructie.
**Afhankelijk van:** #339
**Acceptatiecriteria:**
1. Gewist filter keert niet terug na tab- of paginaswitch.
2. Saved-view apply en session restore leveren dezelfde zichtbare rijen.
3. All Orders en conditionele opmaak blijven gelijk; `clearActiveViewFilterSession` blijft.
4. De tabel maakt geen tweede board-viewmodel.
5. Viewhooks onder 300 regels en max tien top-level waarden.
6. Pure modellen als `*.model.test.js` in node; AC 13 aangetoond.

### Story #AB:341 — Fase 5: Uniforme supplier-autorisatie
**Doel:** Pad-, rij- en kolomrechten in één `authorizeBoardAction`.
**Afhankelijk van:** #338
**Acceptatiecriteria:**
1. Iedere supplier-write wordt op pad, rij en kolom gecontroleerd; staffgedrag ongewijzigd.
2. Ontbrekende autorisatie-aanroep bij een beschermde route wordt door routetests gedetecteerd.
3. Geen extra volledige board-read per actie.
4. Routetests dekken per matrixrij staff OK, supplier in-scope OK, out-of-scope 403, verboden actie 403.
5. IDOR-tests voor gewijzigde `partitionKey`, `recordKey`, `columnId` en `remarkId`.

### Story #AB:342 — Story 6A: Refreshmodule extraheren
**Doel:** Refresh achter `startRefresh` / `refresh` / `getRefreshProgress` / `isRefreshRunning`; callers blijven op TDS.
**Afhankelijk van:** #337 en #338
**Acceptatiecriteria:**
1. Bestaande refresh- en night-refreshtests blijven groen zonder callerwijzigingen.
2. Handmatige en nachtelijke refresh leveren dezelfde data en progresssemantiek.
3. Sync-filterresultaten blijven gelijk; mislukte run eindigt niet als succes.
4. Timingmetrics voor externe calls en zware merge blijven.
5. Warmup-aanroep blijft in `RefreshRunService.finishRun`.

### Story #AB:343 — Story 6B: Callers omschakelen en facade verkleinen
**Doel:** Routes op de refreshmodule zetten; TDS zonder refresh-orchestratie, max 2500 regels.
**Afhankelijk van:** #342
**Acceptatiecriteria:**
1. Handmatige en nachtelijke refresh blijven gelijk.
2. Succesvolle merge verhoogt revision precies eenmaal; warmup ziet de nieuwe signature.
3. `TableDataService` bevat geen refresh-orchestratie meer.
4. `server/services/TableDataService.js` is maximaal 2500 regels.

---

## Volgorde

1. #335 Fase 0
2. #336 Story 1A
3. #337 Story 1B
4. #338 Fase 2 en #339 Fase 3 (na 1B; niet dezelfde bestanden)
5. #340 Fase 4 na #339
6. #341 Fase 5 na #338
7. #342 Story 6A na #337 en #338
8. #343 Story 6B na #342

Uitvoering per child Story via `develop-from-devops` (eigen featurebranch, preview, review, verificatie).

---

## Verificatiecommando's

- Fase 0: `npm run test:node -- server/services/TableDataService.test.js server/services/board-read/boardReadContract.test.js server/services/BoardSnapshotCache.test.js src/utils/purchaseOrdersBoardMapping.test.js`; `npm run test:dom -- src/hooks/usePurchaseOrdersPage.test.jsx`; `npm run build`.
- Story 1A/1B: `npm run test:node -- server/services/TableDataService.test.js server/services/board-read`; `npm run test:node -- server/routes/data.supplier-isolation.test.js server/utils/supplierRowAccess.test.js server/services/BoardWarmup.test.js`; `npm run build`.
- Fase 2: `npm run test:node -- server/services/BoardSnapshotCache.test.js server/services/board-cache server/services/BoardWarmup.test.js server/services/RccpAnalysisService.test.js server/services/TableRegistryService.test.js server/services/TableColumnsService.test.js server/services/ProductAttributeBoardColumnsService.test.js server/services/ExcelLinkService.test.js server/utils/supplierRowAccess.test.js server/utils/runtimeHeaderLinks.test.js server/routes/supplier.viewState.test.js`; `npm run build`.
- Fase 3: `npm run test:dom -- src/features/purchase-orders/board src/hooks/usePurchaseOrdersPage.test.jsx`; `npm run test:node -- src/utils/purchaseOrdersBoardMapping.test.js src/features/purchase-orders`; `npm test`; `npm run build`.
- Fase 4: `npm run test:dom -- src/features/purchase-orders/view src/hooks/usePurchaseOrderTableView.test.js src/hooks/usePurchaseOrderSavedViewState.test.js src/hooks/usePurchaseOrderBoardView.test.jsx`; `npm run test:node -- src/utils/tableViewFilterUtils.test.js src/features/purchase-orders/view`; `npm run build`.
- Fase 5: `npm run test:node -- server/services/SupplierBoardAuthorizationService.test.js server/routes/data.supplier-isolation.test.js server/utils/supplierRowAccess.test.js server/services/RowRemarksSearchService.test.js`; `npm run build`.
- Story 6A/6B: `npm run test:node -- server/services/table-refresh server/services/RefreshRunService.test.js server/services/BoardWarmup.test.js server/routes/admin.d365-refresh.test.js server/routes/internalNightRefresh.start-failed.test.js server/utils/refreshCascadeOrder.test.js server/utils/refreshProgress.test.js`; `npm run build`.
- Daarna iedere Story: `npm run test:changed`, `npm run typecheck`, geschaalde `final-check-feature`.

Let op: `src/utils/**/*.test.js` draait in het **node**-project, niet in dom.

---

## Versie document

Aangemaakt op 2026-09-23 op basis van [.cursor/plans/dev_2026-09-23-board-architecture-refactor.plan.md](../../.cursor/plans/dev_2026-09-23-board-architecture-refactor.plan.md). Wijzig dit bestand bij nieuwe afspraken.
