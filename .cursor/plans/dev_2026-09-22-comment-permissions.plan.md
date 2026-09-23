# Comment-rechten per gebruiker en vendor

**Datum:** 22 september 2026
**Status:** op het bord — nog niet gebouwd
**Work item:** [#328](https://reyniervanbommel0745.visualstudio.com/Vendor-App/_workitems/edit/328) (Feature) met children [#329](https://reyniervanbommel0745.visualstudio.com/Vendor-App/_workitems/edit/329) t/m [#332](https://reyniervanbommel0745.visualstudio.com/Vendor-App/_workitems/edit/332) — zie [docs/devops/328-comment-permissions.md](../../docs/devops/328-comment-permissions.md)
**Doel:** Een admin kan per employee en per vendor drie dingen aan- of uitzetten: comments zien, zelf commenten, en de comments-kolom zien. Dat gebeurt in Instellingen → Users → Choose action → Manage permissions.

**User story:** Als admin wil ik per employee en per vendor kunnen bepalen of iemand comments ziet, plaatst en de comments-kolom op het board krijgt, zodat ik gevoelige interne communicatie buiten het zicht van een leverancier (of een specifieke medewerker) kan houden.

**Omvang:** dit is een Feature met vier deelgebieden (data + API, admin-dialoog, server-afdwinging, board-UI). Op het bord (`Vendor-App`) hoort het als Feature met vier child-stories, één per deelgebied uit §10.

## 1. Wat de gebruiker nu doet

Vandaag mag iedereen die het purchase-order-board mag openen comments zien, plaatsen en de remarks-kolom zien.

- Employees en admins: volledige toegang.
- Vendors (rol `supplier`): lezen en plaatsen op orders binnen hun eigen vendor-scope (`server/middleware/dataAccess.js`, `server/services/RowRemarksService.js`).
- Manage permissions (`src/components/admin/EditPermissionsDialog.jsx`) toont alleen instellingen-vinkjes, en alleen bij een employee. Bij een vendor staat de tekst “Settings permissions can only be granted to employees.”

Die instellingen-vinkjes blijven. De comment-opties komen erbij, in dezelfde dialoog, voor employee én vendor.

## 2. Drie opties

Engelse labels in de dialoog, sectie **Comments**:

| Id in `dbo.user_permissions` | Label | Wat het doet |
|---|---|---|
| `comments.view` | View comments | Rij-icoon, comment-paneel, tellingen, zoeken, “has a comment”-filter en de remarks in de activity-feed |
| `comments.write` | Add comments | Nieuw comment plaatsen, reacties zetten en een eigen comment verwijderen |
| `comments.column` | Show comments column | De remarks-kolom op het board |

Afhankelijkheden in de dialoog (één vinkje, geen extra uitlegtekst nodig):

- **Add comments** aanzetten zet **View comments** ook aan.
- **Show comments column** aanzetten zet **View comments** ook aan.
- **View comments** uitzetten zet de andere twee uit.

Een admin heeft altijd alle drie. De dialoog toont bij een admin geen comment-vinkjes, alleen de bestaande melding dat instellingen-rechten alleen voor employees zijn. Admins blijven buiten deze rechten.

Bestaand gedrag blijft de startstand: migratie zet de drie rechten aan voor elke bestaande employee en vendor. Een nieuwe employee of vendor krijgt ze ook aan bij aanmaken. De admin zet ze daarna uit waar dat nodig is.

## 3. Wat niet verandert

- Instellingen-tabs (Users, OData, enz.) blijven employee-only, zoals nu (#AB:326).
- Vendor-scope op orders blijft. Een vendor met “Add comments” mag alleen commenten op eigen orders.
- Rijhistorie / track changes blijft zichtbaar voor iedereen die het board mag zien; alleen de remarks verdwijnen uit de gecombineerde feed (zie §5).
- Geen nieuwe SQL-tabel. De rijen gaan in de bestaande `dbo.user_permissions` (`page_name`).

## 4. Opslag en API

Whitelist in `server/utils/commentPermissions.js` (nieuw) en `src/constants/commentPermissions.js` (nieuw), dezelfde drie ids.

`PATCH /api/admin/users/:id/permissions` accepteert alleen bekende ids:

- Employee: de bestaande instellingen-ids plus de drie comment-ids.
- Vendor: alleen de drie comment-ids. Een instellingen-id geeft `400`.
- Admin-account: comment-ids weigeren (`400`). Admin-rechten worden niet opgeslagen.

De route vervangt nog steeds alle rijen van die user in één keer. De dialoog stuurt daarom altijd de volledige set mee (instellingen + comments bij een employee, alleen comments bij een vendor), anders wist een save de andere groep.

### 4a. Rolwissel mag de comment-rechten niet wissen

`PATCH /api/admin/users/:id` verwijdert vandaag **alle** rijen uit `dbo.user_permissions` zodra een user geen employee meer is (`server/routes/admin.js`, het blok met commentaar “#AB:326”). Dat was goed toen de tabel alleen instellingen-rechten bevatte, maar wist straks stilzwijgend de comment-rechten van een vendor.

Nieuw gedrag bij een rolwissel:

| Nieuwe rol | Wat er met de rijen gebeurt |
|---|---|
| `admin` | alle rijen verwijderen (admin heeft alles impliciet) |
| `supplier` | alleen de instellingen-ids verwijderen; de drie comment-ids blijven staan, en ontbrekende comment-ids worden aangezet |
| `employee` | niets verwijderen; ontbrekende comment-ids aanzetten |

Het commentaar bij dat blok wordt meegeschreven, zodat de reden zichtbaar blijft.

### 4b. Lezen door de sessie

`GET /api/auth/me` levert `permissions` al. Geen extra call. De board leest `comments.view`, `comments.write` en `comments.column` daaruit. Admin: de client behandelt de drie als aan, ook als ze niet in de lijst staan.

`useSessionAuth` haalt `/auth/me` één keer op bij mount, terwijl de server per request leest (`server/utils/pagePermissions.js` heeft bewust geen cache). Trekt een admin een recht in terwijl iemand op het board staat, dan loopt de UI dus achter op de server. Daarom:

- Een `403` op een remarks-route wordt in `apiRequest`-afhandeling **stil** verwerkt: het element verdwijnt, er komt geen foutmelding per call.
- Eén keer per sessie verschijnt in plaats daarvan de melding “Your permissions have changed. Reload the page to continue.” (Engels, `MessageBar`).

## 5. Afdwinging op de server

UI verbergen is niet genoeg. In `server/routes/data.js`, vóór de remarks-handlers:

| Recht | Routes die `403` geven zonder dat recht |
|---|---|
| `comments.view` | `GET …/remarks/summary`, `…/remarks/search`, `…/remarks/has-comment`, `GET …/remarks` |
| `comments.write` | `POST …/remarks`, `PUT …/remarks/:id/reaction`, `DELETE …/remarks/:id` |
| `comments.column` | remarks-kolommen (`dataType === 'remarks'`) uit de kolomlijst halen die het board krijgt |

`DELETE …/remarks/:id` staat nu alleen op `requireAnyRole([ADMIN, EMPLOYEE])`. Daar komt `comments.write` bij; de bestaande owner/admin-regel in `RowRemarksService` blijft ongewijzigd.

`comments.write` zonder `comments.view` is ook `403` op de schrijfroutes. Zelfde voor de kolom zonder view: de kolom wordt dan niet meegegeven.

### 5a. De activity-feed (anders lekken de comments alsnog)

`GET /api/data/:tableKey/activity` geeft met `kind=all` een gecombineerde feed terug waarin `RowActivityService` de remark-body meestuurt (`UNION ALL` op `dbo.tb_row_remarks`, kolom `r.body`). Zonder maatregel is `comments.view` dus alleen een gordijn voor de UI.

Deze route krijgt **geen 403** — dan sneuvelt ook de rijhistorie, die los staat van comments. In plaats daarvan:

- Zonder `comments.view` wordt `kind` server-side geforceerd naar `'history'`, ongeacht wat de client stuurt.
- De teller `totals.remarks` gaat in dat geval naar `0`, zodat de tab “Remarks (n)” geen aantallen verklapt.

### 5b. Kolommen: één filter, drie uitgangen

De kolomlijst verlaat de server via drie plekken. Eén gedeelde helper (`filterRemarksColumns(columns, user)`) in `server/services/TableDataService.js`, aangeroepen vanuit:

1. `dataService.read()` — de board-payload (`GET /api/data/:tableKey`).
2. `getBoardColumnDefinitions()` — `GET /api/data/:tableKey/columns?enriched=1`.
3. `registry.listColumns()`-pad van diezelfde route (niet-enriched variant).

`GET /api/data/:tableKey/board-columns` staat al achter `requirePagePermission('datamodel')` en blijft ongemoeid.

### 5c. Rol- en permissie-volgorde

Employees vallen hier voor het eerst onder een per-user check. Nu slaat `restrictSupplierDataAccess` employees altijd door. De comment-check komt ná die rol-check, voor admin, employee én vendor. Admin slaat de check over, net als in `requirePagePermission`.

### 5d. Eén query per request, niet per recht

`pagePermissions.hasPagePermission` doet per aanroep een SQL-query en heeft bewust geen cache. Drie losse checks op een hot route (`summary` en `has-comment` draaien bij elke board-load) zijn drie roundtrips.

`hasCommentPermission(req, id)` leest daarom één keer per request `listPagePermissions(user.id)` en memoïseert dat op `req` (`req._commentPermissions`). De lees-actie wordt gewrapt in `time('perm_check', …)` uit `server/utils/timing.js`, zodat het in Server-Timing zichtbaar blijft. Admin: nooit een query, altijd `true`.

## 6. Wat het board verbergt

| Recht uit | Verborgen |
|---|---|
| View | `RowRemarksBadge`, remarks-paneel, “Remarks” in het cel-contextmenu, remarks-filters, de Remarks-tab in de activity-feed |
| Add | invoerveld, reactieknoppen en delete-actie in het paneel. Het paneel blijft lezen als View aan staat |
| Column | kolommen met `dataType === 'remarks'`, inclusief “add remarks column” voor die gebruiker |

Geen extra netwerkcall. De vlaggen komen uit de al geladen `permissions` van de sessie, via één hook `useCommentPermissions()` (`src/hooks/useCommentPermissions.js`, nieuw) die `AuthContext` leest en `{ canView, canWrite, canSeeColumn }` teruggeeft. Alle componenten hieronder lezen die hook; nergens wordt `permissions` opnieuw uitgeplozen.

### 6a. Opgeslagen view-tabs blijven intact

Een gebruiker kan een view-tab hebben met een remarks-kolom of een `hasComment`-filter. Het filteren gebeurt **alleen in de render**, nooit in de opgeslagen view-state:

- De remarks-kolom wordt uit de te tonen kolommen gefilterd, niet uit het opgeslagen tab-object.
- Een remarks-filter wordt bij het toepassen genegeerd (`tableViewFilterUtils`), maar blijft in de opgeslagen view staan.
- `viewStateDiff` mag door het verbergen géén “gewijzigde view” melden.

Zo krijgt de gebruiker zijn kolomvolgorde en filters terug zodra de admin het recht teruggeeft.

## 7. Bestanden

### Server

| Bestand | Wijziging |
|---|---|
| `server/utils/commentPermissions.js` | nieuw: de drie ids + `hasCommentPermission(req, id)` (admin = altijd true, één query per request) |
| `scripts/db/migrations/051_comment_permissions.sql` | idempotent: drie rijen voor elke user met rol `employee` of `supplier` die ze nog niet heeft |
| `server/routes/admin.js` | whitelist op PATCH permissions; rolwissel-gedrag uit §4a; bij `POST /users` de drie rijen zetten voor employee en supplier |
| `server/routes/data.js` | 403 op remarks-routes incl. DELETE; `kind`-downgrade op `/activity` |
| `server/services/RowActivityService.js` | `totals.remarks` op 0 zonder view-recht |
| `server/services/TableDataService.js` | `filterRemarksColumns()` + aanroep in `read()` en `getBoardColumnDefinitions()` |

### Client

| Bestand | Wijziging |
|---|---|
| `src/constants/commentPermissions.js` | nieuwe catalogus, niet in `PAGE_PERMISSIONS` (anders verschijnen ze als instellingen-tab) |
| `src/hooks/useCommentPermissions.js` | nieuw: `{ canView, canWrite, canSeeColumn }` uit de sessie |
| `src/components/admin/PermissionsChecklist.jsx` | extra sectie Comments; prop `includeSettings` zodat een vendor alleen Comments ziet |
| `src/components/admin/EditPermissionsDialog.jsx` | employee: instellingen + comments; vendor: alleen comments + Save |
| `src/components/supplier/PurchaseOrderRowControls.jsx` | badge alleen bij view |
| `src/components/supplier/PurchaseOrdersPageContent.jsx` | paneel- en open-actie achter view; zie §9 over de bestandsgrootte |
| `src/components/supplier/PurchaseOrderCellContextMenu.jsx` | “Remarks”-item alleen bij view |
| `src/components/supplier/PurchaseOrderAddColumnPane.jsx` | remarks-type verbergen zonder column-recht |
| `src/components/supplier/remarks/useRemarksSummary.js` | niet fetchen zonder view; 403 stil afhandelen |
| `src/components/supplier/remarks/useRowRemarks.js` | niet fetchen zonder view; schrijf-acties achter write |
| `src/components/supplier/remarks/useRemarksColumnFilter.js` | `has-comment` / `search` niet aanroepen zonder view |
| `src/components/supplier/remarks/usePurchaseOrderRemarksController.js` | paneel-state en history-totals achter view |
| `src/components/supplier/remarks/useRowActivity.js` | `kind=all` alleen bij view, anders `history` |
| `src/components/supplier/remarks/RemarksPanel.jsx` | Remarks-tab weg zonder view; composer/reacties weg zonder write |
| `src/components/supplier/remarks/RemarkComposer.jsx` | niet renderen zonder write |
| `src/components/supplier/remarks/RemarkReactionBar.jsx` | reacties alleen bij write |
| `src/hooks/usePurchaseOrderRemarksFilterBridge.js` | remarks-filter overslaan zonder view |
| `src/hooks/usePurchaseOrderColumnMenuFlags.js` | remarks-kolomacties uit zonder column-recht |
| `src/components/onboarding/guidesRemarks.js` + `pageTours.js` | de remarks-tour overslaan zonder view (de tour richt op `[data-column-type="remarks"]` en hangt anders) |
| `src/config/version.js` | MINOR ophogen (`v1.72.1` → `v1.73.0`) — nieuwe feature, geen patch |

De filtermenu-bestanden (`PurchaseOrderColumnFilterMenu*.jsx`, `purchaseOrderColumnFilterMenuConstants.js`) hoeven niets te weten van rechten: die krijgen de remarks-kolom al niet meer binnen zodra §5b staat. Dat controleren we in stap 4 van de bouwvolgorde voordat we verder gaan.

## 8. Testen

Nieuwe tests naast de bestaande permissie- en remarks-tests. Lokaal: `npm run test:changed`.

**Rechten en routes**

- Vendor zonder `comments.view`: `GET /remarks` → 403; met het recht en eigen order → 200.
- Vendor met view maar zonder write: `POST /remarks` → 403.
- Employee zonder write: `DELETE /remarks/:id` → 403, ook als hij de auteur is.
- Employee zonder `comments.view`: `GET /activity?kind=all` bevat geen `body` en `totals.remarks === 0`; de history-items staan er nog wel.
- Employee zonder `comments.column`: kolomrespons bevat geen `dataType: 'remarks'` — zowel via `GET /:tableKey` als via `GET /:tableKey/columns?enriched=1`.
- Admin zonder rijen in `user_permissions`: remarks blijven 200 en de kolom blijft staan.
- Eén request met drie checks doet hooguit één permissie-query.

**Beheer**

- PATCH met `odata` op een vendor → 400; de drie comment-ids → 200.
- Rolwissel employee → supplier: de drie comment-rijen blijven bestaan, de instellingen-rijen zijn weg.
- Rolwissel employee → admin: alle rijen weg.
- Nieuwe vendor via `POST /users`: de drie rijen staan er.

**UI**

- Dialoog: vendor ziet View / Add / Show column en geen OData-vinkje. Add aanzetten zet View aan; View uitzetten zet de andere twee uit.
- Board zonder view: geen badge, geen Remarks in het contextmenu, geen remarks-filter.
- View-tab met een remarks-filter bij een gebruiker zonder recht: de tab laadt, `viewStateDiff` meldt geen wijziging, en na herstel van het recht staat het filter er nog.

## 9. Bestandsgrootte

`src/components/supplier/PurchaseOrdersPageContent.jsx` is nu 301 regels — al op de grens uit `CLAUDE.md`. Er komt niets bij zonder te splitsen: de remarks-gating (paneel openen, badge-props, filter-bridge) verhuist naar `src/components/supplier/remarks/usePurchaseOrderRemarksGate.js`, zodat het component korter wordt in plaats van langer.

## 10. Bouwvolgorde

1. **Data + API** — catalogus, migratie `051`, default bij nieuwe users, rolwissel-gedrag (§4a), PATCH-whitelist.
2. **Admin-dialoog** — `PermissionsChecklist` + `EditPermissionsDialog` voor employee én vendor.
3. **Server-afdwinging** — 403 op lezen/schrijven/verwijderen, `kind`-downgrade op `/activity`, `hasCommentPermission` met request-memo.
4. **Kolom verbergen** — `filterRemarksColumns` op de drie uitgangen; daarna controleren dat de filtermenu's vanzelf leeg blijven.
5. **Board-UI** — hook `useCommentPermissions`, gate-hook uit §9, badge/paneel/composer/contextmenu/tour, 403-afhandeling uit §4b.
6. **Afronden** — versie naar `v1.73.0`, `npm run test:changed`, daarna `final-check-feature`.

Elke stap is apart te testen. Stap 1–2 veranderen het board nog niet, omdat de migratie de rechten aan zet.
