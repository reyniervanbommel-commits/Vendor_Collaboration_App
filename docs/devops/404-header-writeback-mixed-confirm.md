# Header write-back: bevestiging bij afwijkende regelwaarden + D365-redenen (DevOps)

**Doel:** Voorkomen dat een header-edit stilzwijgend afwijkende regelwaarden overschrijft, en D365-weigeringen per regel leesbaar tonen.  
**Spec:** [docs/specs/2026-10-09-header-writeback-mixed-confirm-design.md](../specs/2026-10-09-header-writeback-mixed-confirm-design.md)  
**Plan:** [.cursor/plans/dev_2026-10-09-header-writeback-mixed-confirm.plan.md](../../.cursor/plans/dev_2026-10-09-header-writeback-mixed-confirm.plan.md)  
**Work item:** #AB:404 (vervolg op #302, child van Feature #130 — D365 Purchase Orders)  
**Tags:** d365; write-back; purchase-orders; header-push

---

## Aanleiding

PROD-incident `whsl|WSPO-0422062`: een header-edit overschreef regels met afwijkende waarden zonder waarschuwing, en de D365-weigering was voor de gebruiker niet te herleiden.

---

## Acceptatiecriteria

- [ ] Header-edit op een order met `+N` (≥2 unieke regelwaarden) toont eerst een bevestigingsdialoog. *Cancel* = geen API-call, cel toont de oude waarde. *Update all lines* = huidige fan-out.
- [ ] Header-edit zonder `+N` toont geen dialoog (ongewijzigd).
- [ ] Bulk over meerdere orders, waarvan ≥1 met `+N`: één bevestiging vooraf met het aantal orders met afwijkende waarden, geen per-order dialoog.
- [ ] Faalt een regel in D365: per regel `Line <n>: <opgeschoonde D365-reden>` (eerste 3, daarna `+N more`) in de cel-tooltip en in kolom *Error* van *Bulk edit finished*, volledig leesbaar.
- [ ] Deels geslaagde order telt als **Partially updated** (rij: `1 of 2 lines updated. Line 20: …`), niet als Failed.
- [ ] Ruwe D365-fout blijft volledig in `tb_field_corrections.error` (audit ongewijzigd).

---

## Testinstructies (localhost)

`npm run dev:all`, `http://localhost:5178`, staff-login, DEV-data.

1. Order met `+N` op een gepushte write-back-header: wijzig waarde, dialoog *Overwrite different line values?*. *Cancel* = oude waarde, geen job-badge; *Update all lines* = job loopt, header toont één waarde.
2. Order zonder `+N`: geen dialoog.
3. Twee+ orders selecteren, waarvan één met `+N`, *Update all selected*: één bevestiging `1 of N selected orders …`.
4. D365-weigering forceren (geblokkeerd artikel): *Bulk edit finished* toont `Partially updated: 1`, Partial-badge en `Line <n>: <reden>`; badge rechtsboven `Write-back: 1 needs attention`.

---

## Versie

App-versie `v1.73.24`.
