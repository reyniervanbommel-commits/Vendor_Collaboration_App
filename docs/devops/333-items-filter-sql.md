# PO-board: items-syncfilter in SQL via een geïndexeerde itemNumber-kolom (W12) (DevOps)

**Doel:** het items-syncfilter uitvoeren in SQL in plaats van in Node, zodat de PO-board-read niet langer viermaal zoveel detailregels leest als hij gebruikt.
**Work item:** [#333](https://dev.azure.com/reyniervanbommel0745/Vendor-App/_workitems/edit/333)
**Referentie in repo:** [.cursor/plans/2026-09-21-perf-dev-prod-gelijktrekken.plan.md](../../.cursor/plans/2026-09-21-perf-dev-prod-gelijktrekken.plan.md) — §5o
**Tags:** performance; sql; tb_cache; po-board; migratie

---

## User story

**Als** medewerker of leverancier die de PO-tabel opent
**wil ik** dat de server alleen de inkoopregels leest die daadwerkelijk op het bord horen
**zodat** het bord seconden sneller laadt zonder dat er iets aan de getoonde inhoud verandert.

---

## Probleem — gemeten 23-09-2026 op Azure DEV

De items-tabel heeft een syncfilter (`ProductType eq …`). Dat filter werkt door naar het PO-board: een inkoopregel waarvan het artikel niet in de items-cache staat hoort niet op het bord, en een order zonder overgebleven regels verdwijnt.

De uitvoering gebeurt nu in Node, **ná** het lezen:

| Stap | Waar | Aantal |
|---|---|---|
| 1. SQL leest alle detailregels | `readCacheRows` — `WHERE table_id = @tableId AND scope = 'detail'` | **73.177** |
| 2. Node laadt toegestane artikelen | `loadPresentItemFilterKeys` → set van `partitie\|artikelnummer` | — |
| 3. Node filtert per order | `detailMatchesItemsFilter` | **18.145** |

**75% van wat de database ophaalt en over de verbinding stuurt wordt weggegooid.** Dat verklaart waarom `tb_read_details` met 2.757–4.061 ms de grootste post in de board-read is.

---

## Voorgestelde oplossing

De regel "dit artikel staat in de items-cache" is precies een join tussen de detailregels en de items-cache — beide staan in `dbo.tb_cache`. Het enige wat ontbreekt is dat SQL het artikelnummer van een detailregel niet kan zien: dat zit in de JSON-blob.

```sql
ALTER TABLE dbo.tb_cache
  ADD item_number AS CAST(JSON_VALUE(data_json, '$.itemNumber') AS NVARCHAR(100)) PERSISTED;

CREATE INDEX IX_tb_cache_item
  ON dbo.tb_cache (table_id, scope, partition_key, item_number);
```

**`PERSISTED` is hier de kern.** De `JSON_VALUE` wordt eenmalig bij het schrijven uitgerekend en opgeslagen, niet bij elke read. Dat is het tegenovergestelde van commit `56b98bd`, die `JSON_VALUE` per veld in de SELECT zette en de detail-read daarmee tien keer trager maakte (45 s tegen 4,6 s; zie `8d8fde6` voor de terugdraai).

Daarna kan de detail-query filteren:

```sql
SELECT … FROM dbo.tb_cache d
WHERE d.table_id = @tableId AND d.scope = 'detail'
  AND EXISTS (
    SELECT 1 FROM dbo.tb_cache i
    WHERE i.table_id = @itemsTableId AND i.scope = 'master'
      AND i.removed_at_source = 0
      AND i.partition_key = d.partition_key
      AND i.record_key = d.item_number)
```

---

## Verwachte winst

- `tb_read_details`: van ~3.500 ms naar de orde van 1.000 ms
- Kleiner detaildeel in `tb_build_rows` (nu 392–725 ms op DEV)
- Ruwweg **2 tot 3 seconden** van de huidige ~5 s board-read

Dit is de laatste bekende maatregel die nog seconden kan schelen; alles daarna gaat over tienden. Ter vergelijking: W11 (lichte detail-opbouw) is gemeten en verworpen — de over te slaan stappen kosten samen 12–18 ms.

---

## Acceptatiecriteria

1. Een PO-board-read leest alleen de detailregels die binnen het items-syncfilter vallen; `tb_build_det_rows_n` en het aantal door SQL geleverde rijen zijn gelijk.
2. `tb_read_details` is aantoonbaar lager dan de nulmeting (~3.500 ms op DEV), gemeten met dezelfde methode en drie runs.
3. Het bord toont exact dezelfde orders en regels als voor de wijziging: zelfde rijaantal, zelfde totalen, zelfde new/changed-vlaggen, zelfde `productImageSummary`.
4. Orders waarvan alle regels buiten het items-filter vallen blijven verborgen (`ordersHiddenByItemsFilter`-gedrag ongewijzigd).
5. Detailregels zonder `itemNumber` vallen af, net als nu.
6. Staat het artikelveld niet op `itemNumber`, dan valt de read terug op het bestaande Node-filter zonder gedragsverschil.
7. De migratie is idempotent (`IF NOT EXISTS`) en is succesvol op DEV gedraaid voordat hij op PROD komt.
8. De duur van de nachtsync is niet meetbaar verslechterd.

---

## Aandachtspunten

1. **De veldnaam is configureerbaar.** De code leest het artikelveld uit de items-lookup (`itemsLookup.sourceFieldKey`), met `itemNumber` als standaard. Een berekende kolom staat vast op één JSON-pad. Voorstel: de SQL-route alleen gebruiken wanneer dat veld daadwerkelijk `itemNumber` is, en anders terugvallen op het bestaande Node-filter. Dezelfde conservatieve lijn die op 22-09 twee keer een fout heeft voorkomen.
2. **De `ALTER TABLE` herschrijft de tabel.** Bij een `PERSISTED` kolom wordt elke bestaande rij berekend en weggeschreven. `tb_cache` heeft honderdduizenden rijen; dat kost tijd en vergrendelt de tabel. Buiten kantooruren plannen, op PROD apart.
3. **Schrijfkant.** Elke sync-insert berekent de `JSON_VALUE` en onderhoudt de index. Verwacht verwaarloosbaar tegenover de leeswinst, maar niet nul — meten op de nachtsync.
4. **Opslag.** Circa 100 bytes per rij extra, plus de index. De database staat op Standard S2 (250 GB cap), dus ruim voldoende — wel noteren.

---

## Openstaande vragen

1. **Staat SQL Server een `PERSISTED` computed column met `JSON_VALUE` toe op deze versie?** `JSON_VALUE` is deterministisch, dus het hoort te kunnen — maar dat is precies het soort aanname dat op 22-09 twee keer fout bleek. **Eerste stap: uitproberen op een testtabel, niet op `tb_cache`.**
2. **Is een migratie op `tb_cache` acceptabel?** Dit is de kerntabel van de app en de `ALTER` raakt hem in zijn geheel. Ander kaliber dan de wijzigingen van 21–23 september, die allemaal code-only waren.
3. **Hoe lang duurt de `ALTER` op PROD?** Te schatten door hem eerst op DEV te draaien en te klokken. DEV heeft 73.177 detailrijen, PROD 70.675 — vergelijkbaar, dus de DEV-meting is representatief.
4. **Moet de index ook `removed_at_source` bevatten?** De `EXISTS`-subquery filtert daarop in de items-tabel. Afhankelijk van het queryplan kan een extra kolom in de index helpen. Bepalen met een echt uitvoeringsplan, niet op gevoel.
5. **Wat gebeurt er met detailregels zonder `itemNumber` in de JSON?** Nu geeft `buildItemFilterKey` daarvoor `null` en valt de regel af. De `EXISTS`-variant doet hetzelfde (NULL matcht niet), maar dat moet expliciet getest worden.
6. **Is er een tweede plek die van dit filter afhangt?** `ordersHiddenByItemsFilter` verbergt orders zonder overgebleven regels. Die logica moet identiek blijven wanneer het filter naar SQL verhuist.

---

## Backlog — tasks

- [ ] `PERSISTED` + `JSON_VALUE` uitproberen op een testtabel (vraag 1)
- [ ] Migratie schrijven: computed column + index, idempotent
- [ ] Migratie op DEV draaien en de duur klokken (vraag 3)
- [ ] Uitvoeringsplan van de nieuwe detail-query bekijken (vraag 4)
- [ ] `readCacheRows` de SQL-route laten gebruiken, met terugval op het Node-filter
- [ ] `ordersHiddenByItemsFilter` gelijk houden (vraag 6)
- [ ] Tests: regels zonder `itemNumber`, afwijkend artikelveld, orders die volledig wegvallen
- [ ] Meten op DEV: `tb_read_details`, `tb_build_det_rows_n`, rijaantal en totalen vergelijken
- [ ] Nachtsync-duur vergelijken voor en na

---

## Context

Onderdeel van het perf-onderzoek van 21–23 september 2026. Al gerealiseerd in dat onderzoek: PO-board-read op DEV van 47.060 ms naar ~5.000 ms (9×), PROD van 11.681 ms naar ~5.988 ms via de database-tier. Dit item is de resterende grote post.

Volledige analyse, metingen en logboek staan in het plan: [.cursor/plans/2026-09-21-perf-dev-prod-gelijktrekken.plan.md](../../.cursor/plans/2026-09-21-perf-dev-prod-gelijktrekken.plan.md).
