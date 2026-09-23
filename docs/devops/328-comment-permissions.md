# Comment-rechten per gebruiker en vendor (DevOps)

**Work item:** [#328](https://reyniervanbommel0745.visualstudio.com/Vendor-App/_workitems/edit/328) (Feature, aangemaakt via `az boards work-item create`)
**Doel:** een admin kan per employee en per vendor aan- of uitzetten of iemand comments ziet, zelf comment, en de comments-kolom op het PO-board krijgt.
**Referentie in repo:** [.cursor/plans/dev_2026-09-22-comment-permissions.plan.md](../../.cursor/plans/dev_2026-09-22-comment-permissions.plan.md)
**Repo-document:** `docs/devops/328-comment-permissions.md`
**Tags:** comments; permissions; rbac; security; po-board

> **Aanmaak-methode:** geen Azure DevOps MCP in Claude Code; Feature en child stories zijn via de **Azure CLI** (`az boards work-item create`) aangemaakt in project `Vendor-App`.

---

## User story

**Als** admin
**wil ik** per employee en per vendor kunnen bepalen of iemand comments ziet, plaatst en de comments-kolom op het board krijgt
**zodat** ik interne communicatie buiten het zicht van een leverancier (of een specifieke medewerker) kan houden.

---

## Acceptatiecriteria (definitie van "klaar")

1. De drie rechten `comments.view`, `comments.write` en `comments.column` staan in de bestaande `dbo.user_permissions` en zijn per employee én per vendor te beheren via Instellingen → Users → Choose action → Manage permissions.
2. Bestaand gedrag blijft de startstand: na migratie `051` heeft elke bestaande employee en vendor de drie rechten; nieuwe users krijgen ze bij aanmaken.
3. Zonder het bijbehorende recht geeft de server `403` op de remarks-routes (lezen, schrijven én verwijderen) — UI-verbergen alleen is niet genoeg.
4. Zonder `comments.view` levert `GET /api/data/:tableKey/activity` geen remark-bodies meer (`kind` wordt geforceerd naar `history`, `totals.remarks` is 0), terwijl de rijhistorie blijft werken.
5. Zonder `comments.column` bevat geen enkele kolomrespons nog een kolom met `dataType: 'remarks'`.
6. Een rolwissel employee → vendor wist de comment-rechten niet (vandaag verwijdert die handler álle rijen uit `user_permissions`).
7. Opgeslagen view-tabs met een remarks-kolom of `hasComment`-filter blijven intact wanneer het recht ontbreekt, en zijn compleet zodra het recht terugkomt.
8. Een admin heeft de drie rechten altijd, zonder rijen in de tabel.
9. `npm run test:changed` slaagt; versie in `src/config/version.js` staat op `v1.73.0` (MINOR — nieuwe feature).

---

## Wat is al gedaan (geen DevOps-tasks meer nodig tenzij verificatie)

| Item | Locatie |
|------|---------|
| Permissie-opslag `dbo.user_permissions` + CRUD-routes | `server/routes/admin.js`, migratie `004_user_permissions.sql` |
| Patroon voor server-afdwinging (`requirePagePermission`, admin-bypass) | `server/middleware/auth.js`, `server/utils/pagePermissions.js` |
| `GET /api/auth/me` levert `permissions` al mee | `server/routes/auth.js` |
| Permissiedialoog + checklist-component | `src/components/admin/EditPermissionsDialog.jsx`, `PermissionsChecklist.jsx` |
| Remarks-laag (routes, service, board-UI, hooks) | `server/routes/data.js`, `server/services/RowRemarksService.js`, `src/components/supplier/remarks/` |
| Grens-suite die de permissie-grenzen vastlegt | `server/routes/data.column-permissions.test.js` |
| Volledig plan incl. review-bevindingen | `.cursor/plans/dev_2026-09-22-comment-permissions.plan.md` |

---

## Backlog — child User Stories

### [#329](https://reyniervanbommel0745.visualstudio.com/Vendor-App/_workitems/edit/329) Story A: Rechten opslaan, migratie en rolwissel
**Beschrijving:** de drie rechten bestaan als catalogus, staan in `dbo.user_permissions` en overleven een rolwissel.
**Acceptatiecriteria:**
1. Migratie `051` zet de drie rechten aan voor elke bestaande employee en supplier; twee keer draaien verandert niets.
2. Een nieuwe employee of supplier via `POST /api/admin/users` krijgt de drie rijen.
3. `PATCH …/permissions` accepteert alleen bekende ids: instellingen-ids op een vendor → `400`, comment-ids op een admin → `400`.
4. Rolwissel employee → supplier behoudt de comment-rijen en verwijdert alleen de instellingen-rijen; rolwissel → admin verwijdert alles.

### [#330](https://reyniervanbommel0745.visualstudio.com/Vendor-App/_workitems/edit/330) Story B: Comment-rechten beheren in Manage permissions
**Beschrijving:** de admin zet de drie rechten aan of uit per employee en per vendor, in de bestaande dialoog.
**Acceptatiecriteria:**
1. Employee: bestaande instellingen-vinkjes plus een sectie **Comments** (View comments / Add comments / Show comments column).
2. Vendor: alleen de sectie Comments, geen instellingen-vinkjes.
3. Add of Show column aanzetten zet View mee aan; View uitzetten zet de andere twee uit.
4. Admin: geen comment-vinkjes; de bestaande melding blijft staan.
5. Save stuurt altijd de volledige set mee zodat de andere groep niet gewist wordt. Labels zijn Engels.

### [#331](https://reyniervanbommel0745.visualstudio.com/Vendor-App/_workitems/edit/331) Story C: Server dwingt de comment-rechten af
**Beschrijving:** afdwinging op de server, inclusief de activity-feed en de kolomrespons.
**Acceptatiecriteria:**
1. Zonder `comments.view`: `403` op `GET …/remarks`, `…/remarks/summary`, `…/remarks/search`, `…/remarks/has-comment`.
2. Zonder `comments.write`: `403` op `POST …/remarks`, `PUT …/remarks/:id/reaction` en `DELETE …/remarks/:id`.
3. Zonder `comments.view` wordt `kind` op `GET …/activity` geforceerd naar `history` en is `totals.remarks` 0; rijhistorie blijft werken.
4. Zonder `comments.column` bevat geen kolomrespons nog `dataType: 'remarks'` — via één gedeelde helper in `TableDataService`.
5. Admin slaat alle checks over; een request doet hooguit één permissie-query, zichtbaar als `perm_check` in Server-Timing.

### [#332](https://reyniervanbommel0745.visualstudio.com/Vendor-App/_workitems/edit/332) Story D: Board verbergt comments volgens de rechten
**Beschrijving:** het board toont alleen wat mag, zonder extra netwerkcall en zonder opgeslagen views te beschadigen.
**Acceptatiecriteria:**
1. Zonder View: geen badge, paneel, contextmenu-item, remarks-filters of Remarks-tab in de activity-feed.
2. Zonder Add: geen invoerveld, reactieknoppen of delete-actie; lezen blijft werken als View aan staat.
3. Zonder Column: geen remarks-kolom en geen "add remarks column".
4. Een view-tab met remarks-kolom of `hasComment`-filter blijft intact; `viewStateDiff` meldt geen wijziging.
5. Een `403` op een remarks-route geeft geen foutmelding per call, maar eenmalig "Your permissions have changed".
6. De remarks-onboardingtour wordt overgeslagen zonder View; `PurchaseOrdersPageContent.jsx` wordt korter (gate-hook); versie naar `v1.73.0`.

---

## Bouwvolgorde

Story A → B → C → D. Stap A en B veranderen het board nog niet, omdat de migratie de rechten aan zet. De kolomfilter (onderdeel van C) wordt gecontroleerd vóór D begint: de filtermenu's moeten vanzelf leeg blijven zodra de kolom niet meer meegeleverd wordt.

---

## Versie document

Aangemaakt op basis van [.cursor/plans/dev_2026-09-22-comment-permissions.plan.md](../../.cursor/plans/dev_2026-09-22-comment-permissions.plan.md); wijzig dit bestand bij nieuwe afspraken.
