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

## 5f. Meting 22-09 ná fix-optie 1 ✅ *doel A gehaald*

Commit `8d8fde6` (v1.71.3) op DEV, drie runs, zelfde script en zelfde omstandigheden als §5e.

| | Vóór (§5e) | Ná | Winst |
|---|---|---|---|
| `app` (mediaan) | 47.060 ms | **9.189 ms** | **5,1×** |
| `tb_read_details` (mediaan) | 45.334 ms | **7.250 ms** | **6,3×** |
| Marker | `tb_detail_plan_fields` | **`tb_detail_plan_none`** | nieuwe tak actief |
| Payload | 1.360 KB | 1.360 KB | ongewijzigd |
| Rijen | 917 | 917 | ongewijzigd |

Payload en rijaantal zijn identiek, dus de read levert exact hetzelfde op — alleen goedkoper.

**Naast PROD:**

| | DEV ná fix | PROD (main) |
|---|---|---|
| `app` | 9.189 ms | 11.681 ms |
| `tb_read_details` | 7.250 ms | 4.629 ms |
| orders in response | 917 | 2.190 |

**Doel A is gehaald.** DEV is op wandkloktijd nu sneller dan PROD, terwijl PROD ruim dubbel zoveel orders teruggeeft. Het verschil op `tb_read_details` (7,3 tegen 4,6 s) valt weg tegen de 2,4× grotere orderset van PROD.

**De ontkoppeling van de lookups werkt aantoonbaar.** In run 1 is `tb_lookups` 2.153 ms terwijl `tb_detail_plan` op 1.255 ms blijft; vóór de fix liepen die twee exact gelijk op. Wat `tb_detail_plan` nu nog bepaalt is de traagste van `tb_read_cols` / `tb_links` (run 1: beide 1.255 ms; run 3: beide 1.068 ms; run 2 warm: 35 ms). Dat is inherent aan de rollup-check en hoort bij W8 als er nog iets te halen valt.

**Belangrijk voor doel B en de promotie naar PROD:** `main` heeft de `JSON_VALUE`-tak niet, dus PROD had deze bug niet. Maar commit `56b98bd` gaat mee zodra `develop` naar `main` promoveert. **Zonder deze fix zou PROD bij de eerstvolgende promotie van 4,6 s naar tientallen seconden gaan.** Geverifieerd op 22-09: PROD heeft **exact hetzelfde items-syncfilter** als DEV — `ProductType eq …` op header-niveau — dus `resolveCollapsedRollupPlan()` zou daar net zo goed meteen `null` teruggeven en in de `fields`-tak belanden. Deze fix is dus geen DEV-reparatie maar een voorwaarde voor de volgende release.

**Wat nu de grootste post is:** `tb_read_details` blijft met 5,9–7,4 s de zwaarste, gevolgd door `tb_build_rows` (1,3–2,1 s) en `tb_lookups` (0–2,2 s). Dat is precies het terrein van W11 (projectie per view), W12 (vaste kolommen met index) en W14 (lookups op signatuur in plaats van een klok van 30 s). W16 (van Basic/5 DTU af) tilt ze alle drie.

---

## 5g. Meting 22-09 — RCCP-endpoints, vóór de promotie

Gemeten om te weten wat C1/C2 op PROD gaan kosten zodra `develop` promoveert.

| | DEV (develop) | PROD (main) |
|---|---|---|
| `/rccp/board-kpis` koud | 10.304 ms | — (was al warm) |
| `/rccp/board-kpis` warm | **6 ms** | **8 ms** |
| Payload | 171 KB (916 orders) | 202 KB (2.190 orders) |
| `confirmed`-set aanwezig | **ja** | nee |

**De snapshotcache werkt uitstekend.** Warm 6–8 ms op beide; dat bevestigt de 8–13 ms uit de code-comment. De koude 10,3 s op DEV zit vrijwel volledig in `rccp_board_kpis_read` / `kpi_po_read` (9,1 s) — dat is de PO-read, niet de KPI-berekening.

**C1/C2 vallen mee.** De labels `rccp_board_kpis` en `rccp_board_kpis_confirmed` halen de top-8 niet eens; de dubbele walk kost dus minder dan `tb_lookup_items` (816 ms) en verdwijnt achter de cache. De payload-kant: DEV 0,19 KB per order mét confirmed, PROD 0,09 KB zonder. Op PROD betekent dat ~202 → ~400 KB. Niet mooi (W5 blijft zinvol), maar geen blokkade.

**Niet gemeten:** `/rccp/analysis` geeft HTTP 400 zonder verplichte parameters. Gebruikt wel dezelfde snapshot, dus vermoedelijk hetzelfde patroon — koud duur, warm bijna gratis. C3 (client-aggregatie bij filterklik) is evenmin gemeten; dat valt buiten alle Network-calls en vraagt `perf-board-actions`.

---

## 5h. W16 uitgevoerd op DEV — 22-09 12:35Z ✅

`vendorportal-dev-db` van **Basic (5 DTU) naar S2 (50 DTU)**. Duur: 2 min 23 s, status Online, geen handmatige tussenkomst. PROD nog niet — zie §9.

Vier runs ná de upgrade, nadat de verbindingen en lookup-caches gesetteld waren:

| Run | `app` | `tb_read_details` |
|---|---|---|
| 1 | 5.956 ms | 3.454 ms |
| 2 | 6.188 ms | 4.258 ms |
| 3 | 4.604 ms | 3.204 ms |
| 4 | 3.877 ms | 2.573 ms |

| | Basic | S2 | Winst |
|---|---|---|---|
| `app` (mediaan) | 9.189 ms | **~5.280 ms** | **1,7×** |
| `tb_read_details` | 7.250 ms | **~3.329 ms** | **2,2×** |

**De keten op DEV tot nu toe:** 47.060 → 9.189 (fix-optie 1) → ~5.280 ms (S2). Samen **8,9× sneller**, en DEV is nu ruim sneller dan PROD (11.681 ms op Basic).

**Kanttekening bij de eerste ronde:** direct ná de tier-wissel was run 1 juist 22,8 s, met `tb_lookups` op 11.655 ms. De verbindingsreset had de lookup-cache leeggemaakt. Niet representatief, wel leerzaam: het laat zien hoe duur een koude lookup-read is.

**Wat hierdoor de volgende post wordt:** `tb_lookups` schommelt tussen 0 en 2.200 ms, puur afhankelijk van de 30-secondenklok — precies wat W14 beschrijft. En `tb_build_rows` (1.181–2.303 ms) is nu relatief groot; dat is Node-werk, geen SQL, en hoort bij W10/W11.

**DTU-metrics:** te vertraagd om al iets te zeggen over het verbruik ónder S2 (laatste datapunt liep achter op de metingen). Bovendien is een percentage relatief aan de tier — 90% op 5 DTU is iets heel anders dan 90% op 50 DTU. Over een dag opnieuw bekijken.

---

## 5i. W16 uitgevoerd op PROD — 22-09 12:47Z ✅ *doel B: eerste harde winst*

Uitgevoerd op een moment dat PROD aantoonbaar stil lag: 0% DTU en **0 nieuwe verbindingen** in de 25 minuten ervoor. Duur 1 min 52 s, status Online, health daarna 200 in 209 ms.

| Run | `app` | `tb_read_details` | `tb_build_rows` |
|---|---|---|---|
| 1 *(koud, lookup-cache leeg)* | 23.929 ms | 18.859 ms | 3.394 ms |
| 2 | 5.956 ms | 2.553 ms | 2.992 ms |
| 3 | 5.988 ms | 2.363 ms | 3.275 ms |
| 4 | 6.203 ms | 2.802 ms | 3.019 ms |

| | Basic | S2 | Winst |
|---|---|---|---|
| `app` (mediaan) | 11.681 ms | **~5.988 ms** | **2,0×** |
| `tb_read_details` | 4.629 ms | **~2.553 ms** | **1,8×** |

Payload en rijaantal onveranderd (2.668 KB, 2.190 orders).

**`tb_build_rows` is nu de grootste post op PROD** (2.992–3.275 ms), groter dan `tb_read_details`. Dat is Node-werk: het opbouwen van 2.190 rijen. SQL is daarmee niet langer de bottleneck op productie — dat verschuift het zwaartepunt naar W10/W11 en maakt W12 minder urgent dan het leek.

**Run 1 bevestigt W1 en W14.** Na de verbindingsreset was de eerste read 23,9 s, waarvan 15,4 s lookups. Exact hetzelfde patroon als op DEV. Dat is precies wat de eerste gebruiker na een deploy, een herstart of de nachtsync van 03:00 vandaag nog steeds betaalt. **Doel B is dus half gehaald:** de warme read is 2× sneller, de koude eerste read van de dag is dat niet.

---

## 5j. W1 gebouwd en geverifieerd — 22-09 ✅ *met een nuance die de volgorde verandert*

Commit `6129444` (v1.71.8). De boot-warmup draaide aantoonbaar; containerlog van DEV:

```
12:59:42Z  "Board-caches opgewarmd", reason: "startup"
```

Eerste calls ná de deploy, dus precies de situatie van "eerste bezoeker van de dag":

| Endpoint | Vóór W1 (koud) | Ná W1 (eerste call) |
|---|---|---|
| `/rccp/board-kpis` | 10.304 ms | **1.139 ms** |
| `/api/data/purchase-orders` | — | 6.661 ms |

**De warmup werkt: 9× sneller voor de eerste bezoeker op de RCCP/BI-kant.** Maar de verwachting was 6–8 ms, en dat werd 1.139 ms. Twee dingen die dat verklaren, en allebei sturen ze het vervolg:

**1. Er zitten twee cachelagen onder `/rccp/board-kpis`, niet één.** De 6–8 ms uit §5g was een hit op een response-cache op revisie (`rccp_board_kpis_rev`). W1 vult de *snapshot*, niet die response-cache. Wat overblijft — ~1,1 s — is de KPI-berekening zelf over 916 orders, en dat is precies de dubbele walk van C1/C2. **W4 en W5 worden daarmee concreet meetbaar: ze moeten van die 1,1 s af.**

**2. De PO-tabel-route profiteert niet, en dat is by design.** `/api/data/purchase-orders` gaat rechtstreeks naar `TableDataService.read()` en raakt `BoardSnapshotCache` nooit. Die route heeft geen koude/warme asymmetrie — hij leest altijd vers, ~6 s.

**Waar de 23,9 s koude read op PROD dan vandaan kwam:** niet van de board-snapshot, maar van de **lookup-enrichment** (`tb_lookups` 15.381 ms). Die cache heeft een TTL van 30 seconden. De warmup vult hem wel, maar 30 seconden later is hij alweer verlopen — in de verificatie hierboven was hij dat na 100 s dus ook.

**Dat maakt W14 de kritieke volgende stap voor doel B.** Zolang de lookup-cache op een klok van 30 s loopt in plaats van op de content-signatuur, is elke read die meer dan een halve minuut na de vorige komt opnieuw deels koud — en dat is overdag de normale situatie. Geen warmup lost dat op; alleen de invalidatiestrategie.

---

## 5k. W14 geverifieerd — 22-09 ✅ *met een vervolg*

Vier PO-reads op DEV, met bewust 45 s pauze tussen call 2 en 3 (onder de oude regels was de
lookup-cache dan verlopen):

| | `tb_lookups` | `tb_lookup_sig` | `tb_read_details` |
|---|---|---|---|
| call 1 | 1.157 ms | 1.157 ms | 4.265 ms |
| call 2 | 1.059 ms | 1.059 ms | 4.278 ms |
| *45 s pauze* | | | |
| call 3 | 1.090 ms | 1.090 ms | 4.106 ms |
| call 4 | 590 ms | 590 ms | 3.198 ms |

**`tb_lookups` is in alle vier de calls exact gelijk aan `tb_lookup_sig`.** De volledige
doeltabel-read gebeurt dus niet meer — wat overblijft is alleen de signatuurcheck. Ook ná de pauze
van 45 seconden, waar de oude klok de cache zou hebben weggegooid. Dat is precies wat W14 moest
bereiken.

**Maar de signatuurquery is duurder dan gehoopt: 590–1.157 ms.** Een `COUNT(*)` plus `MAX()` over
de doeltabellen is geen puntquery. Netto-effect:

- reads binnen 30 s van elkaar: vóór 0 ms, nu ~1 s → **slechter**
- reads verder uit elkaar (overdag de regel): vóór 2.200–15.400 ms, nu ~1 s → **veel beter**

**Vervolg (in dezelfde lijn gebouwd):** de signatuur hooguit één keer per 30 s ophalen
(`LOOKUP_SIGNATURE_CHECK_MS`). De klok bepaalt dan hoe vaak we *kijken*, de inhoud of we
*herladen*. Binnen dat venster is de check gratis, daarbuiten kost hij ~1 s in plaats van een
volledige read. Het ergste gevolg van een gemiste wijziging is hooguit een halve minuut oude
lookup-labels — hetzelfde risico als de oude TTL, maar zonder de kosten.

---

## 5l. Meting 22-09 — W4/W5 gewogen, en verworpen ten gunste van lazy

Payload-samenstelling van `/rccp/board-kpis` op DEV (916 orders):

| Onderdeel | Omvang | Aandeel |
|---|---|---|
| **totaal** | **171 KB** | 100% |
| `sku` (2×) | 25 KB | 15% |
| `orders` (2×) | 146 KB | 85% |

**Dat verwerpt W5.** Een gedeelde sku-index bespaart de helft van 25 KB — ~7% van de payload. Voor
een wijziging die server én client raakt is dat niet de moeite. Mijn eerdere inschatting
("halveert de payload-groei") was fout: de verdubbeling zit in `orders`, en die waarden verschillen
écht — die zijn niet te delen.

**En het verwerpt W4 ten gunste van lazy laden.** Ik had "confirmed lui berekenen" eerder afgewezen
omdat het een roundtrip kost bij het omzetten van de toggle. Dat argument houdt geen stand: onder
dit endpoint zit een response-cache op revisie (`rccp_board_kpis_rev`), gemeten op 8–13 ms. Die ene
roundtrip is eenmalig, daarna gratis. En de toggle staat standaard op `requested`.

| Aanpak | Payload | CPU | Client | Risico |
|---|---|---|---|---|
| W5 (sku delen) | −7% | 0 | wijziging nodig | klein |
| W4 (één walk) | 0 | ~−40% | geen | **refactor van de heetste functie** |
| **Lazy confirmed** | **−50%** | **−50%** | lost W6 mee op | klein |

Gebouwd: `?dateMode=confirmed` op de route, `includeConfirmed` in `boardKpis()`, cache-key erop
uitgebreid, en client-side `getPoBoardKpis(refreshKey, dateMode)` met de `dateMode` uit de bestaande
toggles. **W4, W5 en W6 vervallen daarmee.**

---

## 5m. Verificatie 22-09 — lazy confirmed + signatuur-throttle

### Lazy confirmed (`3f80d7f`, v1.72.0)

| Call | Payload | `app` | walk requested | walk confirmed | `confirmed` in body |
|---|---|---|---|---|---|
| `board-kpis` | **147 KB** | 736 ms | 726 ms | — | nee |
| `board-kpis` #2 | 147 KB | 11 ms | — | — | nee |
| `?dateMode=confirmed` | 171 KB | 830 ms | 504 ms | 319 ms | ja |
| `?dateMode=confirmed` #2 | 171 KB | 8 ms | — | — | ja |

Werkt zoals bedoeld: in de standaardstand draait de tweede walk niet meer, en de revisie-cache
bedient beide standen apart (8–11 ms).

**Correctie op mijn eigen voorspelling.** Ik schreef −50% payload. Het is **−24 KB, oftewel 14%**.
De redenering klopte niet: uit de eerdere meting kwam `orders (2×) = 146 KB`, en ik nam aan dat de
twee maps even groot waren. Dat zijn ze niet — `compactByOrder` laat orders zonder cijfers weg, en
op confirmed-datumbasis vallen er veel meer weg. De confirmed-set is dus de kleine helft.

Wat de wijziging wél oplevert:

- **CPU −319 ms** op de koude call (38% van de rekentijd)
- **Eerste bezoeker: 1.139 → 736 ms** (−35%)
- **W6 opgelost**: zonder `confirmed` in de payload aggregeert de client niets dubbel bij elke
  filterklik

### Signatuur-throttle (`4a7debc`)

| Call | `tb_lookups` | `tb_lookup_sig` |
|---|---|---|
| call 1 | 940 ms | 940 ms |
| call 2 *(direct erna)* | **0 ms** | *afwezig* |
| *45 s pauze* | | |
| call 3 | 431 ms | 431 ms |
| call 4 *(direct erna)* | **0 ms** | *afwezig* |

Exact het bedoelde patroon. Binnen het venster van 30 s is de check gratis; daarbuiten kost hij
0,4–0,9 s in plaats van een volledige doeltabel-read.

**Netto over de drie stadia van `tb_lookups`:**

| | binnen 30 s | daarbuiten |
|---|---|---|
| vóór W14 | 0 ms | 2.200–15.400 ms |
| W14 zonder throttle | 590–1.157 ms | 590–1.157 ms |
| **W14 mét throttle** | **0 ms** | **431–940 ms** |

PO-read op DEV na beide wijzigingen: 4.070–5.843 ms `app` (mediaan ~4.539 ms), tegen ~5.280 ms
vlak na de S2-upgrade.

---

## 5n. Meting 23-09 — server versus browser ✅ *W10 vervalt als prioriteit*

Playwright tegen DEV, drie herladingen van het PO-board, gemeten tot de eerste bordcel in de DOM staat.

| Run | tot eerste cel | API binnen | server `app` | **RENDER** | tot netwerk stil |
|---|---|---|---|---|---|
| 1 | 8.167 ms | 7.550 ms | 5.716 ms | **617 ms** | 11.299 ms |
| 2 | 6.542 ms | 5.695 ms | 4.508 ms | **847 ms** | 9.011 ms |
| 3 | 6.997 ms | 6.187 ms | 4.456 ms | **810 ms** | 8.890 ms |

**Verdeling van de ~7 s tot de eerste cel:**

| Post | Tijd | Aandeel |
|---|---|---|
| Server (`app`) | ~4.500 ms | **64%** |
| Netwerk + transfer | ~1.200 ms | 17% |
| **Render (browser)** | **~810 ms** | **12%** |
| Pagina-boot, JS | ~600 ms | 8% |

**De serverkant is veruit dominant.** De juli-baseline (1.389 ms render op 1.779 ms totaal) suggereerde het tegenovergestelde, maar die draaide op 80 orders waar de server 390 ms deed. Bij 917 orders is de verhouding omgekeerd.

**Waarom render laag blijft:** het bord virtualiseert — 5 rijen in de DOM van 917 (`aria-label="5 in view of 917 total"`). De browser bouwt dus geen 917 rijen op; die 810 ms is vooral JSON parsen en state opbouwen.

**Gevolg: W10 vervalt als prioriteit.** Zelfs een perfecte render wint hooguit 0,8 s van de 7. B en C blijven de enige wegen die er echt toe doen.

**Terzijde:** `tot netwerk stil` ligt 2–4 s ná de eerste cel. Dat is de idle-prefetch (board-kpis, rccp-analysis, bi). Die blokkeert de gebruiker niet, maar belast wel dezelfde pool — dat is W13.

### Twee meetproblemen die hier boven tafel kwamen

1. **`playwright/perf-screening.js` meet het PO-board niet meer.** De wait-selector is `[aria-label^="Select order"]` met 5 s timeout; die aria-label bestaat niet meer (de bordcel heet nu `data-tour="po-cell"`) en 5 s is te krap voor een bord dat er 6–8 s over doet. Alle samples faalden stil, en het rapport toonde `—` voor elke route. **Te repareren als onderdeel van W9.**
2. **Die run overschreef `test-reports/perf-baseline.json`** met lege waarden. Hersteld uit git. De baseline is getrackt, dus het was terug te draaien — maar het script zou geen baseline moeten wegschrijven als alle metingen faalden.

---

## 5o. Meting 23-09 — `tb_build_rows` opgesplitst 🎯 *B verworpen, grotere kans gevonden*

| Run | `tb_build_rows` | detail-opbouw | **master-opbouw** | lookups | pav | formules | overig |
|---|---|---|---|---|---|---|---|
| 1 | 1.892 ms | 725 ms | **1.167 ms** | 517 ms | 15 ms | 3 ms | 190 ms |
| 2 | 1.766 ms | 571 ms | **1.195 ms** | 84 ms | 14 ms | 3 ms | 470 ms |
| 3 | 1.116 ms | 392 ms | **724 ms** | 220 ms | 10 ms | 2 ms | 160 ms |

**Verwerpt B (W11-verfijnd).** De stappen die een verfijnde lichte weg zou overslaan — de
product-attribuut-pivot en de formules — kosten samen **12–18 ms**. Op een `app` van 4.000–6.000 ms
is dat niet meetbaar. De lookups (84–517 ms) moeten sowieso blijven vanwege de
ontvangst-koppelingen. **W11 in elke vorm vervalt.**

**Het masterdeel is groter dan het detaildeel** (724–1.195 ms tegen 392–725 ms). Mijn aanname dat de
73k detailregels de bouwtijd domineerden klopte niet: de 917 masterrijen kosten meer. Wie in de
opbouw wil winnen, moet daar kijken — maar het gaat om ~1 s van de ~5 s.

### De vondst: driekwart van de gelezen detailregels wordt weggegooid

`tb_build_det_rows_n` = **18.145** verwerkte detailregels. In de cache staan er **73.177**.

Het verschil is het items-syncfilter. `readCacheRows` leest álle detailregels uit SQL
(`WHERE table_id = @tableId AND scope = 'detail'`, geen verdere filtering), waarna Node ze per
order filtert met `detailMatchesItemsFilter`. **Van de 73.177 gelezen regels blijven er 18.145
over — 75% wordt na het lezen weggegooid.**

Dat verklaart waarom `tb_read_details` (2.757–4.061 ms) de grootste post is: het leest vier keer
zoveel als nodig.

**Dit maakt W12 veruit de grootste resterende kans.** Met `itemNumber` als echte, geïndexeerde
kolom naast de JSON kan het items-filter in de `WHERE` van de detail-query, in plaats van in Node
erna. Ruwe schatting: `tb_read_details` van ~3.500 ms naar de orde van 1.000 ms, plus een kleiner
detaildeel in `tb_build_rows`.

**Let op bij de uitwerking:** het filter mag níét via `JSON_VALUE` in de `WHERE` — dat is precies
wat in §5c/§5e als tien keer trager is ontmaskerd. Alleen een echte kolom met index lost dit op.

---

## 5p. Nulmeting PROD — 23-09 15:57Z, vóór de promotie

Vastgelegd zodat het effect van de promotie hard aantoonbaar is. PROD draait nog `main`; alleen de
database-tier (W16) is daar doorgevoerd.

| Run | `app` | `tb_read_details` | `tb_build_rows` | `tb_lookups` |
|---|---|---|---|---|
| 1 *(koud)* | 8.079 ms | 3.442 ms | 3.300 ms | **4.363 ms** |
| 2 | 5.913 ms | 2.429 ms | 2.986 ms | 0 ms |
| 3 | 5.917 ms | 2.693 ms | 2.904 ms | 0 ms |
| 4 | 5.885 ms | 2.295 ms | 3.030 ms | 0 ms |

- Payload 2.668 KB, 2.190 rijen · `board-kpis` 7–8 ms warm, 202 KB, zonder `confirmed`
- Datavolume: 2.190 masters, 70.675 detailregels

**Run 1 laat precies zien wat W14 gaat opleveren:** `tb_lookups` = 4.363 ms bij een koude cache,
daarna 0 — dat is het oude 30-secondengedrag dat op productie nog draait. Na de promotie hoort die
piek te verdwijnen.

**Wat de promotie op PROD moet opleveren**, op basis van de DEV-metingen: `tb_lookups`-piek weg,
`board-kpis`-payload kleiner, en de warmup die de eerste bezoeker na de nachtsync scheelt. De
`app`-tijd zelf verandert weinig — de grote fix (`8d8fde6`) is daar een *preventie*, geen
versnelling: zonder die commit zou `56b98bd` de read op PROD naar tientallen seconden brengen.

### Browsertest C/R-toggle (commit `3f80d7f`) — 23-09

| Controle | Uitkomst |
|---|---|
| Laden vraagt de requested-set | ✅ `GET /api/rccp/board-kpis` |
| Omzetten naar Conf. haalt de confirmed-set | ✅ `GET /api/rccp/board-kpis?dateMode=confirmed` |
| Tegels gevuld op Req., Conf. en terug | ✅ |
| Console-fouten | ✅ geen |

**Observatie, geen regressie:** op Conf. tonen de tegels 0 terwijl de server wél data levert (246
van de 916 orders hebben een confirmed datum, samen 30.268 open). De tegels aggregeren over de
*zichtbare* orders, en die logica zit in `src/utils/poBoardKpis.js` en `rccpKpiCardProps.js` —
bestanden die commit `3f80d7f` niet aanraakt. Vóór die commit werd dezelfde aggregatie over
dezelfde orderset gedaan, alleen werd de confirmed-set toen onvoorwaardelijk meegestuurd. Het
gedrag is dus ouder dan deze wijziging. **Wel het melden waard als functioneel punt.**

---

## 5q. PROD-deploy uitgevoerd — 23-09 18:40Z ✅

PR #130 gemerged (`3b332af`), revisie `vendorportal-prod--0000050`, image `prod-3b332afb`.
Deploy-run `35902126493`: **success**. Migraties gedraaid, `seed_e2e`-bestanden overgeslagen zoals
bedoeld.

**De warmup draaide op productie**, bevestigd in het containerlog:

```
18:41:26Z  "Board-caches opgewarmd", reason: "startup"
```

Container gestart 18:40:41, warmup klaar 18:41:26 — 45 seconden.

### Meting vóór en ná (zelfde script, zelfde methode)

| | Nulmeting 15:57Z | Ná deploy 19:10Z |
|---|---|---|
| `app` run 1 *(koud)* | 8.079 ms | 8.057 ms |
| `app` runs 2–4 | ~5.900 ms | 5.875–6.086 ms |
| `tb_read_details` | 2.295–3.442 ms | 2.302–2.580 ms |
| `tb_build_rows` | 2.904–3.300 ms | 2.908–3.113 ms |
| **`tb_lookups` run 1** | **4.363 ms** | **732 ms** |
| `board-kpis` payload | 202 KB | **174 KB** |
| `board-kpis` warm | 7–8 ms | 5–13 ms |
| Payload / rijen | 2.668 KB / 2.190 | 2.669 KB / 2.190 |

**Wat er aantoonbaar is verbeterd:**

- **De lookup-piek: 4.363 → 732 ms.** Dat is W14 op productie. De koude lookup-read is geen
  4,4 seconden meer maar de goedkope signatuurcheck.
- **`board-kpis`-payload: 202 → 174 KB** (−14%), de lazy confirmed-set.
- **De warmup draait**, dus de eerste bezoeker na de nachtsync van 03:00 betaalt de koude read niet
  meer zelf.

**Wat gelijk bleef:** de `app`-tijd (~6 s) en `tb_build_rows` (~3 s). Dat is verwacht — de grote fix
`8d8fde6` is op productie een *preventie*, geen versnelling. `tb_build_rows` is precies de post waar
W12 over gaat.

### Twee waarnemingen tijdens de deploy

1. **Kort na de deploy gaf de login één keer HTTP 500.** Bij hermeten: health 200 in 0,19 s, login
   200, en **geen enkele foutregel in het containerlog**. Toegeschreven aan het opstarten (container
   nieuw, pool nog niet warm). Wel het vermelden waard mocht het terugkomen.
2. **`board-kpis` deed direct na de deploy 6,4 s, ook op de tweede call.** Twintig minuten later
   5–7 ms. De revisie-cache was leeg en de twee calls liepen door het opwarmen heen. Geen regressie.

### Correctie op de rollback-informatie in de skill

`push-dev-to-prod` noemt een "oude App Service als noodrem, zolang DevOps #29 niet is uitgevoerd".
**Die App Service bestaat niet meer** — `az webapp list` geeft zowel in de resource group als
subscriptie-breed een lege lijst. De werkelijke rollback is terug naar revisie
`vendorportal-prod--0000049` (image `prod-39d677ac`, 15 september); de app draait in *Single
revision mode*.

De twee migraties hoeven daarbij niet terug: `049` is puur additief (kolom met default) en `050`
raakt alleen `user_permissions`, een tabel die er sinds migratie 004 al is. Dat is beredeneerd,
niet getest.

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

**Bewijs (22-09, `az monitor metrics`, max per 5 min):** `vendorportal-dev-db` raakte tijdens de metingen **100%** DTU (10:33Z), daarna 82% en 91%. `vendorportal-prod-db` stond op 0–4% — maar dat betekent alleen dat er op dat moment niemand op PROD werkte, niet dat PROD ruim bemeten is. Om PROD's plafond te kennen moet er tijdens de ochtendpiek gemeten worden.

**Retail-prijzen North Europe** (Azure retail prices API, 22-09; CSP-tarief kan afwijken):

| SKU | DTU | USD/dag | USD/maand (30,4 d) |
|---|---|---|---|
| Basic *(huidig)* | 5 | 0,161 | ~4,90 |
| S0 | 10 | 0,4839 | ~14,70 |
| S1 | 20 | 0,9677 | ~29,40 |
| **S2** | **50** | **2,42** | **~73,60** |
| S3 | 100 | 4,8387 | ~147,10 |

**Voorstel: beide naar S2.** DEV gelijktrekken met PROD is geen luxe maar de voorwaarde om nog iets te kunnen meten — §5c leunde er volledig op dat de tiers identiek waren.

```
az sql db update --name vendorportal-prod-db --server sql-vp-ne-20260628 \
  --resource-group vanbommel-vendorportal --service-objective S2
az sql db update --name vendorportal-dev-db  --server sql-vp-ne-20260628 \
  --resource-group vanbommel-vendorportal --service-objective S2
```

Meerkosten ~$137/maand voor beide samen. **Omkeerbaar experiment:** terugschalen is hetzelfde commando met `--service-objective Basic`, en je betaalt per dag. Een week proefdraaien kost een paar dollar.

Aandachtspunten:
- Een tier-wissel reset bestaande verbindingen; plan hem buiten kantooruren.
- Basic heeft een cap van 2 GB, S2 250 GB — de limiet verdwijnt ook.
- **Geen serverless met auto-pause op PROD.** Dat pauzeert de database bij inactiviteit en werkt doel B direct tegen: elke hervatting is weer een koude start. Voor DEV is het wel een overweging.
- Verwacht geen 10× winst uit een 10× DTU-verhoging. PROD doet 10–12 s bij een vrijwel onbelaste database, dus een deel van het werk is gewoon werk. De tier haalt de rantsoenering weg, niet de omvang van de read — daarvoor zijn W11/W12/W14.

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
| 22-09 | **Fix-optie 1 gebouwd en gemeten (§5f)** → `8d8fde6` / v1.71.3. PO-read van 47 s naar 9,2 s, `tb_read_details` van 45,3 s naar 7,3 s, payload en rijaantal ongewijzigd. Marker staat op `_none`. **Doel A gehaald**: DEV nu sneller dan PROD op wandkloktijd. Fix is tevens voorwaarde voor de promotie van `develop` naar `main` |
| 22-09 | **RCCP-endpoints gemeten (§5g)** → `/rccp/board-kpis` warm 6–8 ms op beide; C1/C2 vallen weg achter de snapshotcache. Geen releaseblokkade. `/rccp/analysis` niet meetbaar zonder parameters (HTTP 400) |
| 22-09 | **W16 op DEV uitgevoerd (§5h)** → Basic → S2 in 2 min 23 s. `app` 9.189 → ~5.280 ms, `tb_read_details` 7.250 → ~3.329 ms. Keten op DEV nu **8,9× sneller** dan gisteren. **PROD nog niet — wacht op een moment buiten kantooruren** |
| 22-09 | **W16 op PROD uitgevoerd (§5i)** → Basic → S2 in 1 min 52 s, op een moment met 0 verbindingen. `app` 11.681 → ~5.988 ms (**2,0×**), health 200. `tb_build_rows` is nu de grootste post op PROD, niet SQL |
| 22-09 | **W1 gebouwd en geverifieerd (§5j)** → `6129444` / v1.71.8. Boot-warmup bevestigd in het containerlog; `/rccp/board-kpis` voor de eerste bezoeker van 10.304 → 1.139 ms. Nuance: de resterende 1,1 s is de dubbele KPI-walk (→ W4/W5), en de 23,9 s koude PO-read kwam van de **lookup-cache** (30 s TTL), niet van de board-snapshot |
| 22-09 | **W14 gebouwd en geverifieerd (§5k)** → `302bc92` / v1.71.9. `tb_lookups` = `tb_lookup_sig` in alle calls: de volledige doeltabel-read is weg, ook ná 45 s pauze. Signatuurquery kost zelf 0,6–1,2 s → vervolg: hooguit één check per 30 s |
| 22-09 | **W4/W5 gemeten en verworpen (§5l)** → payload is 85% `orders`, 15% `sku`; W5 zou 7% besparen. Lazy `confirmed` levert −50% payload én −50% CPU en lost W6 mee op. **W4, W5, W6 vervallen** |
| 22-09 | **Lazy confirmed + signatuur-throttle geverifieerd (§5m)** → `4a7debc` + `3f80d7f` / v1.72.0. Throttle werkt exact: 0 ms binnen het venster, 0,4–0,9 s daarbuiten. Lazy levert −14% payload (niet de voorspelde −50%), −319 ms CPU en −35% op de eerste call. W6 opgelost |
| 23-09 | **Server-vs-browser gemeten (§5n)** → render is 12%, server 64%. Het bord virtualiseert al (5 rijen van 917). **W10 vervalt als prioriteit** |
| 23-09 | **`tb_build_rows` opgesplitst (§5o)** → pav 10–15 ms, formules 2–3 ms: **W11 vervalt in elke vorm**. Masterdeel (724–1.195 ms) groter dan detaildeel. **Vondst: 73.177 detailregels gelezen, 18.145 gebruikt** — het items-filter draait in Node ná een volledige SQL-read |
| | *volgende: **W12** — `itemNumber` als geïndexeerde kolom naast de JSON, zodat het items-filter in SQL kan. Grootste resterende kans. Daarna W9 (CI-gate, inclusief de kapotte `perf-screening`-selectors). Vóór promotie: functionele/security-check op de ~54 commits* |
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
