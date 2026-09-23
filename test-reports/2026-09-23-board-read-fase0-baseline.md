# Fase 0 nulmeting — board-read (#AB:334 / #AB:335)

**Modus:** static only. Deze cloud-run heeft geen SQL Server en start de app-server niet, dus er is geen warme of koude PO-board-request tegen de echte database gemeten. Productiecijfers horen op de feature-preview, met hetzelfde staff-account en volume als latere Stories.

## Wat wel vastligt

De contracttest `server/services/board-read/boardReadContract.test.js` draait de ongewijzigde `TableDataService.read` tegen een vaste purchase-orders-fixture. Een volledige staff-read moet deze Server-Timing-labels blijven zetten:

`tb_meta`, `tb_sync_state`, `tb_viewed`, `tb_revision`, `tb_history_hints`, `tb_track_marks`, `tb_sync_rules`, `tb_read_cols`, `tb_links`, `tb_lookups`, `tb_lookup_items`, `tb_read_masters`, `tb_read_details`, `tb_read_custom`, `tb_build_rows`, `tb_build_details`, `tb_build_det_lookups`, `tb_build_det_pav`, `tb_build_det_formulas`, `tb_build_det_rows_n`, `tb_detail_rows_full`, `tb_retention`, `tb_ledger`.

Zonder change-decorations verdwijnen `tb_history_hints`, `tb_track_marks`, `tb_ledger` en `tb_viewed`. Dat is huidig gedrag, geen regressie.

## Nog te meten op preview (AC 11 en AC 12)

Vijf warme PO-board-loads en vijf eerste loads na containerherstart. Noteer per koude run of `BoardWarmup` nog liep. Falgrens voor latere Stories: meer dan 10% én meer dan 100 ms op de mediane requesttijd, of meer dan 20% op een `tb_*`-onderdeel dat hier minimaal 100 ms was.

| Meting | Mediaan request | Belangrijkste `tb_*` | Warmup liep |
|---|---|---|---|
| Warm (5×) | niet gemeten | niet gemeten | n.v.t. |
| Koud na herstart (5×) | niet gemeten | niet gemeten | niet gemeten |
