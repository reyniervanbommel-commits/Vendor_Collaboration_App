# Header-edit van gepushte D365-line-waarden (DevOps)

**Doel:** Staff kan een via *Push values to header* gekoppelde D365-writable line-kolom vanaf de header bewerken; één POST schrijft alle regels van die PO terug, ook bij `+N`.  
**Referentie in repo:** [.cursor/plans/dev_2026-09-02-header-push-line-writeback.plan.md](../../.cursor/plans/dev_2026-09-02-header-push-line-writeback.plan.md)  
**Spec:** [docs/specs/2026-09-02-header-push-line-writeback-design.md](../specs/2026-09-02-header-push-line-writeback-design.md)  
**Work item:** #AB:302 (child van Feature #130 — D365 Purchase Orders)  
**Tags:** d365; write-back; purchase-orders; header-push

---

## User story

**Als** staff (admin of employee) op het purchase-orderboard  
**wil ik** een gepushte D365-writable line-waarde op de header inline wijzigen  
**zodat** die waarde naar D365 gaat op alle regels van die ene order, ook als de header `+N` toont.

---

## Acceptatiecriteria (definitie van "klaar")

1. Writable bron-line + push-link → header-cel bewerkbaar; anders read-only.
2. Save (één waarde of `+N`) PATCHt alle niet-gelijke regels van díé PO; andere POs blijven onaangeroerd.
3. Volledig succes → één waarde, geen `+N`. Lege PO / 0 regels → geen PATCH, rollup blijft leeg/`-`.
4. Deel-409 → fout op de header, geen rollback, rollup volgt resterende verschillen.
5. Multi-select → geen bulk-dialoog. Leverancier → geen editor + POST 403.
6. UI-teksten Engels.

---

## Wat is al gedaan (geen DevOps-tasks meer nodig tenzij verificatie)

| Item | Locatie |
|------|---------|
| BRD/FRD/TD + team-review 🟢 | `docs/specs/2026-09-02-header-push-line-writeback-design.md` |
| Implementatieplan (taken 1–7, TDD) | `.cursor/plans/dev_2026-09-02-header-push-line-writeback.plan.md` |

Gebouwd en gemerged (PR #112, #116). Vervolg: #404 (bevestiging bij afwijkende waarden + D365-redenen). `review-plan-for-devops` is 🟢; blockers (`remainingValues` van de server, hook alleen in `PurchaseOrdersPageContent.jsx`, 8-prop header-contract) zijn in plan en spec doorgevoerd.

---

## Backlog — tasks

- [x] Task 1: Comparator + fan-out-util (`odataValueEquals`, `detailCorrectionFanout`, cap 200)
- [x] Task 2: `POST /api/data/purchase-orders/correct-all-details` + supplier 403
- [x] Task 3: WriteBackCell datum-extractie + `remainingDisplayValue`
- [x] Task 4: Linked-value meta builder (drie hooks, `writableToD365`)
- [x] Task 5: `patchLinkedLineValues` + `applyLineValuesBatch` + `usePurchaseOrderCorrectAllLines`
- [x] Task 6: Header UI `PurchaseOrderLinkedHeaderValue` (8 props, geen 14e HeaderCell-prop)
- [x] Task 7: Versie PATCH +1 + kwaliteitspoort

---

## Aantoonbaar

- Staff, writable gepushte line-kolom: header-input; succes → één waarde, geen `+N`
- `+N` → alle regels van die PO overschreven
- Deel-409 → fout op header, resterende mixed
- Multi-select: geen “Update multiple rows?”
- Leverancier: read-only
- `localhost:5178`

---

## Versie document

Aangemaakt op basis van [.cursor/plans/dev_2026-09-02-header-push-line-writeback.plan.md](../../.cursor/plans/dev_2026-09-02-header-push-line-writeback.plan.md); wijzig dit bestand bij nieuwe afspraken.

Repo-document: docs/devops/302-header-push-line-writeback.md
