# Plan: DEV op PROD-snelheid brengen én PROD sterker maken

**Datum:** 21 september 2026
**Status:** werkdocument — bevindingen bewezen, werkpakketten nog niet gebouwd
**Vervangt:** `2026-09-21-dev-prod-laadtijd-po-bi-rccp.plan.md` (eerste versie; correcties in §5)
**Aanleiding:** DEV voelt trager dan PROD op de PO-tabel, de BI-pagina en Performance & Planning.

---

## 1. Einddoel

Twee doelen, expliciet gescheiden omdat ze verschillende maatregelen vragen:

| # | Doel | Klaar wanneer |
|---|---|---|
| **A** | **DEV even snel als PROD** | Dezelfde actie (koud én warm) duurt op DEV binnen 20% van PROD, gemeten met Server-Timing |
| **B** | **PROD sneller dan nu** | De eerste PO-tabel-load van de werkdag kost niet langer dan een willekeurige tweede load |

Doel A is grotendeels een omgevingsprobleem. Doel B is de eerste koude read van de dag. De snapshotcache (§4) verklaart *wanneer* die klap valt. Hij maakt de query niet goedkoper. Wat die query duur maakt — de JSON-blob en de volledige detail-read — staat in §6.

---

## 2. Wat we zeker weten — omgeving

Gemeten op 21 september 2026 via `az containerapp`, geen aannames.

| | vendorportal-**dev** | vendorportal-**prod** |
|---|---|---|
| `minReplicas` | **0** | **1** |
| `maxReplicas` | **2** | **1** |
| `cooldownPeriod` | 300 s | 300 s |
| CPU / geheugen | 0,5 vCPU / 1 GiB | 0,5 vCPU / 1 GiB |
| Revisie aangemaakt | 21-09 15:11:39Z | 15-09 11:23:11Z |
| Replica draait sinds | 21-09 15:14:26Z | 21-09 **07:18:55Z** |

**Health-probe (beide wakker):** DEV 533 ms → 183 ms, PROD 261 ms → 185 ms. Warm zijn ze identiek.

Conclusies:

1. **Hardware is identiek.** Het verschil zit volledig in het replica-beleid, niet in de SKU.
2. **DEV valt na 5 minuten inactiviteit naar nul.** Eerste bezoeker daarna betaalt container-start + Node-boot + lege cache.
3. **DEV mag naar 2 replica's, PROD naar 1.** De snapshotcache is een in-memory `Map` per instance, dus een tweede replica start leeg en halveert de effectieve hitrate. Opschalen maakt deze app bij de huidige architectuur **langzamer**, niet sneller.
4. **PROD wordt ook herstart.** De PROD-revisie is van 15 september, maar de replica is op 21 september om 07:18:55Z aangemaakt — Azure-onderhoud zonder deploy. Ook dan is de cache leeg.

---

## 3. Wat we zeker weten — code (`main` → `develop`, 38 commits)

Bevindingen uit de diff, met bestand en regel. Alle vijf zijn echt; de vraag is alleen hoe zwaar ze wegen ten opzichte van §2.

| # | Bevinding | Plek | Raakt |
|---|---|---|---|
| C1 | `analyze()` draait `buildRccpPoKpisPair()` **twee keer** (requested + confirmed) over dezelfde `poRows` | `RccpAnalysisService.js:498` | Performance-pagina, PERF-tab |
| C2 | `boardKpis()` draait `buildRccpPoKpiByOrder()` twee keer; `compactByOrder()` bouwt per set een **eigen** sku-index, dus de payload gaat richting 2× | `RccpAnalysisService.js:580`, `rccpKpiCompact.js:15-17` | KPI-tab, prefetch |
| C3 | Client aggregeert **beide** datasets bij elke wijziging van de zichtbare orders — dus bij elke filterklik | `usePoBoardKpis.js:68-82` | Klik-latency PO-tabel |
| C4 | `resolveSyncLayers()` roept `resolveSyncRules()` **per laag** aan; bij een vendor-group-regel is dat een volledige `SELECT data_json` over de hele vendors-tabel, zonder cache | `TableDataService.js:1029-1046` | Elke PO-read + vendorlijst op PO/BI/RCCP |
| C5 | De detail-read wacht op `planCollapsedDetailRead()` (kolommen + links + lookups + items-check). Slaat de aggregatie niet aan, dan is dat pure wachttijd | `TableDataService.js:3832` | PO-tabel-load |

**Versterkende factor:** `dataPagesPrefetch.js:85-97` haalt ná board-idle zowel `/rccp/board-kpis` als `/rccp/analysis` op, op de PO-tabelpagina zelf. C1 en C2 drukken dus óók op de PO-tabel, niet alleen op de tabs. Dit bestand is ongewijzigd tussen main en develop — de prefetch is niet nieuw, de last die hij ophaalt wel.

**Nuance bij C4:** alleen actief als een laag een vendor-group-regel bevat. In vijf minuten vast te stellen uit de DEV-configuratie.

**Wat níét de oorzaak is:** de granulaire instellingen-permissies (`requirePagePermission` zit alleen op admin-/datamodel-routes, niet op het PO-leespad), onboarding, vendor-editable kolommen, test-infrastructuur, de `vite.config.js`-wijziging (dev-server only). De kolomheader van de PO-tabel werd juist lichter.

---

## 4. De rode draad: de snapshotcache

Dit verklaart *wanneer* een load seconden duurt. *Waarom* de onderliggende read duur is, staat in §6. Alles hieronder komt samen in `server/services/BoardSnapshotCache.js`.

- Het is een **in-memory `Map`** (regel 25-26) — per container-instance, weg bij elke herstart.
- Invalidatie gaat via een **content-signatuur** (regel 40-57) die onder meer `syncedAt` bevat.
- Uit de code-comment (regel 22-23), jullie eigen meting op Azure DEV, 4 september 2026:
  > *"koude RCCP-read 18,2 s tegen 8-13 ms warm"*

Een factor ~1500. Elke bevinding uit §3 verdwijnt in de ruis van één koude cache.

**Wanneer is de cache koud?**

| Situatie | DEV | PROD |
|---|---|---|
| Na 5 min inactiviteit (scale-to-zero) | **ja** | nee |
| Bij opschalen naar replica 2 | **ja** | n.v.t. |
| Na een deploy | ja | ja |
| Na een Azure platform-herstart | ja | **ja** (bewezen: 21-09 07:18Z) |
| **Na de nachtsync van 03:00** | ja | **ja, elke werkdag** |

Die laatste rij is doel B. Er draait een Logic App `vendorportal-night-refresh-prod` die dagelijks om **03:00 (W. Europe)** `/api/internal/night-refresh` aantikt. Die sync zet `last_full_sync_at`, dat zit in de content-signatuur, dus om 03:00 wordt élke snapshot ongeldig — terecht, want de data is veranderd.

Gevolg: **de eerste medewerker of leverancier die 's ochtends de PO-tabel opent, betaalt op productie de volledige koude read. Elke werkdag opnieuw.** Niemand rapporteert dat als bug, omdat "de eerste keer 's ochtends duurt even" voelt als normaal.

---

## 5. Correcties op de eerste planversie

Voor wie de vorige versie al las — vier punten zijn achterhaald of onjuist:

1. **"Azure DEV `/api/health`: geen antwoord binnen 15 s; PROD direct ok."** Gemeten met DEV wakker: 183 ms tegen 185 ms, identiek. Die 15 seconden was een slapende container, geen trage omgeving. De observatie klopte, de conclusie niet — en fase 3 van dat plan rustte erop.
2. **"Items-filtercheck mag bij twijfel het snelle pad niet uitzetten."** Die conservatieve fallback (`TableDataService.js:3658`) bestaat omdat bij een actief items-regelfilter per regel bepaald wordt of die meetelt; een SQL-rollup per order is dan simpelweg fout. Bij twijfel aggregeren levert verkeerde ordertotalen. Het probleem is de **blokkerendheid**, niet de conservatieve keuze. Zie W8.
3. **"Sync-filterlagen: fase 4, alleen bij bewijs."** Te laag ingeschat. C4 zit in het hot path en is met één blik op de configuratie te bevestigen.
4. **Feitelijk:** de lokale tak stond niet op "develop + 1 commit / v1.71.0" maar is identiek aan `origin/develop` op `v1.70.5`, met uncommitte wijzigingen. En de BI-pagina stond op "middel verdacht" terwijl `BoardSnapshotCache.js`, `routes/bi.js` en `dataPagesPrefetch.js` alle drie ongewijzigd zijn tussen main en develop — de enige realistische routes zijn de gedeelde backend en de prefetch.

Wat uit die eerste versie **overeind blijft** en hier is overgenomen: meten vóór fixen, expliciete stopcriteria, niet terugdraaien zonder bewijs, en de waarschuwing dat lokaal ≠ Azure DEV.

---

## 5b. Meting 21-09 — de PO-read op DEV ⚠️ *dit verandert de prioriteiten*

Eerste echte meting tegen Azure DEV, ingelogd als admin, drie runs achter elkaar met een warme container (`/api/data/purchase-orders`).

| | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| Wandklok | 49.854 ms | 47.642 ms | 47.217 ms |
| `app` (serverwerk) | 49.655 ms | 47.453 ms | 47.060 ms |
| **`tb_read_details`** | **46.644 ms** | **45.347 ms** | **45.334 ms** |
| `tb_build_rows` | 2.724 ms | 1.886 ms | 1.572 ms |
| Payload | 1.360 KB | 1.360 KB | 1.360 KB |
| Rijen | 917 | 917 | 917 |

**Datavolume (uit `/datamodel`):** 938 master-rijen, **73.177 detail-rijen**.

Wat dit zegt:

1. **De PO-tabel-read kost 47 seconden. Structureel, niet incidenteel.** Run 2 en 3 zijn even traag als run 1, dus dit is géén cold start en géén koude snapshotcache — deze route gebruikt `BoardSnapshotCache` niet. De login ervóór kostte 801 ms.
2. **Eén query is 96% van de tijd.** `tb_read_details` = 45 s van de 47 s. Al het andere samen (masters, lookups, links, ledger, track marks) is ~2 s.
3. **Het schaalt superlineair.** De baseline van 22 juli: `tb_read_details` = 33 ms bij 80 masters / 240 regels. Nu: 45.334 ms bij 938 masters / 73.177 regels. 305× meer regels, 1.374× meer tijd.
4. **De payload is klein** (1,4 MB, 917 rijen zonder detailregels). De tijd gaat dus niet naar data overbrengen, maar naar de query zelf.

**Vermoedelijke oorzaak — nog te bewijzen:** beide takken van het nieuwe leesplan draaien `JSON_VALUE(data_json, '$.veld')` per veld over alle detailrijen (`collapsedDetailFields.js:201-209`, `collapsedDetailRollup.js:43-47`), soms als `COALESCE` van twee expressies. Over 73k rijen zonder computed column of index betekent dat een volledige scan met JSON-parsing per rij per veld. In `main` haalde de detail-query gewoon `data_json` op en parste Node het — kosten verplaatst van Node naar SQL, waar ze duurder blijken.

**Dit is nog geen bewezen regressie.** Het kan zijn dat `main` bij dit volume net zo traag was; de juli-baseline draaide op speelgoeddata. Alleen M2 (PROD) of M3 (lokaal `main` vs `develop`, zelfde database) kan dat uitmaken. Dat is nu de belangrijkste openstaande meting.

**Gevolg voor de volgorde:** §6 stond al op "`data_json` is de structurele beperking". Deze meting bevestigt dat en maakt het urgent. W1 (warmup) en W2 (DEV-scaling) lossen dit **niet** op — ze raken de BI/RCCP-snapshot, niet de board-read. Zolang `tb_read_details` 45 s is, is elke andere optimalisatie ruis.

---

## 5c. Meting 21-09 — PROD naast DEV 🔴 *regressie bewezen*

Zelfde drie runs tegen productie, zelfde script, zelfde testaccount.

| | **DEV** (develop) | **PROD** (main) |
|---|---|---|
| master-rijen in cache | 938 | 2.190 |
| **detail-rijen in cache** | **73.177** | **70.675** |
| Rijen in de response | 917 | 2.190 |
| Payload | 1.360 KB | 2.667 KB |
| **`tb_read_details`** (mediaan) | **45.334 ms** | **4.629 ms** |
| `app` totaal (mediaan) | 47.060 ms | 11.681 ms |
| Login | 801 ms | 697 ms |

**Caveats uitgesloten:**

- **Zelfde SQL-server, zelfde tier.** `vendorportal-dev-db` en `vendorportal-prod-db` staan allebei op `sql-vp-ne-20260628`, allebei **Basic, capacity 5**. Geen hardwareverschil.
- **Vergelijkbaar detailvolume.** 73.177 tegen 70.675 — 3,5% verschil.
- **PROD doet méér werk.** 2.190 orders in de response tegen 917, en bijna dubbele payload.
- **Geen cold start.** Logins van 0,7–0,8 s op beide; run 2 en 3 even traag als run 1.

**Conclusie: de detail-read in `develop` is ~10× trager dan in `main` bij gelijk volume op identieke hardware.** Dat is een regressie, geen omgevingsverschil en geen datavolume-effect. De vermoedelijke bron is commit `56b98bd` ("perf: laat SQL de rollup van ingeklapte detailregels rekenen"), die `JSON_VALUE`-expressies in de detail-query introduceerde waar `main` simpelweg `data_json` ophaalt.

**Tweede bevinding — raakt doel B rechtstreeks:** PROD doet er met 10–12 s zelf ook lang over, op **Basic tier met 5 DTU**. Dat is voor 70.000 rijen extreem krap en het is de multiplier onder alle andere bevindingen: bij een DTU-plafond wordt een query die 2× duurder is niet 2× maar 10× trager. Zie W16.

**Opvallende posten op PROD** die op DEV wegvallen in de ruis: `tb_lookup_pav_pivot` 3,1–3,5 s en `tb_build_rows` 3,0–3,5 s. Die worden zichtbaar zodra `tb_read_details` normaal is, en horen bij W14 (lookups) en W10 (rijopbouw).

---

## 5d. W0b — uitgevoerd, wacht op deploy

Code toegevoegd (nog niet op DEV):

- `server/utils/timing.js` — `mark(label, durMs)`: registreert een benoemd feit zonder gemeten blok, zelfde no-op-gedrag buiten een request. Zeven tests in `timing.test.js`, groen.
- `server/services/TableDataService.js` — `planCollapsedDetailRead()` opgesplitst: de bestaande logica heet nu `resolveCollapsedDetailPlan()`, de wrapper meet hem als `tb_detail_plan` en markeert de uitkomst als `tb_detail_plan_aggregate` / `_fields` / `_none`.

Na de eerstvolgende DEV-deploy staat in de Server-Timing-header welke leestak draait én wat het plannen zelf kost (dat laatste is precies C5/W8). Tests van `TableDataService`, `collapsedDetailRollup` en `collapsedDetailFields`: 133 groen.

---

## 5e. Meting 21-09 ná deploy — oorzaak aangewezen 🎯

Drie runs op DEV met de W0b-instrumentatie erop (v1.71.2), ná de deploy en ná de e2e-job.

| | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| `app` | 46.435 ms | 46.176 ms | 47.836 ms |
| `tb_read_details` | 44.330 ms | 44.368 ms | 45.540 ms |
| `tb_detail_plan` | 940 ms | 1.095 ms | 1.596 ms |
| **`tb_detail_plan_fields`** | **aanwezig** | **aanwezig** | **aanwezig** |

**De modus is `fields`.** De SQL-rollup (`aggregate`) draait niet en heeft hier nooit gedraaid. De 44 seconden gaan volledig naar `buildDetailProjectionSql()`: één `JSON_VALUE(data_json, '$.veld')` per veld — soms een `COALESCE` van twee — over alle 73.177 detailrijen.

**Waarom `aggregate` afvalt:** de items-tabel heeft één sync-filterregel, `ProductType eq …` op **header**-niveau. `itemsLineFilterConfigured()` kijkt alleen óf er een default filter op items staat, niet of die per PO-regel effect heeft, en geeft dus `true`. Daarop stopt `resolveCollapsedRollupPlan()` meteen (`collapsedDetailRollup.js:70`). Dat filter bestaat al sinds juli (`2026-07-22-items-d365-sync-filter.plan.md`), dus de snelle tak van commit `56b98bd` is op deze configuratie **nooit actief geweest** — alleen de trage.

**Bevestiging van C5:** `tb_detail_plan` (940–1.596 ms) loopt vrijwel exact gelijk op met `tb_lookups` (940–1.595 ms). Het plannen wacht dus volledig op de lookup-enrichment, en de detail-read wacht op het plan. Reëel, maar klein naast de 44 s.

### Fix-opties, op volgorde van risico

1. **`fields` laten vallen en terugvallen op de volledige blob** *(aanbevolen — dit is W8, nu concreet)*. Kan `aggregate` niet, lees dan `data_json` zoals `main` doet, in plaats van de projectie. PROD bewijst de uitkomst: 4,6 s in plaats van 44 s bij hetzelfde volume en dezelfde tier. De projectie bespaart bytes over de SQL-verbinding maar kost een orde aan parsewerk in de database — op Basic/5 DTU funest. Diff: één returnpunt in `planCollapsedDetailRead()`, bij voorkeur achter een schakelaar zodat beide takken te meten blijven.
2. **`itemsLineFilterConfigured()` preciezer maken** zodat een *header*-filter op items de aggregatie niet blokkeert. Grotere winst (SQL rekent de rollup, er komen bijna geen rijen terug), maar dit raakt correctheid: er moet eerst vaststaan dat zo'n filter inderdaad geen PO-regels uit scope haalt. Niet doen vóór die analyse — zie §5 punt 2.
3. **W12** (vaste kolommen met index naast de JSON). Structureel de juiste oplossing en maakt zowel de projectie als het filteren goedkoop, maar het grootste werk.

Doen: 1 nu, 3 als structurele lijn, 2 alleen met een uitgeschreven correctheidsanalyse.

---

## 6. Breder dan de warmup

De warmup (W1) is een pleister: hij zorgt dat de eerste gebruiker de dure read niet zelf betaalt. De read blijft even duur voor wie de cache mist (leverancier, tweede replica, mislukte warmup). Dit stuk gaat over die kosten zelf. Niet zoeken in Redis zolang onderstaande niet gemeten is.

### SQL — `data_json` is de structurele beperking

Alle order- en regeldata staat in `dbo.tb_cache.data_json` (`NVARCHAR(MAX)`, `011_tb_metamodel.sql`). De primary key en `IX_tb_cache_record` vinden de rij. Ze helpen niet bij het *lezen*: elke koude board-read (`readCacheRows`, `TableDataService.js` rond de masters-/details-query) haalt de volledige JSON van alle masters op, en van de details óf een rollup óf dezelfde blob. Node parset daarna alles. Een filter op leverancier, status of datum kan die kolom niet gebruiken; `JSON_VALUE` in een `WHERE` (sync-lagen, lookup-distinct) scant de blob. Nóg een index op de bestaande sleutel, of de uitkomst in Redis bewaren, verandert dat niet.

Drie ingrepen, in deze volgorde:

1. **Minder JSON lezen.** Het ingeklapte bord heeft al een SQL-rollup (`planCollapsedDetailRead`, mode `aggregate`) die totalen in de database uitrekent in plaats van elke regel mee te sturen. Valt het plan terug op `fields` of `null`, dan gaat alsnog de detail-blob mee — dat is dan de grootste SQL-winst, zonder cache. Dit is W0b + W8, geen nieuw idee.
2. **Alleen de kolommen van de huidige view ophalen (W11).** Nu gaat het hele `data_json`-record mee, ook kolommen die de opgeslagen view niet toont. Een smalle projectie per view verkleint de SQL-read én de payload.
3. **Een paar vaste kolommen naast de JSON (W12).** Leverancier, status en de twee leverdatums als echte kolommen met een index, gevuld bij de sync. Dan kan SQL filteren en groeperen zonder `JSON_VALUE` over de hele tabel. De vendor-group-resolve (C4 / W7) hoort hier: die leest nu `data_json` van álle vendor-rijen. De leveranciersrekening is de eerste van die kolommen, want zonder die kolom kan W15 de read niet in SQL beperken.

### Twee paden naast de 45 seconden *(ná de detail-query, niet ervoor)*

§5b: als admin is `tb_read_details` 45 s en de rest samen ~2 s. Onderstaande lost die 45 s niet op. Wel twee reads die nu de volledige blob betalen en het meeste weggooien.

- **Lookups (W14).** `loadSingleLookup` leest elke 30 seconden (`LOOKUP_ENRICHMENT_TTL_MS`) de volledige `data_json` van vendors, items, Excel en ontvangstregels. De klok vervangen door de inhouds-signatuur van die brontabel, en alleen de sleutel plus de gekoppelde velden selecteren. Eén lopende load tegelijk bestaat al.
- **Leverancier (W15).** `readCacheRows` haalt alle masters en details op; Node filtert daarna op `supplierAccount` (`TableDataService.js` rond de supplier-scope). Een leverancier betaalt dus dezelfde 45 s en gooit de rest weg. De staff-warmup dekt die scope niet. Ná W12 (leveranciersrekening als kolom) die rekening in de `WHERE` van master, detail en custom zetten. Niet alleen in Node aanscherpen, en geen `JSON_VALUE` in de `WHERE`.

### App — ná een warme read

In de baseline van 22 juli is de PO-board-load 1779 ms, waarvan **1389 ms render**. Dat dominates zodra SQL niet meer koud is, en het maakt DEV niet gelijk aan PROD. Het bord is al gevirtualiseerd (`PurchaseOrdersBoardRows.jsx`). De winst zit in minder herberekening, niet in een tweede cache:

- Niet beide KPI-sets (requested én confirmed) bij elke filterklik opnieuw uitrekenen (C3 / W6).
- De prefetch ná board-idle (`dataPagesPrefetch.js`) haalt `/rccp/board-kpis` én `/rccp/analysis` op de PO-pagina zelf. Dat is een tweede zware read op hetzelfde scherm (W13), los van of de snapshot warm is.

### Wat dit verandert aan de rest van het plan

- W1 blijft nuttig voor de eerste medewerker om 08:00. Het is niet de structurele fix.
- W3 (Redis of SQL-snapshot) pas nadat een warme meting laat zien dat de koude read, ná W11/W12, nog steeds de klap is. Een persistente kopie van de volledige blob bewaart het probleem.
- Eerst Server-Timing splitsen: `tb_read_masters`, `tb_read_details`, en client-render. Dat kiest tussen smallere SQL en een lichtere tabel.

---

## 7. Werkpakketten

Volgorde is "goedkoop bewijs eerst, daarna grootste effect". Nummering is stabiel; gebruik W-nummers in commits en work items.

### W0 — Twee onbekenden wegnemen (± 30 min)

Beide blokkeren een dure beslissing verderop.

- **W0a — ✅ GEDAAN 21-09, uitkomst: C4 vervalt.** DEV heeft 2 actieve sync-lagen: laag 1 met één regel op `PurchaseOrderStatus`, laag 2 met één regel op `PurchaseOrderNumber`. **Nul** vendor-group-regels en **nul** line-level regels. `resolveSyncRules()` keert dus direct terug (`TableDataService.js:1032`) zonder vendors-scan. **W7 vervalt** voor de huidige configuratie — wel houden als latente valkuil zodra iemand een vendor-group-filter instelt.
- **W0b — ✅ GEBOUWD 21-09, wacht op DEV-deploy.** Zie §5d. `tb_detail_plan` (duur van het plannen) en `tb_detail_plan_<mode>` (welke tak) staan vanaf de volgende deploy in de Server-Timing-header.

### W16 — SQL-tier: Basic/5 DTU is de bodem onder alles ⭐ *nieuw, doel A én B*

`vendorportal-dev-db` en `vendorportal-prod-db` draaien allebei op **Basic, capacity 5** (server `sql-vp-ne-20260628`). Voor 70.000+ detailrijen is dat de goedkoopste tier die Azure aanbiedt: 5 DTU, 2 GB cap, geen read-replica, minimale IO.

Dit is geen verklaring die de regressie uit §5c wegneemt — die is gemeten op identieke tier — maar het is wel de **multiplier**: bij een DTU-plafond wordt een query die 2× meer werk doet niet 2× maar een orde trager, omdat hij tegen het plafond aanloopt in plaats van door te rekenen. Het verklaart ook waarom PROD met 10–12 s zelf niet snel is.

Voorstel: PROD naar minimaal **Standard S2 (50 DTU)** of General Purpose serverless, en DEV gelijktrekken zodat metingen vergelijkbaar blijven. Meet vóór en ná met dezelfde scripts — dit is de enige ingreep in dit plan die geen regel code kost.

**Volgorde:** dit is geen excuus om W11/W12/W15 over te slaan. Een tier-upgrade maakt een blob-scan sneller, niet goedkoop. Maar het is wel de snelste winst voor doel B en het maakt alle volgende metingen minder ruizig.

### W1 — Cache-warmup na de sync *(pleister voor doel B, niet de goedkopere query)*

**Probleem:** om 03:00 wordt de cache ongeldig; de eerste gebruiker van de dag betaalt de volle read.

**Waarom niet in de night-refresh-route:** `routes/internalNightRefresh.js:25` roept `dataService.startRefresh()` aan en antwoordt direct met `202 Accepted` — de sync loopt asynchroon door. Een warmup in die route zou draaien vóórdat de nieuwe data er is, en dus meteen weer ongeldig zijn.

**Aanhechtpunt:** `RefreshRunService.finishRun()` (regel 444), na een run met status *success*. Dat is het enige punt waar élke refresh afrondt — night, admin-knop en API-trigger. De warmup hoort daar als laatste stap, fire-and-forget.

**Wat de warmup doet:**

1. `BoardSnapshotCache.readBoardSnapshot({ tableKey: 'purchase-orders', userId: null, supplierAccount: null })` — bouwt de zware staff-snapshot opnieuw op onder de verse signatuur.
2. `BoardSnapshotCache.readRccpPoRows({ tableKey: 'purchase-orders', supplierAccount: null })` — vult de KPI-rijencache die `/rccp/analysis` en `/rccp/board-kpis` voeden.

**Ontwerpkeuzes:**

- **Alleen de staff-scope** (`supplierAccount = null`). De cache is gesleuteld op `(tableKey, supplierAccount)`; alle leveranciersscopes warmen zou N reads en N snapshots in 1 GiB geheugen betekenen. De staff-scope is de zware; leveranciers krijgen een gefilterde, veel kleinere read.
- **Stil falen.** Mislukt de warmup, dan mag de refresh-run niet falen — hooguit een `logger.warn`. Zelfde principe als de bestaande prefetch.
- **Niet blokkerend.** `finishRun()` mag niet wachten op de warmup; de run is klaar zodra de data er staat.
- **Eén lopende read.** De cache is een `Map` zonder single-flight (`BoardSnapshotCache.js`). Warmup bij opstarten en de eerste gebruiker mogen niet tegelijk dezelfde read starten: op 1 GiB kan dat de container trager maken of vol zetten.
- **Meetbaar.** Wrap in `time('warmup_board_snapshot', …)` zodat de duur in de logs terugkomt, conform de chokepoint-afspraak in CLAUDE.md.

**Tweede haakje — boot-warmup:** dezelfde aanroep in `server.js`, na `sql.connect()` (regel ~215), fire-and-forget. Dekt het geval van een Azure-herstart midden op de dag (bewezen op PROD, 21-09 07:18Z) en een deploy buiten 03:00 om.

**Acceptatie:**
- Een PO-tabel-load direct na de nachtsync is even snel als een tweede load.
- De refresh-run rapporteert dezelfde status als nu, ook als de warmup faalt.
- Geen extra geheugengroei boven één staff-snapshot per tabel.

**Raakt:** PROD én DEV. Dit is het werkpakket dat doel B haalt.

### W2 — DEV op PROD-gedrag zetten *(doel A)*

- `maxReplicas` op DEV naar **1**. Zolang de cache per instance leeft, verslechtert een tweede replica de hitrate. Terug naar 2 zodra W3 klaar is.
- Cron-scaling binnen kantooruren, zodat DEV overdag warm blijft en 's nachts niets kost:

```
az containerapp update -n vendorportal-dev -g vanbommel-vendorportal \
  --scale-rule-name office-hours \
  --scale-rule-type cron \
  --scale-rule-metadata "timezone=Europe/Amsterdam" \
                        "start=0 7 * * 1-5" "end=0 19 * * 1-5" "desiredReplicas=1"
```

- **Let op:** cron-scaling zet de container aan, niet de cache warm. W1 is dus een voorwaarde, niet een aanvulling. Zonder W1 staat er om 07:00 een draaiende container met een lege `Map`.
- **Night-refresh ook op DEV:** `infra/azure/night-refresh-wekker.bicep` is nu prod-only (parameter `prodAppUrl`, secret `night-refresh-token-prod`). Parametriseren naar `appUrl` + `nightRefreshSecretName`, zodat dezelfde template voor DEV uitrolt. Dan krijgt DEV dezelfde nachtcyclus én dezelfde warmup.

**Besluit nodig:** cron-scaling betekent dat DEV op werkdagen 12 uur draait in plaats van alleen bij gebruik. Kosten tegen meetbaarheid.

### W3 — Gedeelde, persistente snapshotcache *(uitgesteld, zie §6)*

Snapshot + KPI-rijen naar Redis of een SQL-tabel, gesleuteld op de bestaande `contentSignature()`. Het invalidatiemechanisme is al goed doordacht; alleen de opslag deugt niet voor herstarts en een tweede replica.

Dit is geen structurele fix van de read. Het bewaart de uitkomst van de JSON-blob. Pas oppakken als W11/W12 én een warme meting laten zien dat de koude read nog steeds de klap is. Levert dan op: cache overleeft deploys en herstarts, replica's delen hem, en `maxReplicas` kan terug omhoog.

### W4 — Eén walk voor requested én confirmed *(lost C1 op)*

In `walkRccpPoKpiLines()` (`rccpKpis.js:192-275`) verschilt tussen de twee modes uitsluitend `dateKey`. Het vendor-filter, het statusfilter, `isHeaderOnlyMeasure()`, `resolveLineMeasureQty()`, de share-berekening en de details-filtering zijn identiek — en dat is het dure deel.

Eén pass die per regel beide datums afleidt en twee accumulatoren voedt kost ruwweg 1,2–1,4× in plaats van 2,0×, zonder functieverlies en zonder dat de C/R-toggle een roundtrip krijgt. **Uitzondering:** de header-only-tak roept `collectDateSlots()` met `dateKey` aan; die minderheidstak moet wel twee keer.

Strikt beter dan "confirmed lui berekenen": geen UX-verlies, geen extra call.

### W5 — Gedeelde sku-index *(lost C2 op, payload-kant)*

`compactByOrder()` één sku-lijst laten vullen voor requested én confirmed. ± 20 regels, halveert de groei van de `/rccp/board-kpis`-payload, houdt de C/R-toggle instant.

### W6 — Client: niet dubbel aggregeren *(lost C3 op)*

`dateMode` doorgeven aan `usePoBoardKpis` en de tweede `useMemo` overslaan zolang die op `requested` staat. Let op: `RccpSplitKpiPanel` en `PoBoardKpiStrip` delen `matchByKey`/`buildOverlay` en moeten dezelfde `dateMode` krijgen, anders wijken de tegels op de twee tabs van elkaar af.

### W7 — Sync-lagen: één resolve in plaats van N *(lost C4 op)*

Eén gedeelde vendor-account-resolve over alle lagen in plaats van per laag. En structureel: die query leest `data_json` van álle vendor-rijen om er accounts uit te filteren — dat hoort een geprojecteerde query of een gecachete lookup met invalidatie op sync te zijn.

**Prioriteit hangt aan W0a.**

### W8 — Rollup-pad niet-blokkerend *(lost C5 op)*

Alleen als W0b uitwijst dat de aggregatie niet aanslaat. Dan: de detail-read direct starten met de `fields`-projectie als veilige default, en de `aggregate`-variant alleen gebruiken als het plan er al ligt.

**Niet doen:** de items-filtercheck minder conservatief maken. Zie §5 punt 2.

**Acceptatie:** dichtgeklapte tabel toont dezelfde totalen, new/changed-vlaggen en gekoppelde kolommen; openklappen laadt nog steeds per order; geen regressie met items-syncfilter aan. Tests in `collapsedDetailRollup.test.js` moeten groen blijven.

### W9 — Zorgen dat dit niet terugkomt

- **Perf-gate in CI.** De bouwstenen liggen er (Server-Timing-chokepoints, `perf-baseline.json`, de `perf-review`-skill), maar de baseline is van 22 juli en wordt door niets afgedwongen. Drempels op `app`, `tb_read_details`, `rccp_kpis`, plus een **payload-budget** per endpoint zodat een verdubbeling zoals C2 automatisch opvalt.
- **Realistische dataset.** De huidige baseline draaide op 80 PO-masters en 240 regels. Seed 50k+ regels, anders optimaliseer je op data waar niets traag is.
- **DEV/PROD-pariteit** vastleggen (replica-beleid, SQL-tier, datavolume), zodat de volgende vergelijking in tien minuten te maken is.

### W10 — Render-tijd, ná een warme SQL-read

In de baseline is de PO-board-load 1779 ms, waarvan **1389 ms render** — client-side DOM en paint. Dat is de dominante post zodra de cache warm is, en het staat los van DEV-versus-PROD. Het bord virtualiseert rijen en kolommen al. Niet eerder dan de splitsing in §6 (SQL versus render); anders optimaliseer je paint terwijl de blob de tijd opeet.

### W11 — Projectie per view *(minder JSON per read)*

De board-read stuurt het volledige master-`data_json` en, zonder rollup, het volledige detail-`data_json`. Beperk de SELECT tot de kolommen die de actieve view toont, plus de sleutels die rollup, formules en gekoppelde kolommen echt nodig hebben. Zelfde totalen en vlaggen als nu; een verborgen kolom komt niet mee tot de view hem aanzet.

### W12 — Vaste kolommen naast de JSON *(filteren zonder blob-scan)*

Bij sync de velden die filters en groepen dragen naast `data_json` zetten: leveranciersrekening, inkoopstatus, gevraagde en bevestigde leverdatum. Index op `(table_id, scope)` plus dat veld. `JSON_VALUE(... )` in de WHERE van sync-lagen en lookup-distinct vervalt voor die velden. De JSON blijft de bron voor de overige, zelden gefilterde kolommen.

### W13 — Prefetch niet meteen twee zware RCCP-calls

`dataPagesPrefetch.js` haalt ná board-idle zowel `/rccp/board-kpis` als `/rccp/analysis` op, op de PO-pagina. Die calls drukken op dezelfde SQL-pool als het bord. Uitstellen tot de gebruiker de PERF- of KPI-tab opent, of één van de twee laten vallen als de snapshot de ander al voedt.

### W14 — Lookups niet elke 30 seconden volledig herladen

`loadSingleLookup` (`TableDataService.js`) doet `SELECT partition_key, record_key, data_json` over de hele doeltabel. `loadLookupEnrichmentCached` gooit dat na 30 seconden weg.

- Verversen als de inhouds-signatuur van de doeltabel wijzigt, niet op een klok. Zelfde principe als de board-snapshot: een sync maakt ongeldig, een ongewijzigde tabel niet.
- Alleen de join-sleutel en de velden uit de lookup-mapping teruggeven, niet de hele JSON-rij.
- De bestaande single-flight (`lookupEnrichmentInflight`) blijft.

**Acceptatie:** een tweede PO-load binnen dezelfde sync doet geen nieuwe volledige lookup-read. Een sync van vendors of items ververst de lookup wel. §5b zet dit op het restbudget van ~2 s, dus pas nádat `tb_read_details` onder de seconde zit — anders is het ruis naast 45 s.

### W15 — Leveranciersfilter in SQL *(hangt aan W12)*

Nu: alle orders en regels uit `tb_cache`, daarna in Node `row.values[supplierFilterColumn] === supplierAccount`. Staff (`supplierAccount = null`) blijft de volledige set zien.

- W12 levert de leveranciersrekening als echte kolom met index. Dat is de voorwaarde. Zonder die kolom is een `WHERE` op JSON dezelfde scan.
- Die kolom in de `WHERE` van de master-, detail- en custom-query in `readCacheRows`, vóórdat rijen naar Node gaan.
- De Node-filter blijft als vangnet, niet als de plek waar 73k regels worden weggegooid.

**Acceptatie:** een leverancier-load leest alleen de eigen orders en regels. Totalen en vlaggen van die leverancier blijven gelijk. Een staff-load verandert niet. De duur van een leveranciers-load schaalt met zijn eigen regels, niet met de 73.177 van het hele bedrijf.

---

## 8. Meetplan

**Blokkade:** `perf-screening.js` kan dit volledig geautomatiseerd, maar leest `TEST_LOGIN_EMAIL` / `TEST_LOGIN_PASSWORD` (regel 196-197) en die staan niet in `.env`. De aanwezige `BOOTSTRAP_ADMIN_*` horen bij de lokale database.

**Nodig:** een DEV-testaccount in `.env` (niet in chat of commit). Voor een PROD-meting apart akkoord — dat is inloggen op productie.

Zodra dat er is:

| Meting | Hoe | Beantwoordt |
|---|---|---|
| M1 | DEV 2× achter elkaar (warm), dan 6 min wachten en opnieuw (koud) | Klopt de 18,2 s nog? |
| M2 | Idem op PROD | Heeft PROD ook een koude piek? |
| M3 | Lokaal `main` vs `develop` tegen **dezelfde** database, beide warm | Isoleert code van omgeving — de enige meting die C1-C5 kan wegen |
| M4 | Eerste load ná 03:00 op PROD | Bevestigt doel B |
| M5 | Interactiemeting: tegelklik + kolomfilter (`perf-board-actions`) | Vangt C3, dat buiten alle Network-calls valt |
| M6 | Koude én warme load splitsen op `tb_read_masters`, `tb_read_details` en client-render | Kiest tussen W11/W12 (smallere SQL) en W10 (lichtere tabel). Zonder deze split geen W3 |

M3 is de beslissende meting en ontbrak in de eerste planversie. Een DEV-versus-PROD-vergelijking kan per definitie geen code-effect isoleren: twee containers, twee databases, twee datavolumes, twee cache-temperaturen.

**Server-Timing staat ook op PROD aan** (`server.js:134-148`, geen env-gate). Daar kan dus per label toegerekend worden, niet alleen op totalen.

---

## 9. Voorgestelde volgorde

```
W0 (30 min) ──► M6 (SQL vs render)
      │
      ├── tb_read_details zwaar ──► W8 (als rollup uitstaat) ──► W11 projectie ──► W12 vaste kolommen ──► W15 leverancier in SQL
      │                                                                                              └── W14 lookups (schema-vrij, pas als de 45 s weg is)
      │
      └── render zwaar, SQL warm ──► W6 + W10
                    │
W1 warmup (pleister, met single-flight) ──► W2 DEV-gedrag ──► M1/M2/M4
                    │
                    └── pas als de koude read ná W11/W12 nog de klap is ──► W3
W4 ─ W5 ─ W13 ── parallel, ná M6, niet vóór de split
W7 als W0a een vendor-group-regel vindt (hoort bij W12)
W9 als laatste gate
```

W1 vóór W2, want een draaiende container met een lege cache lost niets op. W1 vervangt W11/W12 niet.

---

## 10. Open besluiten

- [ ] DEV-testaccount in `.env` — wie levert?
- [ ] Akkoord voor een perf-meting op **productie** (inloggen + board-load, read-only)?
- [ ] Cron-scaling op DEV: 12 uur draaien op werkdagen — akkoord met de kosten?
- [ ] W3 (gedeelde cache): pas ná M6 en W11/W12. Redis of SQL-tabel is dan een opslagkeuze, geen snelheidskeuze.
- [ ] Mag `2026-09-21-dev-prod-laadtijd-po-bi-rccp.plan.md` weg nu dit document het vervangt?

---

## 11. Logboek

| Datum | Wat |
|---|---|
| 21-09 | Diff `main`↔`develop` geanalyseerd (38 commits, 151 bestanden) → C1-C5 |
| 21-09 | Eerste planversie getoetst → vier correcties (§5) |
| 21-09 | Azure-configuratie uitgelezen → §2 bewezen; health-probe weerlegt de 15 s-claim |
| 21-09 | Night-refresh Logic App gevonden (dagelijks 03:00) → doel B geformuleerd, W1 ontworpen |
| 21-09 | Warmup als enige hoek losgelaten → §6: JSON-blob, view-projectie (W11), vaste kolommen (W12), prefetch (W13). W3 uitgesteld tot ná M6 |
| 21-09 | **W0a gedaan** → geen vendor-group- of line-level regels op DEV; **W7 vervalt** |
| 21-09 | **Eerste echte meting op DEV (§5b)** → PO-read 47 s, waarvan 45 s in `tb_read_details`; 938 masters / 73.177 detailregels. Warm én koud gelijk, dus geen cache- of cold-start-effect. W0b van "nice to have" naar sleutelmeting |
| 21-09 | Lookups (W14) en leveranciersfilter in SQL (W15) toegevoegd. W14 vervangt de 30 s-klok door de inhouds-signatuur. W15 hangt aan de leverancierskolom uit W12. Beide ná de 45 s detail-query, niet ervoor |
| 21-09 | **M2 gedaan (§5c)** → PROD 4,6 s tegen DEV 45,3 s op `tb_read_details`, bij 70.675 vs 73.177 detailrijen, **zelfde SQL-server en -tier**. Regressie in `develop` bewezen; bron vermoedelijk commit `56b98bd` |
| 21-09 | **SQL-tier uitgelezen** → DEV én PROD op **Basic/5 DTU**. Nieuw werkpakket **W16**; verklaart waarom ook PROD 10–12 s doet |
| 21-09 | **W0b gebouwd (§5d)** → `mark()` in `timing.js` + `tb_detail_plan[_mode]`; 7 nieuwe tests groen, 133 tests op het gewijzigde leespad groen; versie v1.71.2 |
| 21-09 | **W0b afgelezen (§5e)** → modus is **`fields`**, niet `aggregate`. De 44 s zit in de `JSON_VALUE`-projectie. `aggregate` wordt geblokkeerd door één header-filter `ProductType eq …` op de items-tabel, dus de snelle tak van `56b98bd` draaide hier nooit. C5 bevestigd: `tb_detail_plan` ≈ `tb_lookups` |
| | *volgende: fix-optie 1 uit §5e bouwen (terugvallen op de blob als `aggregate` niet kan), meten, dan W16 (SQL-tier) en W12* |
| | *volgende: W0a + W0b, daarna M6* |

---

## 12. Referentie

| Onderdeel | Plek |
|---|---|
| Snapshotcache (wanneer de klap valt, niet waarom de query duur is) | `server/services/BoardSnapshotCache.js` |
| JSON-blob van orders en regels | `dbo.tb_cache.data_json` in `scripts/db/migrations/011_tb_metamodel.sql` |
| Board-read masters + details | `readCacheRows` in `server/services/TableDataService.js` |
| Lookup-herlaad (30 s, volledige JSON) | `loadSingleLookup` / `LOOKUP_ENRICHMENT_TTL_MS` in `server/services/TableDataService.js` |
| Leveranciersfilter ná de SQL-read | supplier-scope in `readExecute`, `server/services/TableDataService.js` |
| Refresh-afronding (aanhechtpunt W1) | `server/services/RefreshRunService.js:444` |
| Night-refresh route (async, 202) | `server/routes/internalNightRefresh.js:25` |
| Logic App-template (prod-only) | `infra/azure/night-refresh-wekker.bicep` |
| PO-read, rollup, sync-lagen | `server/services/TableDataService.js` |
| KPI-walks requested/confirmed | `server/utils/rccpKpis.js:192` |
| Payload-compactie | `server/utils/rccpKpiCompact.js` |
| Gedeelde KPI-hook (client) | `src/hooks/usePoBoardKpis.js` |
| Prefetch ná tabel | `src/utils/dataPagesPrefetch.js:85` |
| Perf-harness (kan M1-M5 draaien) | `playwright/perf-screening.js` |
| Server-Timing-middleware | `server/server.js:134` |
