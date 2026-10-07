# Supply Chain-rol en zichtbaarheid van opmerkingen — design

Datum: 2026-10-07 · Status: goedgekeurd ontwerp (wacht op spec-review)

## Doel

Interne medewerkers moeten opmerkingen op een PO-rij kunnen plaatsen die een vendor **niet** ziet, en Supply Chain moet bewust kunnen kiezen of een opmerking voor de vendor of intern is. Daarvoor komt een nieuwe gebruikersrol **Supply Chain** en een zichtbaarheid per opmerking.

## Beslissingen (afgestemd met gebruiker)

1. Nieuwe rol **Supply Chain** (`supply_chain`), te kiezen op de User Management-pagina.
2. Supply Chain heeft voor alles buiten opmerkingen **dezelfde rechten als een employee** (page permissions via *Edit permissions*, comment permissions, remark delete, track changes, …).
3. Supply Chain en Admin kiezen bij elke opmerking: **For vendor** of **Internal**.
4. Employee-opmerkingen zijn **altijd intern** (geen keuze).
5. Vendor-opmerkingen zijn altijd zichtbaar voor de vendor zelf en voor Supply Chain/Admin, **niet** voor employees.
6. *Internal* = zichtbaar voor iedereen behalve vendors. Employees zien elkaars opmerkingen.
7. Bestaande opmerkingen krijgen een zichtbaarheid op basis van de huidige rol van de auteur (zie Migratie).

### Zichtbaarheidsmatrix

| Geplaatst door | Vendor (eigen rijen) | Employee | Supply Chain / Admin |
|---|---|---|---|
| Vendor | ✅ | ❌ | ✅ |
| Employee (altijd internal) | ❌ | ✅ | ✅ |
| Supply Chain / Admin → For vendor | ✅ | ❌ | ✅ |
| Supply Chain / Admin → Internal | ❌ | ✅ | ✅ |

## Datamodel

### Rol

- Migratie: `CK_users_role_allowed` uitbreiden naar `('admin','employee','supplier','supply_chain')` (idempotent: drop-if-exists + add).
- `ROLES.SUPPLY_CHAIN = 'supply_chain'` in `server/constants/roles.js` en `src/constants/roles.js`; `ALLOWED_ROLES` bijwerken.
- Nieuwe helpers (server + client): `isStaffRole(role)` → admin | employee | supply_chain; `canChooseRemarkVisibility(role)` → admin | supply_chain.
- Plekken die nu `'employee'` / `ROLES.EMPLOYEE` als "staff" gebruiken worden omgezet naar `isStaffRole` (of krijgen `SUPPLY_CHAIN` erbij), o.a.:
  - `server/middleware/auth.js` `requirePagePermission` (employee-tak geldt ook voor supply_chain)
  - `server/routes/data.js` DELETE remark (`requireAnyRole([ADMIN, EMPLOYEE])`)
  - `server/utils/commentPermissions.js` (defaults, backfill, `applyRoleChangePermissions`)
  - `server/services/TrackChangesService.js:19`, `RowActivityService.js:142`
  - frontend: `useCommentPermissions`, `useTrackChanges`, `useRouteAnalytics`, `PurchaseOrdersPage(.TopBar)`, `KpiFormulaFold`, `AdminTrackChangesSettings`, `UserSecurityActions`, `settingsAudience`, `userAccessSummary`, `EditPermissionsDialog`
  - overige `ROLES.EMPLOYEE`-checks in `dataAccess`, `rccpAccess`, routes `bi/data/media/rccp`, `supplierScope` nalopen.

### Opmerkingen

- Kolom `dbo.tb_row_remarks.visibility NVARCHAR(16) NOT NULL` met `CHECK (visibility IN ('vendor','internal'))`.
- Index `IX_tb_row_remarks_row` uitbreiden of aanvullen zodat de filter op `visibility` geen scan veroorzaakt.

## Regels

### Schrijven (server bepaalt, nooit de client)

| Auteur | `visibility` |
|---|---|
| Vendor | altijd `vendor` — meegestuurde waarde wordt genegeerd |
| Employee | altijd `internal` — meegestuurde waarde wordt genegeerd |
| Supply Chain / Admin | **verplicht** `vendor` of `internal`; ontbreekt/ongeldig → 400 `Choose who can see this remark` |

### Lezen — één centraal filter

`remarkVisibilityFilter(actor)` (nieuw, in `RowRemarksService` of eigen util) levert het SQL-predicaat:

| Lezer | Predicaat |
|---|---|
| Vendor | `visibility = 'vendor'` (bovenop de bestaande rij-scoping op `vendor_account`) |
| Employee | `visibility = 'internal'` |
| Supply Chain / Admin | geen |

Toepassen op **alle** leespaden:
- `listRemarks` (incl. tombstones van verwijderde opmerkingen)
- `summarizeRemarks` (badge-tellingen, "laatste opmerking"-kolom)
- `RowRemarksSearchService` (search + `has-comment`)
- `RowActivityService` ("All"-feed)
- `setReaction` en `deleteRemark`: opmerking buiten het filter → **404** (niet 403, om bestaan niet te lekken)

### DTO

`RowRemarksMapper` voegt `visibility` toe aan het remark-DTO, **alleen** als de lezer Supply Chain of Admin is (anders weggelaten). Ook `author.role`-afgeleide vlag `fromVendor: true` voor Supply Chain/Admin, voor de *Vendor*-badge.

## UI (alle teksten Engels)

### Composer (`RemarkComposer.jsx`)

**Supply Chain / Admin:**
- Boven het tekstvak het label "Who can see this remark?" met een Fluent `RadioGroup`, weergegeven als twee grote kaarten:
  - 👁 **For vendor** — "Visible to vendor {vendor_account} and staff with full access"
  - 🔒 **Internal** — "Staff only — vendor cannot see this"
- **Geen voorselectie.** Submit is uitgeschakeld tot er gekozen is; hint: "Choose who can see this remark".
- Knoptekst volgt keuze: **Send to vendor** / **Post internal note**.
- Tekstvak-rand kleurt mee (neutraal-blauw = vendor, amber = internal; via Fluent tokens, licht + donker thema).
- Na succesvol plaatsen reset de keuze naar leeg.
- `onSubmit(draft, columnId, visibility)` — `useRowRemarks` / API sturen `visibility` mee.

**Employee:** geen keuze; vaste regel onder het tekstvak "🔒 Internal — not visible to vendors"; knop **Post internal note**.

**Vendor:** ongewijzigd.

### Kaart (`RemarkMessageCard.jsx`)

- Alleen voor Supply Chain / Admin: badge 🔒 **Internal** (amber) of 👁 **Shared with vendor**; extra badge **Vendor** als de auteur een vendor is.
- Employees en vendors: geen badges.

### Board

- `RemarksLatestCell`: voor Supply Chain / Admin een klein slot-icoon (met tooltip "Internal remark") als de laatste opmerking intern is.

### User Management

- `CreateUserDialog`, `EditRoleDialog`: optie **Supply Chain** — "Employee access + can post remarks for the vendor or internal only".
- `UsersTableRow`: rolbadge "Supply Chain".
- `EditPermissionsDialog` / `PermissionsChecklist`: Supply Chain gedraagt zich als Employee.

## Migratie (idempotent)

1. Rol-constraint uitbreiden.
2. `visibility` kolom toevoegen indien niet aanwezig, tijdelijk nullable.
3. Backfill op basis van huidige rol auteur:
   - `supplier` → `vendor`
   - `admin` → `vendor` (vendor heeft ze al gezien)
   - `employee` → `internal`
   - `created_by IS NULL` of onbekende auteur → `vendor` (huidig gedrag)
4. Kolom `NOT NULL` + default-loze CHECK-constraint; index bijwerken.

Gevolg (bewust): oude employee-opmerkingen verdwijnen voor vendors; oude vendor-opmerkingen verdwijnen voor employees.

## Tests

**Server**
- `RowRemarksService`: matrix 4 lezer-rollen × 2 visibility-waarden voor list, summary, tombstones.
- Schrijfregels: vendor/employee kunnen `visibility` niet overschrijven; Supply Chain/Admin zonder keuze → 400.
- Reaction/delete op onzichtbare opmerking → 404.
- `RowRemarksSearchService`, `RowActivityService`: filter toegepast.
- Rollen: `admin.user-role`, `authorization-matrix`, `requirePagePermission`, `commentPermissions` met `supply_chain`.
- Mapper: `visibility` alleen in DTO voor Supply Chain/Admin.

**Frontend**
- `RemarkComposer`: keuze zichtbaar alleen voor Supply Chain/Admin; submit disabled zonder keuze; knoptekst; reset na plaatsen; employee-hint.
- `RemarkMessageCard`: badges per rol.
- `EditRoleDialog` / `CreateUserDialog`: Supply Chain-optie.

**Performance:** visibility-filter valt binnen bestaande `time()`-gewrapte queries; controleren dat `tb_read_*` / remarks-queries niet trager worden (index).

## Buiten scope

- Achteraf wijzigen van de zichtbaarheid van een geplaatste opmerking.
- Notificaties/e-mails over opmerkingen (indien aanwezig: wél het visibility-filter respecteren — te verifiëren tijdens plan).
