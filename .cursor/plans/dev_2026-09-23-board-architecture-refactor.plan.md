---
name: Board Architecture Refactor
overview: "Gefaseerde refactor van de PO-boardketen: eerst gedragscontracten, daarna een diepe board-read-module, centraal cachebeheer, een kleiner frontend-boardmodel, uniforme autorisatie en een zelfstandige D365-refreshmodule."
isProject: false
---

# Board Architecture Refactor

> Uitvoering gebeurt per child User Story vanuit Azure DevOps via `develop-from-devops`. Iedere Story krijgt een eigen featurebranch, preview, review en verificatie voordat de volgende afhankelijke Story start.

## Doel

De PO-boardketen opdelen in diepe, testbare modules met kleine publieke interfaces, zonder functionele, security- of performancewijzigingen voor gebruikers.

## User story

**Als** ontwikkelteam  
**wil ik** dat board reads, caching, frontend-state, leveranciersautorisatie en D365-refresh duidelijke modulegrenzen en boundary-tests krijgen  
**zodat** wijzigingen veilig en zelfstandig kunnen worden ontwikkeld zonder de huidige monolithische services en hooks volledig te hoeven reconstrueren.

## Architectuurkeuze

We gebruiken een strangler-aanpak:

1. Bestaand gedrag wordt eerst als contract vastgelegd.
2. `TableDataService` blijft tijdens de migratie een compatibele facade.
3. De nieuwe board-read-module krijgt maximaal drie publieke entrypoints:
   - `read(options)`
   - `readRowDetails(options)`
   - `getRevision(options)`
4. Externe afhankelijkheden worden geïnjecteerd in logische clusters: registry, SQL/cache, settings, revision/projection en post-read hooks.
5. PO-specifiek gedrag blijft intern achter een vaste policy per `tableKey`; er komt nog geen openbaar plugin- of registratiemechanisme.
6. Nieuwe interne bronbestanden blijven onder 300 regels. Splitsing gebeurt op verantwoordelijkheid, niet alleen op bestandsgrootte.
7. HTTP-responses, supplier-scope, revision-semantiek en bestaande `Server-Timing`-labels blijven compatibel.
8. De board-read-module bezit alleen deduplicatie van gelijktijdige requests. De board-cachemodule bezit alleen voltooide snapshots en invalidatie; dezelfde inflight-Map wordt nooit door beide beheerd. `BoardWarmup` behoudt altijd zijn eigen single-flight rond de volledige tweestaps-warmupactie (`readBoardSnapshot` gevolgd door `readRccpPoRows`) en neemt geen read-deduplicatie over.
9. Gedeelde board-caches blijven gesleuteld op `(tableKey, supplierAccount)` — nooit op `userId`. Per-gebruiker-gedrag wordt opgelost door de lezer user-neutraal te laten lezen, niet door de cache te vermenigvuldigen. Zie Fase 2.

## Waarom deze keuze

- Een mechanische bestandssplit verkleint `TableDataService.js`, maar laat de koppeling intact.
- Een openbaar preset- of policyregister is nu niet nodig en vergroot de interface.
- Volledige ports-and-adapters op iedere pure helper zou te veel indirection toevoegen.
- De gekozen hybride houdt de publieke interface klein en isoleert alleen SQL, settings, caches en side effects achter testbare grenzen.

## Buiten scope

- Geen nieuw boardgedrag of UI-functionaliteit.
- Geen wijziging van SQL-schema of opgeslagen board-layoutformaat.
- Geen wijziging van D365-filterresultaten, supplier-rechten of API-responsevelden.
- Geen algemene herschrijving van alle grote RCCP-, BI- en adminbestanden.
- Geen gelijktijdige uitvoering van onafhankelijke Stories als zij dezelfde bestanden wijzigen.

## Bekende latente bugs die deze refactor bewust meeneemt

Deze refactor is verder gedragsbehoudend, met exact drie uitzonderingen. Alle drie zijn bestaande
defecten die pas zichtbaar worden zodra het gedrag achter een contract wordt gelegd. Ze worden
hier expliciet benoemd, zodat een Fase 0-contracttest niet per ongeluk het foute gedrag vastlegt
en een reviewer weet dat de gedragswijziging bedoeld is.

**B1 — Inflight-key mist twee opties.** `readInflightKey` in `server/services/TableDataService.js`
bevat vandaag `tableKey`, `userId`, `supplierAccount`, `includeDetails`,
`includeChangeDecorations`, `partitionKey` en `recordKey`, maar **niet** `includeRemoved` en
`supplierFilterColumn`. Twee gelijktijdige reads die alleen daarin verschillen, delen nu ten
onrechte één resultaat. Daarnaast normaliseert de key niet: `read({ tableKey, userId })` en
`read({ tableKey, userId, includeDetails: true })` leveren verschillende keys op voor dezelfde
read, waardoor legitieme deduplicatie wordt gemist.
*Fase 0 legt het huidige gedrag vast. Story 1B draait het om naar de negendelige genormaliseerde
key en past de contracttest in dezelfde PR aan.*

**B2 — Gedeelde board-snapshot draagt per-gebruiker-markeringen.** Rijen uit `read()` bevatten
`isNew`/`isChanged` die berekend worden ten opzichte van de `lastViewedAt` van de lezende
gebruiker. `BoardSnapshotCache` sleutelt op `(tableKey, supplierAccount)` maar geeft wél `userId`
door aan `read()`, dus de eerste lezer bepaalt welke markeringen alle volgende BI-/RCCP-lezers
zien.
*Fase 2 dicht dit door de snapshotlezer user-neutraal te maken — niet door `userId` aan de key toe
te voegen (zie Fase 2 → Publieke interface voor waarom dat laatste een perf-regressie zou zijn).*

**B3 — Suppliers kunnen persoonlijke runtime-links laten meewegen in een gedeelde read.**
`loadRuntimeHeaderLinks(pool, userId, boardKey, { includeStaffLinks: true })` laat de eigen links
van de gebruiker winnen van de samengevoegde staff-links. De board-settingsroute accepteert deze
velden ook voor suppliers, terwijl de code en UI ze als board-brede staffconfiguratie behandelen.
Een user-neutrale snapshot uit B2 zou dit gedrag impliciet veranderen.
*Fase 2 maakt staff-links daarom de enige canonieke bron voor gedeelde snapshots en voorkomt dat
suppliers `lineTotalHeaderLinks` en `lineValueHeaderLinks` opslaan of terugkrijgen als persoonlijke
override. Dit is een bewuste security- en consistentiefix en krijgt eigen regressietests.*

## Globale acceptatiecriteria

1. De PO-boardresultaten voor staff en suppliers zijn functioneel gelijk aan de huidige situatie, met uitzondering van de expliciet benoemde B1, B2 en B3.
2. De JSON-shape van `GET /api/data/purchase-orders` blijft compatibel.
3. Revision-, collapsed-detail-, lookup-, formule-, track-change- en supplier-scopegedrag blijven behouden.
4. Bestaande `tb_*` en relevante snapshot-`Server-Timing`-labels blijven aanwezig.
5. Er komen geen extra API-calls, SQL-queries in loops of seriële reads in een bestaande parallelle read-fase.
6. Alle nieuwe of gewijzigde kernmodules krijgen co-located tests.
7. Gewijzigde componenten blijven onder 300 regels; bij 250 regels of meer wordt opnieuw beoordeeld of splitsing nodig is.
8. Iedere code-Story verhoogt `src/config/version.js` volgens semantic versioning.
9. Iedere Story doorloopt `npm run test:changed`, de relevante node/dom-testprojecten, `npm run build` en de geschaalde `final-check-feature`.
10. Iedere Story is testbaar op de feature-preview; localhost blijft aanvullend beschikbaar op `http://localhost:5178`.
11. Performance wordt vergeleken met Fase 0 op vijf runs met hetzelfde account, scenario en datavolume. De Story faalt bij meer dan 10% én meer dan 100 ms regressie op de mediane totale requesttijd, of bij meer dan 20% regressie op een bestaand `tb_*` onderdeel dat in de nulmeting minimaal 100 ms duurde.
12. **Koude start.** Naast de warme meting van AC 11 wordt de user-perceived eerste PO-board-load gemeten na vijf afzonderlijke containerherstarts, telkens direct nadat de healthcheck groen wordt en met de normale asynchrone startup-warmup actief. Vergelijk de mediaan met Fase 0; dezelfde grens van meer dan 10% én meer dan 100 ms geldt. Registreer per run of de warmup nog liep. Dit meet de mogelijke concurrentie tussen de directe PO-board-read en de BI/RCCP-warmup; het PO-board gebruikt zelf geen `BoardSnapshotCache`-entry.
13. **Zichtbaar gedrag.** Iedere Story die `src/` raakt toont aantoonbaar gelijk gedrag op de preview voor: board laden, een filter toepassen en wissen, een cel bewerken (optimistic save plus rollback bij fout), en tab-switch met behoud van de actieve view. Geverifieerd met `browser-feature-test`, staff-account; supplier-account waar de Story supplier-gedrag raakt.

## DevOps-structuur

Maak één **Feature** aan:

**Titel:** Board architecture refactor  
**Tags:** `refactor; architecture; purchase-orders; table-data; caching; testing`

Maak onderstaande fasen als child **User Stories**. Splits Fase 1 in Story 1A en 1B en Fase 6 in Story 6A en 6B, omdat extractie en caller-omschakeling afzonderlijk gereviewd en teruggedraaid moeten kunnen worden. Fase 0, 1A en 1B zijn verplicht sequentieel. Fase 2 en 3 mogen pas na Story 1B starten. Fase 4 en 5 starten na de relevante onderliggende module.

## Wat al bestaat en wordt hergebruikt

- `server/utils/timing.js` levert de bestaande request-scoped `time()`- en `mark()`-instrumentatie.
- `src/utils/api.js` is de verplichte frontend-API-boundary en registreert frontendtiming.
- `server/services/TableDataService.test.js` bevat bestaande tests voor veel pure helpers.
- `server/services/BoardSnapshotCache.test.js` bevat bestaande signature- en invalidatietests.
- `src/utils/purchaseOrdersBoardMapping.test.js`, `src/utils/tableViewFilterUtils.test.js` en bestaande board-viewtests blijven de basis voor regressiedekking.
- De routes en middleware gebruiken al `requireSession`, rollen, page permissions en geparameteriseerde MSSQL-queries.
- `server/services/BoardWarmup.js` warmt na opstart en na een refresh de gedeelde board- en KPI-caches voor de staff-scope (`supplierAccount: null`). Dit blijft bestaan en is bepalend voor de keuzes in Fase 2.

### Testprojecten — let op de routering

`vitest.workspace.mjs` kent twee projecten en routeert op pad, niet op inhoud:

| Project | Include | Omgeving |
|---------|---------|----------|
| `node` | `server/**/*.test.{js,jsx}`, `scripts/**/*.test.{js,mjs}`, `src/utils/**/*.test.js` | node |
| `dom` | `src/**/*.test.{js,jsx}` **minus** `src/utils/**/*.test.js` | jsdom |

Gevolg: een test onder `src/utils/` draait in **node**, niet in dom. Filters op `npm run test:dom`
die naar `src/utils/` wijzen matchen niets en melden stil groen. De verificatiecommando's verderop
houden hier rekening mee.

---

## Fase 0 — Gedragscontracten en nulmeting

### Doel

Het huidige gedrag vastleggen voordat productielogica wordt verplaatst.

### Bestanden

- Wijzigen: `server/services/TableDataService.test.js`
- Maken: `server/services/board-read/boardReadContract.test.js`
- Maken: `src/hooks/usePurchaseOrdersPage.test.jsx`
- Hergebruiken: `src/utils/purchaseOrdersBoardMapping.test.js`
- Hergebruiken: `server/services/BoardSnapshotCache.test.js`
- Wijzigen: `src/config/version.js`

### Werk

1. Voeg een vaste board-read-fixture toe voor `purchase-orders`.
2. Leg de response vast voor:
   - staff;
   - supplier-scope;
   - `includeDetails: false`;
   - `includeChangeDecorations: false`;
   - één record via `partitionKey` en `recordKey`.
3. Leg inflight-deduplicatie vast: twee identieke gelijktijdige reads voeren één onderliggende read uit. Leg hierbij expliciet het **huidige** gedrag van B1 vast — dus dat reads die alleen in `includeRemoved` of `supplierFilterColumn` verschillen vandaag samenvallen — met een verwijzing naar B1 in de test, zodat duidelijk is dat Story 1B deze assertie omdraait.
4. Leg vast welke timing-labels per scenario worden aangeroepen.
5. Test `usePurchaseOrdersPage` op:
   - initiële load en mapping;
   - revision zonder gewijzigde data;
   - optimistic cell save;
   - settings-persist;
   - rollback na een API-fout.
6. Registreer een performance-nulmeting voor PO-board load met `perf-review` in regression-modus; geen nieuwe benchmarkinfrastructuur. Meet **twee** situaties met een ingelogd staff-account: vijf warme reads in stabiele toestand en vijf user-perceived eerste loads na afzonderlijke containerherstarts volgens globale AC 12. `BoardWarmup` vult alleen BI/RCCP-snapshots; noteer bij koude runs de mogelijke SQL/CPU-concurrentie met de directe PO-board-read.

### Acceptatiecriteria

1. De tests slagen tegen de ongewijzigde productie-implementatie, inclusief de tests die B1 als huidig gedrag vastleggen.
2. De fixture bevat minimaal één masterrij, detailregels, lookup, formule, track-change-meta en supplier-filterveld.
3. De contracttest detecteert het verwijderen of hernoemen van bestaande responsevelden.
4. De timingtest detecteert het verdwijnen van bestaande read-chokepoints.
5. De nulmeting vermeldt totale requesttijd en de belangrijkste `tb_*` onderdelen, voor zowel de warme als de koude situatie.

### Niet doen

- Geen productielogica verplaatsen.
- Geen snapshots opnemen met timestamps of andere instabiele waarden zonder normalisatie.

---

## Fase 1 — Diepe board-read-module

### Doel

`read` en `readExecute` uit `TableDataService.js` halen achter één kleine, testbare module-interface.

### Publieke interface

- `read(options)` voor een volledige, inflight-gededupliceerde board-read.
- `readRowDetails(options)` voor lazy-loaded detailregels.
- `getRevision(options)` voor revision-controle door routes en caches.
- `createBoardReadService(dependencies)` is alleen composition/test-wiring en geen applicatie-entrypoint.

`read(options)` vereist `tableKey` en gebruikt exact deze defaults: `includeRemoved=false`, `userId=null`, `supplierAccount=null`, `supplierFilterColumn='vendorAccount'`, `includeDetails=true`, `includeChangeDecorations=true`, `partitionKey=null` en `recordKey=null`. De inflight-key is `JSON.stringify()` van een typed tuple met alle negen genormaliseerde waarden. Daardoor blijven `null` (staff) en `''` (supplier zonder account, dus nul zichtbare rijen) onderscheidbaar en worden gelijktijdige staff-, supplier-, detail- en include-removed-reads nooit samengevoegd.

Dit is de omzetting van **B1** en levert twee winsten op: reads die alleen in `includeRemoved` of `supplierFilterColumn` verschillen vallen niet meer ten onrechte samen, en reads die alleen verschillen doordat een default expliciet is meegegeven dedupliceren nu wél. Normaliseer vóór het bouwen van de key, niet erna.

De bestaande `TableDataService.read`, `readRowDetails` en `getRevision` blijven tijdelijk delegates zodat callers niet tegelijk hoeven te veranderen.

### Nieuwe module

- Maken: `server/services/board-read/index.js`
- Maken: `server/services/board-read/createBoardReadService.js`
- Maken: `server/services/board-read/read.js`
- Maken: `server/services/board-read/readContext.js`
- Maken: `server/services/board-read/readCacheRows.js`
- Maken: `server/services/board-read/readDecorations.js`
- Maken: `server/services/board-read/detailReadPlan.js`
- Maken: `server/services/board-read/buildBoardRows.js`
- Maken: `server/services/board-read/buildDetailRow.js`
- Maken: `server/services/board-read/filterVisibleRows.js`
- Maken: `server/services/board-read/buildBoardResponse.js`
- Maken: `server/services/board-read/purchaseOrderReadPolicy.js`
- Maken: `server/services/board-read/defaultDependencies.js`
- Maken of verplaatsen: co-located tests per module met businesslogica.

### Te wijzigen

- `server/services/TableDataService.js`
- `server/utils/supplierRowAccess.js` om board-read als dependency te injecteren in plaats van de huidige lazy `require('../services/TableDataService')` binnen de functies. Er is vandaag géén load-time cyclus — de lazy require vermijdt die al. De winst is testbaarheid en een expliciete afhankelijkheid, niet het breken van een cyclus.
- `server/services/BoardWarmup.js` — de bestaande `inFlight`-variabele blijft behouden, omdat die de volledige tweestapsactie dedupliceert en niet alleen één board-read.
- `src/config/version.js`

### Interne verantwoordelijkheden

- `read.js`: defaults, inflight-key en deduplicatie.
- `readContext.js`: parallel laden van metadata, kolommen, links, revision, settings en decoraties.
- `readCacheRows.js`: SQL voor masters, details en custom values.
- `readDecorations.js`: history, track marks en ledger.
- `detailReadPlan.js`: aggregate-, fields- en full-detailplanning.
- `buildBoardRows.js`: rij-assemblage en meetpunten.
- `filterVisibleRows.js`: sync layers, items-filter en supplier-scope.
- `buildBoardResponse.js`: stabiele response-envelope, stale/retention/meta.
- `purchaseOrderReadPolicy.js`: uitsluitend PO-specifieke keuzes; geen openbaar register.
- `defaultDependencies.js`: productie-wiring naar bestaande services en utilities.

### Migratievolgorde

1. Verplaats pure helpers met bestaande tests en re-export ze tijdelijk vanuit `TableDataService`.
2. Verplaats cache-SQL en decoratiequeries zonder de SQL-tekst inhoudelijk te wijzigen.
3. Verplaats row-assembly en projectie.
4. Zet `readExecute` achter `createBoardReadService`.
5. Laat `TableDataService.read` delegeren.
6. Verplaats `readRowDetails` en deel dezelfde detailprojectie.
7. Verplaats revision-read en laat `TableDataService.getRevision` delegeren.
8. Verwijder uitsluitend aantoonbaar dode helpers/exports.

### DevOps-splitsing

**Story 1A — Board-read internals extraheren**

- Levert `readCacheRows`, decoraties, detailplanning, row-assembly en responsebouw als interne modules op.
- `TableDataService.read` blijft in deze Story de actieve orchestrator en roept de uitgehaalde onderdelen aan.
- Is zelfstandig klaar wanneer alle Fase 0-contracttests groen blijven en geen productiecalls zijn omgezet.

**Story 1B — Board-read orchestrator activeren**

- Levert `createBoardReadService`, inflight-deduplicatie en de drie publieke entrypoints op.
- Zet `TableDataService.read`, `readRowDetails` en `getRevision` om naar compatibiliteitsdelegates.
- Injecteert `read` in `supplierRowAccess`; `supplierRowAccess` importeert daarna niet meer zelf `TableDataService`.
- Is zelfstandig klaar wanneer alle callers, timinglabels en contracttests via de nieuwe orchestrator werken.

### Acceptatiecriteria

1. Alle contracttests uit Fase 0 blijven groen, met één benoemde uitzondering: de inflight-test die B1 als huidig gedrag vastlegt, wordt in Story 1B in dezelfde PR omgezet naar de negendelige genormaliseerde key. Dit is een bewuste bugfix binnen de refactor, geen regressie. Elke andere wijziging aan een Fase 0-contracttest is een blocker.
2. `TableDataService.read` bevat alleen compatibiliteitsdelegatie en geen read-orchestratie.
3. Geen nieuw modulebestand is groter dan 300 regels.
4. Geen nieuwe circulaire imports zijn aanwezig.
5. SQL-queryvormen en parallelle readstructuur zijn functioneel gelijk.
6. Server-Timing-labels blijven aanwezig en de resultaten blijven binnen de globale numerieke performancegrens.
7. Bestaande callers kunnen gedurende de migratie via `TableDataService` blijven werken.
8. Tests bewijzen dat verschillen in `includeRemoved` en `supplierFilterColumn` afzonderlijke inflight-reads opleveren, dat `supplierAccount: null` niet botst met `supplierAccount: ''`, en dat impliciete en expliciete defaults wel dedupliceren.

---

## Fase 2 — Centraal cache- en invalidatiebeheer

### Doel

Eén eigenaar maken voor voltooide board-snapshots, signatures en invalidatie. Request-inflight-deduplicatie blijft uitsluitend in de board-read-module.

### Bestanden

- Wijzigen: `server/services/BoardSnapshotCache.js`
- Wijzigen: `server/services/BoardSnapshotCache.test.js`
- Wijzigen: `server/routes/bi.js`
- Wijzigen: `server/services/TableDataService.js`
- Wijzigen: `server/services/TableRegistryService.js`
- Wijzigen: `server/services/TableColumnsService.js`
- Wijzigen: `server/services/ProductAttributeBoardColumnsService.js`
- Wijzigen: `server/services/ExcelLinkService.js`
- Wijzigen: `server/utils/supplierRowAccess.js`
- Wijzigen: `server/utils/runtimeHeaderLinks.js`
- Wijzigen: `server/utils/runtimeHeaderLinks.test.js`
- Wijzigen: `server/routes/supplier.js`
- Wijzigen: `server/services/BoardWarmup.js`
- Wijzigen: `server/services/RccpAnalysisService.js`
- Maken: `server/services/board-cache/BoardCacheCoordinator.js`
- Maken: `server/services/board-cache/boardContentSignature.js`
- Maken: bijbehorende co-located tests
- Wijzigen: `src/config/version.js`

`BoardWarmup` en `RccpAnalysisService` staan hier omdat zij de overige directe
consumenten van `BoardSnapshotCache` zijn (`readBoardSnapshot`, `readRccpPoRows`). Zij mogen niet
op de nieuwe `getOrLoad` worden gezet: `readBoardSnapshot` en `readRccpPoRows` **blijven bestaan**
als dunne, benoemde wrappers bovenop de coordinator, zodat de aanroepende code onveranderd blijft
en de bedoeling ("lees het gedeelde board-snapshot") leesbaar blijft.

### Publieke interface

- `getOrLoad({ tableKey, supplierAccount, variant, signature }, loader)`
- `invalidate(tableKey, reason)`
- `rememberSupplierVisibleKeys({ tableKey, supplierAccount, supplierFilterColumn, signature }, keys)`
- `contentSignature(revisionParts)`
- `readBoardSnapshot({ tableKey, supplierAccount })` en `readRccpPoRows({ tableKey, supplierAccount, revision, parts })` blijven als bestaande wrappers bovenop `getOrLoad`.

De varianten zijn exact `snapshot`, `kpi` en `supplier-keys`. Snapshot- en KPI-key bevatten
`tableKey` en `supplierAccount`; de supplier-key bevat daarnaast `supplierFilterColumn`. Snapshot
en KPI gebruiken de bestaande safety-TTL van 12 uur; supplier-keys gebruikt 60 seconden.
Revision/signature blijft het primaire versheidsmechanisme.

#### `userId` hoort niet in de cachekey

`userId` zit bewust **niet** in de key, en verdwijnt ook uit de signatuur van `getOrLoad`.
`BoardWarmup` warmt met `supplierAccount: null` en zonder gebruiker; een user-gescopeerde key zou
betekenen dat geen enkele ingelogde gebruiker de warme snapshot nog raakt. Gemeten op PROD,
22-09-2026: 23,9 s koud tegen ~6,0 s warm — die 23,9 s zou terugkomen per gebruiker, en elke
gebruiker zou een eigen volledige rijen-snapshot in het 1 GiB containergeheugen houden. Zie ook de
toelichting in `BoardWarmup.js` zelf, die dezelfde afweging voor suppliers maakt.

Het onderliggende probleem (**B2**) wordt in plaats daarvan bij de bron opgelost: `readBoardSnapshot`
doet een **user-neutrale** read met `userId: null` en `includeChangeDecorations: false`, precies
zoals `readRccpPoRows` dat vandaag al doet. Daarmee bevatten de gecachete rijen geen
`isNew`/`isChanged` meer die aan de `lastViewedAt` van de eerste lezer hangen, blijft de cache
gedeeld, blijft de warmup effectief en blijft het geheugengebruik begrensd. BI en RCCP consumeren
die per-gebruiker-decoraties niet.

De kolomdefinities in `meta.columns` zijn aantoonbaar user-neutraal: `read()` bouwt ze uit
`TableRegistryService.listColumns` plus lookup-enrichment en projecteert persoonlijke
board-settings daar niet in. Er komt daarom geen per-user kolomcache. Runtime header-links kunnen
wel rowwaarden beïnvloeden; B3 maakt daarvoor de samengevoegde staff-links de canonieke bron.

### Werk

1. Verplaats de gedeelde content-signature naar één pure functie.
2. Laat board-, KPI- en BI-snapshots dezelfde signaturebron gebruiken.
3. Verwijder de lokale `biSnapshotCache` en `contentSignature` uit `server/routes/bi.js`.
4. Maak `readBoardSnapshot` user-neutraal (B2): `userId: null`, `includeChangeDecorations: false`, en verwijder `userId` uit de cachekey en uit `getOrLoad`.
5. Maak runtime-links canoniek (B3): gedeelde snapshots gebruiken uitsluitend `loadStaffRuntimeHeaderLinks`; supplier-board-settings mogen `lineTotalHeaderLinks` en `lineValueHeaderLinks` niet als persoonlijke override opslaan of teruggeven.
6. Houd supplier-keycache gescopeerd op supplier, tabel en revision.
7. Centraliseer expliciete invalidatie uitsluitend voor mutaties waarvan een test bewijst dat de content-signature gelijk blijft. Geldige redenen zijn `content-write`, `column-schema`, `sync-settings`, `refresh-complete`, `lookup-schema` en `row-exclusion`.
8. `TableRegistryService.invalidateTableCache` blijft eigenaar van metadata-cache-invalidatie en roept de coordinator alleen aan wanneer de bewijs-test uit stap 7 dat vereist.

#### Invalidatie: eerst bewijzen dat hij nodig is

De signatuur is vandaag het primaire versheidsmechanisme en dekt de meeste schrijfwegen al
impliciet: `saveCustomValue` beweegt `maxCustomValueAt`, kolommutaties bewegen `maxColumnsAt`,
`excludeRows`/`includeRows` bewegen `maxExclusionAt`/`exclusionCount`, een refresh beweegt
`syncedAt`, en `saveSyncFilters` beweegt via `app_settings.updated_at` het bestaande
`settingsAt`-signatuurdeel. De expliciete invalidatie in `saveSyncFilters` is daardoor momenteel
defense-in-depth en mogelijk redundant; de bewijs-test bepaalt of die aanroep blijft.

Voeg daarom **geen** expliciete invalidatie toe aan een schrijfweg zonder bewijs. Voor elke
kandidaat hieronder geldt: schrijf eerst een test die aantoont dat de signatuur ná de mutatie
ongewijzigd blijft. Blijft de signatuur gelijk, dan komt er een `invalidate(tableKey, reason)` bij
met die test ernaast. Verandert de signatuur, dan komt er geen aanroep en noteer je dat als
dekkend in de test.

Kandidaten om zo te toetsen:

- `TableDataService.saveCustomValue`, `correctField`, `correctAllDetailFields`, `excludeRows`, `includeRows`, `saveSyncFilters` en refresh-completion;
- kolommutaties in `TableColumnsService`;
- productattribuutkolommen in `ProductAttributeBoardColumnsService`;
- dataset- en relationmutaties in `ExcelLinkService`.

De verwachting is dat de meeste hiervan géén extra aanroep nodig hebben. Dat is het doel: elke
overbodige invalidatie gooit een warme snapshot weg die een koude read van ~24 s kost om opnieuw
op te bouwen.

### Acceptatiecriteria

1. Elke mutatie leidt aantoonbaar tot verse board-, BI-, KPI- en supplier-data, hetzij via een gewijzigde signatuur, hetzij via een expliciete `invalidate` met bijbehorende test; redundant expliciet invalideren is verwijderd.
2. `settingsAt` en andere inhoudsbepalende revisiondelen worden consistent meegenomen.
3. Geen route bezit nog een eigen board-snapshot-Map.
4. Supplier A kan nooit cachedata van supplier B of staff ontvangen.
5. Cache-hit, cache-miss en invalidatie zijn aantoonbaar met boundary-tests.
6. De warme read blijft binnen de globale numerieke performancegrens (AC 11).
7. Tests bewijzen dat een gedeelde snapshot geen per-gebruiker `isNew`/`isChanged`-markeringen bevat (B2), en dat KPI-rows veilig binnen dezelfde supplier-scope worden gedeeld.
8. Een test bewijst dat `BoardWarmup` na deze fase precies de staff-scope snapshot- en KPI-entry vult die de eerstvolgende BI/RCCP-read hergebruikt. Het plan claimt niet dat de directe PO-boardroute deze cache-entry gebruikt. De user-perceived koude PO-boardmeting blijft binnen globale AC 12.
9. Geen cachekey bevat `userId`.
10. Tests bewijzen dat suppliers geen persoonlijke runtime-links kunnen laten meewegen in een gedeelde snapshot en dat canonieke staff-links voor staff en suppliers gelijk worden toegepast (B3).

---

## Fase 3 — Frontend board-model en persistence

### Doel

`usePurchaseOrdersPage.js` terugbrengen tot een compositiehook met stabiele deelinterfaces.

### Nieuwe conventie: `src/features/`

Deze fase introduceert `src/features/` in een repo die vandaag vlak is (`src/hooks/`,
`src/components/`, `src/utils/`). Dat is de gewenste richting, maar zonder vastlegging ontstaat er
permanent een tweede vindplaats. Leg de regel daarom in deze Story vast in een ADR
(`docs/adr/007-board-feature-mappen.md`, volgend op de bestaande ADR-006):

- Nieuwe board- en view-logica gaat naar `src/features/<domein>/<laag>/`.
- Bestaande hooks en utils blijven staan tot een Story ze inhoudelijk aanraakt; dan verhuizen ze mee.
- Iedere featuremap heeft één `index.js` als publieke ingang; van buiten de map wordt nooit een diep pad geïmporteerd.

Let daarnaast op de testroutering: `src/features/**` valt onder het **dom**-project, ook voor
volledig pure modules. Puur rekenkundige modellen betalen dan onnodig de jsdom-setup (~25 s per
bestand). Breid in deze Story `vitest.workspace.mjs` uit zodat pure modeltests in het
node-project draaien — bijvoorbeeld door `src/features/**/*.model.test.js` aan de node-`include`
toe te voegen en in de dom-`exclude` op te nemen — en hanteer die naamconventie voor
`purchaseOrdersBoardApi`, `purchaseOrderViewState` en `purchaseOrderGroupingModel`.

### Nieuwe modules

- Maken: `src/features/purchase-orders/board/usePurchaseOrdersBoardData.js`
- Maken: `src/features/purchase-orders/board/usePurchaseOrdersBoardSettings.js`
- Maken: `src/features/purchase-orders/board/usePurchaseOrdersBoardMutations.js`
- Maken: `src/features/purchase-orders/board/usePurchaseOrdersBoardColumns.js`
- Maken: `src/features/purchase-orders/board/usePurchaseOrdersTableContract.js`
- Maken: `src/features/purchase-orders/board/purchaseOrdersBoardApi.js`
- Maken: `src/features/purchase-orders/board/index.js`
- Maken: `src/features/purchase-orders/page/usePurchaseOrdersPageViews.js`
- Maken: `src/features/purchase-orders/page/usePurchaseOrdersPageContentProps.js`
- Maken: `src/features/purchase-orders/page/index.js`
- Maken: co-located tests voor iedere hook met businesslogica

### Te wijzigen

- `src/hooks/usePurchaseOrdersPage.js`
- `src/components/supplier/PurchaseOrdersPage.jsx`
- `src/components/supplier/PurchaseOrdersPageContent.jsx`
- `src/utils/boardSettingsPersist.js`
- `src/utils/boardColumnSettings.js`
- `src/utils/purchaseOrdersBoardMapping.js`
- `vitest.workspace.mjs`
- Maken: `docs/adr/007-board-feature-mappen.md`
- `src/config/version.js`

### Interfaces

- `usePurchaseOrdersBoardData` retourneert vier stabiele groepen: `data` (`orders`, `lineDetails`, `syncedAt`, `stale`, `hasCache`, `staleThresholdMinutes`, `total`, `newCount`, `changedCount`, `trackChangesMeta`), `status` (`loading`, `refreshing`, `markingViewed`, `error`), `refreshActions` (`refresh`, `finishRefresh`, `setRefreshError`, `reloadAfterRefresh`, `reload`) en `viewActions` (`markViewed`).
- `usePurchaseOrdersBoardSettings` retourneert vijf stabiele groepen: `layout` (visibility, order, widths, collapsed keys), `formatting` (text styles, format rules, totals en links), `preferences` (product image en date-period modes), `status` (`savingColumns`) en `actions` (de bestaande save-, collapse-, image-, export- en applyhandlers).
- `usePurchaseOrdersBoardMutations` retourneert één groep `actions` met `deleteRows`, `saveValue`, `correctField`, `patchLinkedLineValues` en `toggleWriteback`.
- `usePurchaseOrdersBoardColumns` retourneert twee groepen: `columns` (`headerColumns`, `lineColumns`, `visibleHeaderColumns`) en `actions` (`addColumn`, `addHeaderColumnAfter`, `updateFormulaColumn`, `renameColumn`, `updateStatusOptions`, `removeColumn`, `reorderHeaderColumn`, `reorderLineColumn`, `setLineColumnTotal`, `addLineTotalHeaderLink`, `addLineValueHeaderLink`).
- `usePurchaseOrdersPage` retourneert exact vier groepen: `data`, `settings`, `mutations` en `columns`; consumenten worden in dezelfde Story op dit gegroepeerde contract gezet.
- `usePurchaseOrdersPageViews` retourneert `savedViewState` en `boardViewForContent`.
- `usePurchaseOrdersPageContentProps` retourneert `status` en `tableContext`.
- `usePurchaseOrdersTableContract` retourneert `table` en `trackChangesMeta`.

### Werk

1. Splits eerst `PurchaseOrdersPage.jsx` onder 300 regels met `usePurchaseOrdersPageViews.js` en `usePurchaseOrdersPageContentProps.js`, zonder gedrag te wijzigen.
2. Splits eerst `PurchaseOrdersPageContent.jsx` onder 300 regels door de bestaande `data`, `layout`, `formatting`, `cellActions`, `columnActions`, `linkActions` en `table` memo's naar `usePurchaseOrdersTableContract.js` te verplaatsen.
3. Verplaats uitsluitend netwerk- en dataloadlogica naar de datahook.
4. Verplaats settings-state en de persist-queue naar één hook.
5. Verplaats write/correct/rollback naar de mutationhook.
6. Verplaats afgeleide kolomconfiguratie naar de columnhook.
7. Behoud stabiele referenties met `useMemo` en `useCallback`.
8. Zet alle consumenten om naar het gegroepeerde vierdelige facadecontract.
9. Voeg per featuremap een `index.js` toe.

### Acceptatiecriteria

1. `usePurchaseOrdersPage.js` blijft onder 300 regels.
2. Geen gewijzigde hook retourneert meer dan tien top-level waarden.
3. Geen nieuwe raw `fetch`; alle backend-calls gebruiken `apiRequest`.
4. Geen inline JSX-handlers worden toegevoegd.
5. Load, revision-skip, optimistic save, settings-persist en rollback zijn boundary-getest.
6. De pagina doet niet meer API-calls dan vóór de refactor.
7. De bestaande boardweergave en gebruikersinteracties blijven gelijk, aangetoond via globale AC 13.
8. `docs/adr/007-board-feature-mappen.md` bestaat en beschrijft de `src/features/`-conventie.
9. Pure modeltests onder `src/features/` draaien in het node-project, niet in jsdom.

---

## Fase 4 — Zichtbaar-board-state: filters, sessie en saved views

### Doel

De bestaande lifecycle voor filteren, sorteren, groeperen, session overlay en opgeslagen views verdiepen achter één modulegrens en dubbele board-viewconstructie verwijderen. Het reeds geïmplementeerde `clearActiveViewFilterSession` blijft behouden.

### Bestanden

- Wijzigen: `src/hooks/usePurchaseOrderBoardView.js`
- Wijzigen: `src/hooks/usePurchaseOrderTableView.js`
- Wijzigen: `src/hooks/usePurchaseOrderGrouping.js`
- Wijzigen: `src/hooks/usePurchaseOrderSavedViewState.js`
- Wijzigen: `src/hooks/usePurchaseOrderTableSession.js`
- Wijzigen: `src/utils/tableViewFilterUtils.js`
- Wijzigen: `src/utils/poTableSessionState.js`
- Wijzigen: `src/utils/viewTabs.js`
- Wijzigen: `src/components/supplier/PurchaseOrdersBoardTable.jsx`
- Maken: `src/features/purchase-orders/view/usePurchaseOrderViewState.js`
- Maken: `src/features/purchase-orders/view/usePurchaseOrderDerivedRows.js`
- Maken: `src/features/purchase-orders/view/purchaseOrderViewState.js`
- Maken: `src/features/purchase-orders/view/purchaseOrderGroupingModel.js`
- Maken: `src/features/purchase-orders/view/index.js`
- Maken: co-located lifecycle-tests
- Wijzigen: `src/config/version.js`

### Werk

1. Splits eerst `usePurchaseOrderTableView.js` en `usePurchaseOrderSavedViewState.js` onder 300 regels door pure serialisatie, diff en session-bridge naar `purchaseOrderViewState.js` te verplaatsen.
2. Splits eerst `usePurchaseOrderBoardView.js` onder 300 regels door linked-value-, date-period- en activity-afleiding naar `usePurchaseOrderDerivedRows.js` te verplaatsen.
3. Splits eerst `usePurchaseOrderGrouping.js` onder 300 regels door pure groupbouw en kleurresolutie naar `purchaseOrderGroupingModel.js` te verplaatsen.
4. Groepeer het returncontract van `usePurchaseOrderBoardView` in maximaal zes stabiele top-level waarden: `items`, `filtering`, `sorting`, `grouping`, `totals` en `persistence`; zet alle consumenten in dezelfde Story om.
5. Definieer één serialiseerbaar view-statecontract voor filters, sortering, groepering en layoutverwijzingen.
6. Centraliseer apply, clear, save, restore en dirty-statevergelijking, waarbij het bestaande directe wissen via `clearActiveViewFilterSession` contractueel behouden blijft.
7. Verwijder de tweede fallback-constructie van `boardView` uit de tabel.
8. Laat saved views en session restore dezelfde normalisatie gebruiken.

### Acceptatiecriteria

1. De bestaande test dat een gewist filter niet terugkeert na tab- of paginaswitch blijft groen.
2. Saved-view apply en session restore leveren dezelfde zichtbare rijen op.
3. All Orders en conditionele opmaak behouden het huidige gedrag.
4. De tabel maakt niet zelfstandig een tweede board-viewmodel.
5. Filter-, grouping- en saved-view-hooks blijven ieder onder 300 regels.
6. Geen gewijzigde viewhook retourneert meer dan tien top-level waarden.
7. Nieuwe pure modellen (`purchaseOrderViewState`, `purchaseOrderGroupingModel`) volgen de `*.model.test.js`-conventie uit Fase 3 en draaien in het node-project.
8. Globale AC 13 is aangetoond, met nadruk op filter toepassen/wissen en tab-switch.

---

## Fase 5 — Uniforme supplier-autorisatie

### Doel

Pad-, rij- en kolomrechten samenbrengen in één expliciete autorisatiebeslissing.

### Bestanden

- Wijzigen: `server/middleware/dataAccess.js`
- Wijzigen: `server/routes/data.js`
- Wijzigen: `server/routes/supplier.js`
- Wijzigen: `server/utils/supplierRowAccess.js`
- Wijzigen: `server/utils/supplierScope.js`
- Wijzigen: `server/services/RowRemarksService.js`
- Wijzigen: `server/services/RowRemarksSearchService.js`
- Wijzigen: `server/services/RowActivityService.js`
- Maken: `server/services/SupplierBoardAuthorizationService.js`
- Maken: `server/services/SupplierBoardAuthorizationService.test.js`
- Wijzigen: relevante supplier-isolatie- en routetests
- Wijzigen: `src/config/version.js`

### Publieke interface

- `authorizeBoardAction({ user, action, tableKey, partitionKey=null, recordKey=null, columnId=null, remarkId=null })` retourneert `Promise<void>` en werpt een fout met status 400, 401, 403 of 404 volgens de matrix.
- `getAuthorizedRowKeys({ user, tableKey })` retourneert de zichtbare row-keyset voor collectiequeries zoals remarks search, summary en has-comment.
- Routes voeren geen eigen aanvullende supplier-regels uit; ownershipregels voor een bestaande remark blijven in `RowRemarksService`.

### Autorisatiematrix

- `read-board`, `read-columns`, `mark-viewed`: supplier is alleen toegestaan voor `purchase-orders`; board-read levert uitsluitend eigen scope.
- `read-details`, `read-history`, `read-remarks`, `read-activity`: vereist `purchase-orders` plus een rij binnen supplier-scope.
- `search-remarks`, `remarks-summary`, `has-comment`: collectieactie op `purchase-orders`; het SQL-resultaat wordt geïntersecteerd met `getAuthorizedRowKeys`.
- `create-remark`, `toggle-reaction`: vereist rijscope; bestaande regels voor auteurschap en reaction ownership blijven in `RowRemarksService`.
- `save-value`, `correct-field`, `correct-all-details`: vereist rijscope én `vendorEditable` op de met `columnId` geladen doelkolom.
- `exclude-rows`, `include-rows`, kolom-, datamodel-, syncfilter- en refreshbeheer: supplier krijgt altijd 403.
- Ontbrekende of ongeldige identifiers geven 400; niet-ingelogd geeft 401; buiten scope of verboden actie geeft 403; een toegestane maar niet-bestaande resource behoudt 404.

### Werk

1. Leg de autorisatiematrix als constants en parametrische tests vast.
2. Combineer route-allowlist, row visibility en `vendorEditable`.
3. Gebruik de board-read/cacheboundary voor zichtbare keys zonder een recursieve volledige board-read.
4. Vervang herhaalde route-asserts en service-side supplierchecks door de centrale service; auteurschap van remarks blijft in de remarksservice.
5. Sluit remarks, remarks-search en activity expliciet op dezelfde rijscope aan.
6. Behoud `requireSession`, rollen en page permissions als buitenste middlewarelagen.

### Acceptatiecriteria

1. Iedere supplier-write wordt op pad, rij en kolom gecontroleerd.
2. Staffgedrag blijft ongewijzigd.
3. Ontbrekende autorisatie-aanroep bij een beschermde route wordt door routetests gedetecteerd.
4. Autorisatie veroorzaakt geen extra volledige board-read per actie.
5. Inputs voor table-, record- en column keys worden gevalideerd.
6. Routetests dekken voor iedere matrixrij minimaal staff toegestaan, supplier in-scope toegestaan, supplier out-of-scope 403 en supplier verboden actie 403.
7. IDOR-tests bewijzen dat gewijzigde `partitionKey`, `recordKey`, `columnId` en `remarkId` geen toegang buiten supplier-scope geven.

---

## Fase 6 — Zelfstandige D365-refreshmodule

### Doel

D365-fetch, sync-filtering, SQL-merge, progress en invalidatie uit `TableDataService` halen.

### Nieuwe module

- Maken: `server/services/table-refresh/index.js`
- Maken: `server/services/table-refresh/createTableRefreshService.js`
- Maken: `server/services/table-refresh/refreshTable.js`
- Maken: `server/services/table-refresh/buildRefreshPlan.js`
- Maken: `server/services/table-refresh/applySyncFilters.js`
- Maken: `server/services/table-refresh/mergeRefreshRows.js`
- Maken: `server/services/table-refresh/reportRefreshProgress.js`
- Maken: co-located tests

### Te wijzigen

- `server/services/TableDataService.js`
- `server/services/D365ODataService.js`
- `server/services/RefreshRunService.js`
- `server/utils/odataSyncFilter.js`
- `server/utils/vendorGroupSyncFilter.js`
- `server/utils/refreshCascadeOrder.js`
- `server/routes/admin.js`
- `server/routes/internalNightRefresh.js`
- `server/routes/data.js`
- `server/services/board-cache/BoardCacheCoordinator.js`
- `src/config/version.js`

### Publieke interface

De nieuwe module behoudt exact de bestaande signatures:

- `startRefresh(tableKey, options = {})`
- `refresh(tableKey, options = {})`
- `getRefreshProgress(tableKey)`
- `isRefreshRunning(tableKey)`

`TableDataService` houdt deze vier functies tijdens Story 6A als delegates. Caller-cutover gebeurt pas in Story 6B.

### Werk

1. Houd OAuth/paging/write-back in `D365ODataService`; refresh-orchestratie verhuist.
2. Bouw één refreshplan voor cascade, select-fields, filters, retention en merge.
3. Gebruik dezelfde gecanonicaliseerde sync-regels voor OData en lokale zichtbaarheid.
4. Isoleer chunked SQL-merge en revision-update.
5. Laat een succesvolle refresh `syncedAt`/revision precies eenmaal publiceren; de gewijzigde content-signature maakt bestaande snapshots stale. Voeg geen expliciete `invalidate` toe, tenzij de Fase 2-bewijs-test aantoont dat de signature onverwacht gelijk blijft.
6. Laat handmatige en nachtelijke refresh dezelfde service gebruiken.
7. Houd de bestaande warmup-volgorde intact: `RefreshRunService.finishRun` roept na een geslaagde run `BoardWarmup.warmBoardCaches({ reason: 'refresh-done' })` aan nadat de nieuwe revision/signature zichtbaar is. Verplaats die aanroep niet naar de refreshmodule; de warmup moet de nieuwe signature laden en de oude snapshot vervangen.

### DevOps-splitsing

**Story 6A — Refreshmodule extraheren**

- Verplaatst orchestratie, planning, merge en progress achter de vier compatibele signatures.
- Laat alle routes en jobs via `TableDataService` werken.
- Is klaar wanneer bestaande refresh- en night-refreshtests zonder callerwijzigingen groen zijn.

**Story 6B — Callers omschakelen en facade verkleinen**

- Zet `server/routes/data.js` en `server/routes/internalNightRefresh.js` om naar de nieuwe refreshmodule.
- Verwijdert daarna de vier refreshdelegates uit `TableDataService`.
- Is klaar wanneer een repositorybrede zoekopdracht geen directe afhankelijkheid van verplaatste refresh-internals meer toont.

### Acceptatiecriteria

1. Handmatige en nachtelijke refresh leveren dezelfde data en progresssemantiek.
2. De bestaande sync-filterresultaten blijven gelijk.
3. Een succesvolle merge verhoogt revision precies eenmaal; de volgende cachetoegang en de refresh-warmup herkennen de oude signature als stale zonder redundante expliciete invalidatie.
4. Een mislukte fetch of merge laat geen run als succesvol eindigen.
5. Externe calls en zware merge-operaties behouden afzonderlijke timingmetrics.
6. `TableDataService` bevat na deze fase geen refresh-orchestratie meer.
7. Een geslaagde refresh warmt daarna nog steeds de board- en KPI-caches; een test bewijst dat de warmup pas draait nadat de nieuwe revision/signature zichtbaar is.
8. `server/services/TableDataService.js` is teruggebracht van 5992 naar **maximaal 2500 regels**.

---

## Apart vervolgwerk — niet in deze Feature

De volgende bestanden verdienen refactoring, maar horen inhoudelijk niet in dezelfde Feature. Maak hiervoor afzonderlijke backlogitems zodat de board-refactor geen algemene codebase-cleanup wordt:

### Componenten boven de 300-regelgrens

- `src/components/supplier/PurchaseOrdersSubitemsTable.jsx`
- `src/components/rccp/RccpMatrixTable.jsx`

### Grote backend- en RCCP-modules

- `server/services/TableColumnsService.js`
- `server/services/RccpAnalysisService.js`
- `server/utils/tableFormulaEngine.js`
- `server/services/ExcelLinkService.js`
- `server/services/RccpSettingsService.js`
- `server/services/RowActivityService.js`
- `server/services/RowRemarksService.js`
- `src/components/rccp/rccpUtils.js`
- `src/hooks/useDataModelAdmin.js`
- `server/utils/rccpKpis.js`
- `server/utils/rccpPoSegments.js`

### Shallow of mogelijk dode abstracties

- `src/hooks/usePurchaseOrdersBoardTableProps.js`: productiecode gebruikt deze hook momenteel niet; apart beslissen tussen gebruiken en verwijderen. Er bestaat wél een test (`src/hooks/usePurchaseOrdersBoardTableProps.test.jsx`) — die gaat bij verwijderen mee, anders blijft er een test over die niets in productie dekt.
- Kolommenu-hooks en prop-fan-out: pas aanpakken na Fase 3 en 4, wanneer de nieuwe board- en viewcontracten stabiel zijn.

## Definition of Done per Story

1. Story-acceptatiecriteria zijn aantoonbaar groen.
2. Relevante tests, `npm run typecheck` en build slagen.
3. UI-, performance- en security-review zijn geschaald uitgevoerd.
4. Gewijzigde componenten en hooks voldoen aan de bestandsgrootte- en stategrenzen.
5. De appversie is verhoogd.
6. De feature-preview is functioneel getest voor staff en, waar relevant, supplier — voor Stories die `src/` raken volgens globale AC 13.
   Voor Stories die de cacheketen raken (Fase 1, 2 en 6) hoort daar ook de koude meting van globale AC 12 bij.
7. De PR bevat commits met `#AB:<story-id>`.
8. De DevOps Story bevat testresultaat, preview-URL en eventuele relevante architectuurbeslissing.

## Verificatiecommando's per Story

> `src/utils/**/*.test.js` hoort bij het **node**-project (zie "Testprojecten — let op de
> routering"). Een `test:dom`-filter dat naar `src/utils/` wijst matcht niets en meldt stil groen.
> De commando's hieronder zijn daarop gecorrigeerd.

- Fase 0: `npm run test:node -- server/services/TableDataService.test.js server/services/board-read/boardReadContract.test.js server/services/BoardSnapshotCache.test.js src/utils/purchaseOrdersBoardMapping.test.js`; `npm run test:dom -- src/hooks/usePurchaseOrdersPage.test.jsx`; `npm run build`.
- Story 1A en 1B: `npm run test:node -- server/services/TableDataService.test.js server/services/board-read`; `npm run test:node -- server/routes/data.supplier-isolation.test.js server/utils/supplierRowAccess.test.js server/services/BoardWarmup.test.js`; `npm run build`.
- Fase 2: `npm run test:node -- server/services/BoardSnapshotCache.test.js server/services/board-cache server/services/BoardWarmup.test.js server/services/RccpAnalysisService.test.js server/services/TableRegistryService.test.js server/services/TableColumnsService.test.js server/services/ProductAttributeBoardColumnsService.test.js server/services/ExcelLinkService.test.js server/utils/supplierRowAccess.test.js server/utils/runtimeHeaderLinks.test.js server/routes/supplier.viewState.test.js`; `npm run build`.
- Fase 3: `npm run test:dom -- src/features/purchase-orders/board src/hooks/usePurchaseOrdersPage.test.jsx`; `npm run test:node -- src/utils/purchaseOrdersBoardMapping.test.js src/features/purchase-orders`; `npm test`; `npm run build`.
- Fase 4: `npm run test:dom -- src/features/purchase-orders/view src/hooks/usePurchaseOrderTableView.test.js src/hooks/usePurchaseOrderSavedViewState.test.js src/hooks/usePurchaseOrderBoardView.test.jsx`; `npm run test:node -- src/utils/tableViewFilterUtils.test.js src/features/purchase-orders/view`; `npm run build`.
- Fase 5: `npm run test:node -- server/services/SupplierBoardAuthorizationService.test.js server/routes/data.supplier-isolation.test.js server/utils/supplierRowAccess.test.js server/services/RowRemarksSearchService.test.js`; `npm run build`.
- Story 6A en 6B: `npm run test:node -- server/services/table-refresh server/services/RefreshRunService.test.js server/services/BoardWarmup.test.js server/routes/admin.d365-refresh.test.js server/routes/internalNightRefresh.start-failed.test.js server/utils/refreshCascadeOrder.test.js server/utils/refreshProgress.test.js`; `npm run build`.
- Na de gerichte commando's draait iedere Story ook `npm run test:changed`, `npm run typecheck` en de geschaalde `final-check-feature`.

## Volgorde en afhankelijkheden

1. Fase 0.
2. Story 1A.
3. Story 1B.
4. Fase 2.
5. Fase 3.
6. Fase 4 na Fase 3.
7. Fase 5 na Fase 2.
8. Story 6A na Story 1B en Fase 2.
9. Story 6B na Story 6A.

De Feature is gereed wanneer Fase 0 tot en met 6 zijn afgerond. Het aparte vervolgwerk blokkeert de Feature niet.
