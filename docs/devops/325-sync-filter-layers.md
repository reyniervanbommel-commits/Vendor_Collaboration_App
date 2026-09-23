# Sync filter layers (D365 PO-sync) — 2-fase / additieve filtering (DevOps)

**Doel:** D365-syncfilter voor Purchase Orders van één vervangende filter naar meerdere additieve filter-lagen (OR), zodat een nieuwe nachtelijke laag bovenop een bestaande initiële laadfilter komt in plaats van die te vervangen.
**Referentie in repo:** [.cursor/plans/dev_sync_filter_layers_80852cbc.plan.md](../../.cursor/plans/dev_sync_filter_layers_80852cbc.plan.md)
**Tags:** d365; sync-filter; purchase-orders; admin-ui
**Work item:** #325 (User Story, Vendor-App)

---

## User story

**Als** admin van de Data model-pagina
**wil ik** meerdere D365-syncfilter-lagen voor Purchase Orders kunnen instellen die elkaar aanvullen (OR) in plaats van vervangen
**zodat** ik een eenmalige initiële laadfilter kan combineren met een aparte, nachtelijk terugkerende filter (bv. "alle openstaande schoenen-orders") zonder de eerste dataset te verliezen.

---

## Acceptatiecriteria (definitie van "klaar")

1. Na opslaan van laag 2 ("Open shoes", openstaand + schoenen) blijven de PO's van laag 1 ("Initial load") zichtbaar op het bord.
2. Laag 2 uitzetten laat laag 1 ongewijzigd (geen reset van retentie/scope van laag 1).
3. Laag 2 weer aanzetten toont de eerder gecachte PO's van laag 2 **direct** (zonder op de nachtrun te wachten), dankzij `unmarkInScopeCacheRows`.
4. Opslaan van een actieve laag zonder regels geeft een 400-validatiefout.
5. Verificatie: `PUT /api/data/purchase-orders/sync-filters` met 2 lagen → `GET /api/data/purchase-orders/datamodel` → response toont beide lagen terug, elk met eigen `compiled`-filterstring en eigen "Count rows"-resultaat.
6. Maximaal 3 actieve lagen per tabel; alleen voor de Purchase Orders-tabel (niet voor andere tabellen met sync-filters).
7. Bestaande, huidige filter wordt bij uitrol automatisch gelezen als "Laag 1" (geen handmatige migratie-actie, geen SQL-migratiescript nodig).

---

## Wat is al gedaan (geverifieerd, geen nieuwe tasks meer nodig)

| Item | Locatie |
|------|---------|
| Bestaand soft-delete-gedrag (`removed_at_source`) geverifieerd; geen echte `DELETE` bij filterwijziging | [server/services/TableDataService.js](../../server/services/TableDataService.js) (`markOutOfScopeCacheRows`, ±279) |
| Bestaande chunk/dedup-fetch-lus (herbruikbaar voor OR-van-lagen) | [server/services/TableDataService.js](../../server/services/TableDataService.js) (`purchaseOrdersFetch`, ±605-660) |

---

## Backlog — tasks

- [ ] **Backend — normalisatie:** `normalizeSyncLayers`, `recordMatchesAnyLayer`, `compileSyncLayerChunks` in [server/utils/odataSyncFilter.js](../../server/utils/odataSyncFilter.js) (+ unit tests, incl. auto-wrap van legacy platte array naar "Laag 1", max 3 lagen, lege-actieve-laag-validatie)
- [ ] **Backend — accessor:** `getTableSyncRules` / `getPurchaseOrderSyncRules` (±901-932) vervangen door `getTableSyncLayers` / `getPurchaseOrderSyncLayers`; alle aanroepers (±610, ±2358, ±3524) omzetten
- [ ] **Backend — fetch:** `purchaseOrdersFetch` filterChunks over alle actieve lagen laten lopen (hergebruik bestaande dedup-lus)
- [ ] **Backend — scope:** `markOutOfScopeCacheRows` / `applySyncRetainedTransitions` / leespad (±3761, ±3933) op `recordMatchesAnyLayer`
- [ ] **Backend — opslaan:** `saveSyncFilters` naar layers-payload; bug-fix zodat `clearSyncRetainedForTable` niet meer blind alle lagen reset; nieuwe `unmarkInScopeCacheRows` voor direct herstel bij heractiveren; vendor-group-expansie per laag; `countSyncFilter` blijft per bewerkte laag tellen
- [ ] **Frontend — hook:** nieuwe `useSyncFilterLayers` hook (laag-CRUD, max 3, save)
- [ ] **Frontend — UI:** `SyncFilterBuilder.jsx` splitsen in laag-lijst + nieuwe `SyncFilterLayerCard.jsx`; teksten in het Engels, Fluent UI v9-tokens
- [ ] **Tests:** [server/utils/odataSyncFilter.test.js](../../server/utils/odataSyncFilter.test.js) uitbreiden; betrokken bestaande tests bijwerken naar laag-formaat
- [ ] **Versie:** minor-bump in [src/config/version.js](../../src/config/version.js) (footer)

---

## Buiten scope

- Geen aparte "headers-only, geen lines"-modus per laag
- Geen generalisatie naar andere tabellen dan Purchase Orders

---

## Versie document

Aangemaakt op basis van [.cursor/plans/dev_sync_filter_layers_80852cbc.plan.md](../../.cursor/plans/dev_sync_filter_layers_80852cbc.plan.md); wijzig dit bestand bij nieuwe afspraken.
