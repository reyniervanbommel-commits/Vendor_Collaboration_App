# Sync filter layers (D365 PO-sync) — 2-fase / additieve filtering

**Work item:** [#325](https://reyniervanbommel0745.visualstudio.com/Vendor-App/_workitems/edit/325) (User Story, Vendor-App)
**Branch:** `feature/325-sync-filter-layers`
**Repo-document:** `docs/devops/325-sync-filter-layers.md`

## Doel

D365-syncfilter voor Purchase Orders van één vervangende filter (`PO_SYNC_RULES` = platte
regel-array) naar meerdere additieve filter-lagen (OR tussen lagen, AND binnen een laag), zodat
een nieuwe nachtelijke laag boven op een bestaande initiële laadfilter komt in plaats van die te
vervangen.

## Datamodel

`PO_SYNC_RULES` (setting, JSON) wordt:

```json
{
  "layers": [
    { "id": "layer-1", "name": "Layer 1", "active": true, "rules": [ ...bestaande rule-vorm... ] },
    { "id": "layer-2", "name": "Open shoes", "active": true, "rules": [ ... ] }
  ]
}
```

- Legacy platte array (`[{field, operator, ...}, ...]`) → automatisch gewrapt als
  `{ layers: [{ id: 'layer-1', name: 'Layer 1', active: true, rules: <array> }] }` bij het lezen.
  Geen SQL-migratie nodig.
- Max 3 actieve lagen. Alleen voor `purchase-orders`; andere tabellen (`default_filter_json`)
  blijven ongewijzigd op de platte regel-vorm.
- Opslaan van een actieve laag zonder regels → 400.

## Backend

### `server/utils/odataSyncFilter.js`

- `normalizeSyncLayers(raw)` — accepteert legacy platte array, `{layers:[...]}`, of niets;
  retourneert altijd `{ layers: [...] }` met gevalideerde velden (`id`, `name`, `active: boolean`,
  `rules: array`). Valideert max 3 actieve lagen en "actieve laag zonder regels" (400).
- `recordMatchesAnyLayer(layers, headerRecord, lineRecords)` — OR over actieve lagen; elke laag
  gebruikt de bestaande `recordMatchesSyncRules`-logica (AND binnen de laag). Inactieve lagen
  slaan we over. Geen actieve lagen → `true` (ongefilterd, zoals nu).
- `compileSyncLayerChunks(layers, chunkSize)` — per actieve laag `compileSyncRulesChunks`,
  resultaat afgeplat tot één lijst van filter-strings (elke string wordt los als D365 `$filter`
  gebruikt en de resultaten worden gededupliceerd op orderkey — hergebruik van de bestaande
  dedup-lus in `purchaseOrdersFetch`).
- Unit tests in `odataSyncFilter.test.js`: legacy-wrap, max-3-lagen, lege-actieve-laag-validatie,
  OR-matching, chunk-afplatting.

### `server/services/TableDataService.js`

- `getPurchaseOrderSyncRules()` → blijft als **legacy-flatten-accessor** (alle regels van alle
  actieve lagen, AND-binnen-laag verloren) alleen waar nog een platte lijst nodig is
  (vendor-group-expansion helpers); nieuwe primaire accessor: `getPurchaseOrderSyncLayers()` en
  generieke `getTableSyncLayers(table)` (vervangt `getTableSyncRules` op de call-sites die met
  meerdere lagen moeten werken: regel 610, 2358, 3524, 3894, 5103).
- `purchaseOrdersFetch`: filterChunks over **alle actieve lagen** (`compileSyncLayerChunks`),
  bestaande dedup-lus ongewijzigd.
- `markOutOfScopeCacheRows` / `applySyncRetainedTransitions` / `listVendorValues`-leespad:
  `recordMatchesSyncRules` → `recordMatchesAnyLayer`.
- `saveSyncFilters`: payload wordt `{ layers }`; per actieve laag vendor-group-expansie en
  `clearSyncRetainedForTable` blijft **niet** meer blind alle lagen resetten — alleen de rijen die
  buiten de nieuwe combinatie van actieve lagen vallen. Nieuwe `unmarkInScopeCacheRows(pool,
  tableId, layers)`: rijen die weer matchen (bv. laag opnieuw actief) direct `removed_at_source =
  0` zetten, zodat eerder gecachte data direct terugkomt zonder op de nachtrun te wachten.
- `countSyncFilter`: itereert over actieve lagen, telt per laag en sommeert (chunks per laag
  blijven disjunct binnen die laag; over lagen heen dedupliceren op orderkey waar D365-round-trip
  nodig is — binnen budget: som als bovengrens, zoals nu ook al voor grote one-of's).

### `server/routes/data.js`

- `PUT /api/data/purchase-orders/sync-filters`: body wordt `{ layers }` i.p.v. `{ rules }`
  (backwards compatible: platte `rules`-body wordt server-side als één laag genormaliseerd).
- `POST /api/data/purchase-orders/sync-filters/count`: idem, `{ layers }`.

## Frontend

- `src/hooks/useSyncFilterLayers.js` (nieuw) — laag-CRUD (toevoegen tot max 3, hernoemen,
  actief/inactief, regels per laag), save, count-preview per laag. Geen JSX.
- `src/components/admin/datamodel/SyncFilterBuilder.jsx` (300+ regels) splitsen:
  - `SyncFilterBuilder.jsx` — laag-lijst + toolbar (nieuwe laag, max-3-indicator, save).
  - `SyncFilterLayerCard.jsx` (nieuw) — één laag: naam, actief-toggle, regel-editor (bestaande
    regel-UI hergebruiken), "count rows" per laag.
- Teksten in het Engels, Fluent UI v9-tokens; `readOnly`/`poLookupScoped`-tabellen (items,
  overige) blijven op de bestaande enkel-filter-UI (geen lagen — buiten scope voor die tabellen).

## Response-vorm `GET /datamodel`

`syncFilter.rules` wordt `syncFilter.layers` (array). `compiled` per laag i.p.v. één top-level
`compiled`. `inheritedRules`/`inheritedCompiled` (voor read-only/PO-lookup-scoped tabellen) blijven
enkelvoudig — die tabellen erven altijd de **effectieve OR van alle actieve PO-lagen**.

## Acceptatiecriteria — zie work item #325

1–7 zoals in `docs/devops/325-sync-filter-layers.md`.

## Volgorde van bouwen (met testcheckpoints)

1. `odataSyncFilter.js` — layer-utilities + unit tests (npm test op dit bestand groen).
2. `TableDataService.js` — accessors + fetch + scope + save/count (npm test volledige module).
3. `routes/data.js` — payload-vorm.
4. Frontend hook + UI-split.
5. `npm test` + `npm run build` volledig groen; versie-bump `src/config/version.js`.
6. Commit + push → preview-URL.

## Buiten scope

- Geen aparte "headers-only, geen lines"-modus per laag.
- Geen generalisatie naar andere tabellen dan Purchase Orders.
