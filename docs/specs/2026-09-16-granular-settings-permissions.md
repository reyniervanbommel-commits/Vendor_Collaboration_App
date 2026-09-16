# Granulaire instellingen-permissies voor employees

## BRD

**Als** admin
**wil ik** een employee toegang kunnen geven tot losse Instellingen-onderdelen (bijv. alleen OData, of alleen Analytics)
**zodat** ik werk kan delegeren zonder de employee volledige admin-rechten te geven.

**Probleem nu:** de permissie-catalogus in [`src/constants/pagePermissions.js`](../../src/constants/pagePermissions.js) kent maar 2 waarden: `purchase-orders` en `admin`. De 8 losse Instellingen-onderdelen (`general`, `users`, `analytics`, `mail-template`, `odata`, `datamodel`, `external-links`, `track-changes`, `d365-refresh` — gedefinieerd in [`src/utils/settingsAudience.js`](../../src/utils/settingsAudience.js)) zijn alleen rol-gated (`admin`/`employee`/`ALL`), niet per-user. De permissiedialoog ([`EditPermissionsDialog.jsx`](../../src/components/admin/EditPermissionsDialog.jsx)) slaat permissies wél op in `dbo.user_permissions`, maar **niets in de app leest die tabel om toegang daadwerkelijk af te dwingen** — het is vandaag dode data.

**Rollen (ongewijzigd):** `admin` (ziet/mag alles, [`server/middleware/auth.js`](../../server/middleware/auth.js) laat admin altijd door), `employee` (krijgt na deze feature granulaire toegang per onderdeel), `supplier` (ongewijzigd, alleen `purchase-orders`, geen Instellingen-tabs). Geen nieuwe rol.

**Succes (toetsbaar):**
- Een employee zonder `odata`-permissie krijgt `403` op de OData-instellingenroutes en ziet de tab niet in de Instellingen-sidebar.
- Een employee met de `users`-permissie kan de gebruikerslijst zien en een supplier aanmaken, maar krijgt `403` bij het wijzigen van een rol, verwijderen van een user, force-reset, of het wijzigen van permissies (ook van zichzelf).
- Een supplier ziet geen instellingen-permissie-checkboxen in `EditPermissionsDialog`.
- Bestaande employees behouden na de migratie hun huidige toegang tot Analytics en External links, zonder handmatige actie van de admin.
- `PUT /api/admin/supplier-filter-column` retourneert `403` voor een niet-admin (bestaande kwetsbaarheid, zie Security-sectie).

**Non-goals:**
- Geen nieuwe rol ("super user") — `admin` dekt dat al.
- `purchase-orders`-permissie wordt niet afgedwongen — bestond al niet, blijft buiten scope.
- `general`-tab krijgt geen eigen permissie — blijft altijd zichtbaar voor staff (huidig gedrag), scheelt een 9e permissie.
- `vendor_account` verplicht maken bij supplier-aanmaak — apart, klein werkitem (zie Security-sectie), niet in deze feature.
- Opsplitsen naar losse DevOps-stories — planningskeuze voor het moment van posten, niet voor dit document.

**Constraints:**
- UI Engels.
- `admin`-only sub-acties op users (rol wijzigen, verwijderen, force-reset, permissies beheren) blijven **altijd** `requireRole(ADMIN)`, nooit via de nieuwe permissie ontsloten — escalatie-risico.
- Idempotente migratie in `scripts/db/migrations/`.
- Permissies niet in de sessie cachen (blijven anders stale tot herlogin) — verse query per check.
- Versienummer in `src/config/version.js` ophogen.

## FRD

**Gekozen aanpak:** de bestaande permissie-catalogus (`PAGE_PERMISSIONS`) uitbreiden van 2 naar 8 losse instellingen-ids, een nieuwe backend-middleware `requirePagePermission(pageName)` toevoegen die naast de bestaande `requireRole` op de betrokken routes komt, en de frontend-sidebar (`getVisibleSettingsSections`) laten filteren op basis van de permissies van de ingelogde user (meegegeven via een uitgebreide `GET /api/auth/me`).

**Afgewezen:**
- Los endpoint `GET /api/admin/me/permissions` — afgewezen: extra `apiRequest`-call en een tab die na de eerste render even verschijnt en weer verdwijnt. In plaats daarvan: permissies toevoegen aan de bestaande `GET /api/auth/me`-respons (verse DB-query per call, niet uit de sessie).
- Permissies in de sessie cachen — afgewezen: blijven stale tot herlogin bij een rechtenwijziging door een admin.
- `users`-tab volledig ontsluiten via de nieuwe permissie (inclusief rol/verwijderen/force-reset/permissies-beheer) — afgewezen: reëel escalatiepad (een employee zou zichzelf via `users`-permissie tot admin kunnen promoveren of zichzelf extra permissies kunnen geven). In plaats daarvan: `users`-permissie geeft alleen leesrecht op de lijst + het aanmaken van een supplier-account; de admin-only sub-acties blijven hard `requireRole(ADMIN)`.

### Regel voor tab-zichtbaarheid

Elk item in `SETTINGS_NAV_SECTIONS` krijgt een `grantable: true/false`-vlag.
- `admin` → altijd alles.
- `employee` → tab zichtbaar als (`tab.roles` bevat `EMPLOYEE` **en** `tab.grantable === true` **en** de user-permissies bevatten `tab.id`) **of** (`tab.grantable === false` **en** `tab.roles` bevat `EMPLOYEE`, huidig gedrag — alleen `general`).
- `supplier` → ongewijzigd, geen Instellingen-tabs.

### Route-mapping: tab → router → routes → huidige guard → nieuwe guard

| Tab (permissie-id) | Router | Routes | Huidige guard | Nieuwe guard |
|---|---|---|---|---|
| `general` (niet-grantable, altijd aan voor staff) | `admin.js` | zoom/general settings | open voor staff | ongewijzigd |
| `users` (leesrecht + supplier aanmaken) | `admin.js` | `GET /users` | `requireRole(ADMIN)` | `requirePagePermission('users')` |
| `users` | `admin.js` | `POST /users` | `requireRole(ADMIN)` | `requirePagePermission('users')` **alleen** als de nieuwe user-rol `supplier` is; anders blijft `requireRole(ADMIN)` |
| `users` (admin-only, blijft ongewijzigd) | `admin.js` | `PATCH /users/:id` (rol-wijziging), `DELETE /users/:id`, `POST /users/:id/force-reset` | `requireRole(ADMIN)` | **ongewijzigd**, nooit via permissie ontsloten |
| `users` (admin-only, blijft ongewijzigd) | `admin.js` | `GET/PATCH /users/:id/permissions` | `requireRole(ADMIN)` | **ongewijzigd** — een employee mag nooit permissies uitdelen, ook niet aan zichzelf |
| — (geen permissie, altijd open) | `admin.js` | `POST /analytics/log-route` (regel 192) | open (alle rollen, tracking) | **ongewijzigd** — geen instellingen-view, expliciet uitgesloten van gating |
| `analytics` | `admin.js` | `GET /analytics/page-usage` (207), `/analytics/sessions` (224), `/analytics/login-stats` (243), `/analytics/user-login-stats` (260), `/analytics/click-stats` (277), `/analytics/onboarding` (295) | geen eigen guard, staff-breed open via mount | `requirePagePermission('analytics')` op elke route |
| `mail-template` | `admin.js` | `GET/PATCH /settings/password-reset-email-template` (367, 376) | `requireRole(ADMIN)` | `requirePagePermission('mail-template')` |
| `odata` | `admin.js` | `GET/POST /settings/odata` (311, 341) | `requireRole(ADMIN)` | `requirePagePermission('odata')` |
| `datamodel` | `data.js` | `GET /:tableKey/datamodel` (493), `POST /discover-fields` (503), `PUT /sync-filters` (512), `POST /sync-filters/count` (521), `GET/POST /:tableKey/board-columns` (276, 285, alleen PAV-tabel) | `requireRole(ADMIN)` | `requirePagePermission('datamodel')` |
| `external-links` | `dataLinks.js` | `GET /main-tables`, `/datasets`; `POST /datasets`, `/validate`, `/publish`; `DELETE /datasets/:tableKey`; `GET /links`; `DELETE /links/:id` | geen eigen guard, alleen mount-niveau `requireAnyRole([ADMIN, EMPLOYEE])` | `requirePagePermission('external-links')` per route |
| `track-changes` | `admin.js` | `GET/POST /settings/track-changes` (396, 405) | `requireRole(ADMIN)` | `requirePagePermission('track-changes')` |
| `d365-refresh` | `admin.js` | `GET/PUT /d365-refresh/alert-emails` (476, 485), `GET/DELETE /d365-refresh/runs` (499, 508) | `requireRole(ADMIN)` | `requirePagePermission('d365-refresh')` |
| `d365-refresh` | `data.js` | `POST /:tableKey/refresh` (222), `/refresh/start` (235), `GET /refresh/progress` (246) | `requireRole(ADMIN)` | `requirePagePermission('d365-refresh')` |
| (buiten permissie-systeem, quick-fix) | `admin.js` | `PUT /supplier-filter-column` (435) | **geen guard** (kwetsbaarheid) | `requireRole(ROLES.ADMIN)` |
| (buiten scope, geen tab in `SETTINGS_NAV_SECTIONS`) | `admin.js` | `GET/PUT /rccp/settings` (449, 458) | `requireRole(ADMIN)` | ongewijzigd — geen bijbehorende Instellingen-tab, dus geen permissie-id; expliciet buiten scope |

**Rijdata-check:** sommige routes hierboven raken configuratie die indirect rijdata beïnvloedt (bv. `sync-filters/count` doet een live D365-telling). Dit blijft tabel-configuratie, geen supplier-rijdata — `requirePagePermission` is hier voldoende, geen extra rij-scope-check nodig.

### Happy path
1. Admin opent Users, klikt "Permissions" bij een employee, ziet 8 checkboxen gegroepeerd per sectie (App/People/Data — analoog aan de sidebar), vinkt bv. `odata` aan.
2. Employee logt in of herlaadt; `GET /api/auth/me` geeft de verse permissies mee; de sidebar toont nu ook de OData-tab.
3. Employee opent OData-instellingen, backend accepteert via `requirePagePermission('odata')`.
4. Employee zonder `users`-permissie ziet de Users-tab niet en krijgt `403` bij een directe API-call.

### Rollen
`admin` ongewijzigd. `employee` per-tab afhankelijk van permissie (zie tabel). `supplier` ongewijzigd, bereikt geen van deze routes/tabs.

### Fout
- Employee met `users`-permissie probeert via een directe API-call zichzelf tot admin te promoveren (`PATCH /users/:id` met `role: 'admin'`) → `403`, want die route blijft `requireRole(ADMIN)` ongeacht permissies.
- Employee zonder een specifieke permissie navigeert direct naar de bijbehorende API-route → `403` via `requirePagePermission`.
- Supplier bereikt per ongeluk een instellingenroute → `403`, ongewijzigd gedrag (rol-check gaat al vooraf).

### UI
- `EditPermissionsDialog.jsx`: instellingen-checkboxen alleen tonen bij `user.role === ROLES.EMPLOYEE` (bij een supplier zijn ze zinloos). Groeperen per sectie (App/People/Data).
- `settingsAudience.js` `formatAudience`/labels: een `grantable`-tab toont het label `"Admin, Employee (with permission)"` (letterlijke string) i.p.v. alleen `"Admin"`, zodat het label niet misleidend is. Een niet-`grantable`-tab (`general`) behoudt zijn huidige label ongewijzigd.
- `AdminSettingsSidebar.jsx`: renderen puur op `getVisibleSettingsSections`-output — controleren of dat al zo is (waarschijnlijk geen wijziging nodig).

### Migratie (voorkomt regressie)
`scripts/db/migrations/050_settings_page_permissions.sql` (laatste bestaande migratie is `049_tb_columns_vendor_editable.sql`), idempotent:
- Elke bestaande `employee`-user krijgt rijen in `dbo.user_permissions` voor `analytics` en `external-links` (hun huidige `STAFF`-rechten via `settingsAudience.js` — zonder migratie verliezen ze toegang die ze nu al hebben).
- Bestaande `page_name = 'admin'`-rijen opschonen (verwijderen) — geen automatische 1-op-1 vertaling naar de 8 nieuwe permissies; de admin wijst desgewenst bewust opnieuw toe.

## TD

### Hergebruik (concrete paden)
| Wat | Pad |
|---|---|
| Permissie-catalogus | [`src/constants/pagePermissions.js`](../../src/constants/pagePermissions.js) |
| Sidebar-zichtbaarheid | [`src/utils/settingsAudience.js`](../../src/utils/settingsAudience.js) — `getVisibleSettingsSections`, `SETTINGS_NAV_SECTIONS` |
| Admin-pagina wiring | [`src/components/admin/AdminPage.jsx`](../../src/components/admin/AdminPage.jsx) |
| Permissiedialoog (UI) | [`src/components/admin/EditPermissionsDialog.jsx`](../../src/components/admin/EditPermissionsDialog.jsx) |
| Rol/permissie-middleware | [`server/middleware/auth.js`](../../server/middleware/auth.js) — nieuwe `requirePagePermission` naast bestaande `requireRole`/`requireAnyRole` |
| Permissie-opslag (bestaat al) | `dbo.user_permissions`, gelezen/geschreven via [`server/routes/admin.js`](../../server/routes/admin.js) regel 154-190 |
| Instellingenroutes (staff) | [`server/routes/admin.js`](../../server/routes/admin.js), [`server/routes/data.js`](../../server/routes/data.js), [`server/routes/dataLinks.js`](../../server/routes/dataLinks.js) |
| Eigen-permissies bij login | [`server/routes/auth.js`](../../server/routes/auth.js) `GET /me` |
| Versie | `src/config/version.js` — PATCH bij implementatie |

### Backend: `requirePagePermission`
Nieuwe module **`server/utils/pagePermissions.js`** (analoog aan `supplierRowAccess.js` naast `dataAccess.js` — losse helper, niet in `auth.js` zelf):
```js
'use strict';
const sql = require('mssql');
const { getSqlPool } = require('./sqlPool');

async function hasPagePermission(userId, pageName) {
  const pool = await getSqlPool();
  const result = await pool.request()
    .input('userId', sql.Int, userId)
    .input('pageName', sql.NVarChar, pageName)
    .query('SELECT TOP (1) 1 AS found FROM dbo.user_permissions WHERE user_id = @userId AND page_name = @pageName');
  return result.recordset.length > 0;
}

module.exports = { hasPagePermission };
```

`server/middleware/auth.js` importeert deze helper en voegt `requirePagePermission` toe naast de bestaande `requireRole`/`requireAnyRole` — **async met `try/catch`**, zodat een DB-fout via `next(err)` de bestaande errorHandler bereikt in plaats van de server te laten crashen:
```js
const { hasPagePermission } = require('../utils/pagePermissions');
const { time } = require('../utils/timing');

function requirePagePermission(pageName) {
  return async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
      if (req.user.role === ROLES.ADMIN) return next();
      if (req.user.role !== ROLES.EMPLOYEE) {
        return res.status(403).json({ error: 'Access denied — insufficient permissions' });
      }
      const has = await time('perm_check', () => hasPagePermission(req.user.id, pageName));
      if (!has) return res.status(403).json({ error: `Access denied — '${pageName}' permission required` });
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
```
Geen sessie-caching — verse query per call (admin-verkeer is laag-volume).

**`POST /users` met rol-afhankelijke guard:** geen losse `if` in de routehandler, maar een eigen kleine wrapper in `server/routes/admin.js` (of `server/middleware/auth.js`), zodat de guard-logica op één plek blijft:
```js
function requireUsersCreateGuard(req, res, next) {
  if (req.body?.role === ROLES.SUPPLIER) return requirePagePermission('users')(req, res, next);
  return requireRole(ROLES.ADMIN)(req, res, next);
}
```

**`GET /supplier-filter-column` blijft bewust ongewijzigd** (geen guard toegevoegd) — het is read-only en onthult alleen welke kolom als scoping-kolom is ingesteld, geen vendor-rijdata. Alleen `PUT` krijgt de `requireRole(ADMIN)`-fix.

### `GET /api/auth/me` uitbreiden
`server/routes/auth.js`: naast `user`/`poTableZoom` een verse `permissions`-array toevoegen (query op `dbo.user_permissions` voor `req.session.userId`), alleen voor `employee` nodig maar simpelweg altijd meegeven (leeg voor andere rollen).

### Frontend
- `PAGE_PERMISSIONS`: 8 items i.p.v. het huidige `admin`-item (zie route-mapping-tabel). `purchase-orders` blijft staan, ongebruikt.
- `SETTINGS_NAV_SECTIONS`: elk item krijgt `grantable: true/false` (`general` → `false`, de overige 8 → `true`).
- `getVisibleSettingsSections(userRole, userPermissions)`: implementeert de zichtbaarheidsregel (zie FRD).
- `AdminPage.jsx`: leest `permissions` uit de auth-context (gevuld via `/auth/me`), geeft door aan `getVisibleSettingsSections`.

### Migratiebestand
`scripts/db/migrations/050_settings_page_permissions.sql` — idempotent, exact patroon (rekening houdend met de `UNIQUE (user_id, page_name)`-constraint in `dbo.user_permissions`, zie `004_user_permissions.sql`):
```sql
-- Migratie 050: bestaande employees behouden hun huidige Analytics/External links-toegang
-- als granulaire permissie; oude 'admin'-permissierijen worden opgeschoond.

INSERT INTO dbo.user_permissions (user_id, page_name)
SELECT u.id, v.page_name
FROM dbo.users u
CROSS JOIN (VALUES ('analytics'), ('external-links')) AS v(page_name)
WHERE u.role = 'employee'
  AND NOT EXISTS (
    SELECT 1 FROM dbo.user_permissions p
    WHERE p.user_id = u.id AND p.page_name = v.page_name
  );

DELETE FROM dbo.user_permissions WHERE page_name = 'admin';
```

### Security-fix (los van permissiesysteem, quick-fix binnen deze wijziging)
`server/routes/admin.js` regel 435, `PUT /supplier-filter-column` heeft geen enkele rol-guard ondanks het commentaar "admin-instelbaar" — elke employee kan vandaag al de supplier-scoping-kolom voor alle vendors wijzigen. Fix: `requireRole(ROLES.ADMIN)` toevoegen aan deze route.

### Volgorde (implementatie)
1. Security-quick-fix: `requireRole(ADMIN)` op `PUT /supplier-filter-column` + test.
2. Migratie schrijven en lokaal draaien (`npm run migrate:db`).
3. `PAGE_PERMISSIONS` + `SETTINGS_NAV_SECTIONS` (`grantable`) bijwerken.
4. `requirePagePermission` middleware + tests in `server/middleware/auth.test.js`.
5. Toepassen op routes conform de route-mapping-tabel (`admin.js`, `data.js`, `dataLinks.js`).
6. `GET /api/auth/me` uitbreiden met `permissions`.
7. Frontend: `getVisibleSettingsSections` + `AdminPage.jsx` + `EditPermissionsDialog.jsx` (rol-conditionele checkboxen, gegroepeerd) + labels in `settingsAudience.js`.
8. Tests: `settingsAudience.test.js` (`grantable`-regel), `server/middleware/auth.test.js` (`requirePagePermission`: admin altijd door, employee met/zonder permissie, overige rollen 403, DB-fout → `next(err)`), en een nieuwe route-test in de stijl van `admin.general-settings.test.js` met **4 losse escalatie-testgevallen** voor een employee met alleen de `users`-permissie:
   - `PATCH /users/:id` met `role: 'admin'` → `403`.
   - `DELETE /users/:id` → `403`.
   - `POST /users/:id/force-reset` → `403`.
   - `PATCH /users/:id/permissions` (ook op het eigen `user.id`) → `403`.

   Plus één test voor `PUT /supplier-filter-column` zonder admin-rol → `403`.
9. Versienummer ophogen.

### Aantoonbaar
- Employee zonder `odata`-permissie: `403` op de OData-route, tab niet zichtbaar in de sidebar.
- Employee met `users`-permissie: ziet userlijst, kan supplier aanmaken; `403` bij rolwijziging/verwijderen/force-reset/permissies-beheer (ook op zichzelf).
- Supplier: geen instellingen-checkboxen in `EditPermissionsDialog`.
- Bestaande employee vóór migratie had Analytics/External links zichtbaar → na migratie + wijziging nog steeds zichtbaar, zonder handmatige actie.
- Niet-admin op `PUT /supplier-filter-column` → `403`.

## Security-aandachtspunten (buiten scope van deze feature, apart vastgelegd)
- `getSupplierAccount()` valt terug op het e-mailprefix als er geen `vendor_account` is ingesteld. Voorgestelde vervolgstap: `vendor_account` verplicht maken bij het aanmaken van een supplier-user (`CreateUserDialog.jsx` + `POST /users`-validatie). Niet in deze feature.
- Vendor-naar-vendor datatoegang (`/api/data`, remarks, RCCP, BI) is los onderzocht en toont consistente defense-in-depth (rij-scope via `assertSupplierPurchaseOrderRow`, filtering in aggregatie-endpoints, geforceerde `vendorAccount` in RCCP/BI) — geen aantoonbare lekken gevonden, geen actie nodig.

## Review (Fase 4, team-review, `.claude/team/`)

Design-niveau review (nog geen code) door de 8 teamleden. Checklists die alleen op geschreven code slaan (regelaantallen, JSX-nesting, useState-tellingen) zijn toegepast op het ontwerp van de nog te bouwen bestanden, niet op bestaande code.

### Dev Lead
**Bestanden gereviewed (ontwerp):** `PAGE_PERMISSIONS`, `settingsAudience.js`, `EditPermissionsDialog.jsx`-uitbreiding.
- ⚠️ `EditPermissionsDialog.jsx` groepeert straks 8 checkboxen per sectie — geen regelbudget-schatting in de TD. Component is vandaag klein (rendert nu 2 checkboxen); met 8 + secties + rol-conditie blijft dit naar verwachting ruim onder 300 regels, maar dat staat niet als expliciete schatting in het document.
- ✅ Geen nieuwe useState-explosie: dit blijft binnen de bestaande hook-structuur van de dialoog.
- ✅ Geen inline-function-risico benoemd dat afwijkt van bestaande patronen.

**Verdict:** VERBETERPUNTEN — voeg een regelschatting toe voor `EditPermissionsDialog.jsx` na de uitbreiding, ter bevestiging dat dit onder 300 blijft.

### React Architect
**Bestanden gereviewed (ontwerp):** `getVisibleSettingsSections`, auth-context-uitbreiding voor `permissions`.
- ✅ Geen JSX in de voorgestelde logica (`getVisibleSettingsSections` blijft een pure functie, `requirePagePermission` is backend).
- ⚠️ Niet vastgelegd wáár `permissions` in de frontend-state landt (AuthContext zelf uitbreiden, of een apart veld in `AdminPage.jsx`-state). Bij twijfel kan dit tot een ad-hoc `useState` in `AdminPage.jsx` leiden i.p.v. een centrale plek in de auth-context, wat op termijn dubbele bronnen van waarheid geeft.
- ✅ Geen sessie-caching van permissies (expliciet vastgelegd) voorkomt een stale-state-val.

**Verdict:** VERBETERPUNTEN — expliciteer dat `permissions` in de bestaande `AuthContext` (naast `user`) landt, niet lokaal in `AdminPage.jsx`, zodat andere componenten die later ook permissies nodig hebben niet opnieuw moeten fetchen.

### Backend Engineer
**Bestanden gereviewed (ontwerp):** `server/utils/pagePermissions.js`, `requirePagePermission`, migratie 050, route-mapping-tabel.
- ✅ Migratie is idempotent (`NOT EXISTS`-guard, rekening gehouden met de `UNIQUE`-constraint).
- ✅ `requirePagePermission` is async met `try/catch` → `next(err)`, consistent met Express-foutafhandelingspatroon.
- ✅ `requireSession` + rol/permissie-middleware blijft het patroon op alle betrokken routes; geen nieuwe auth-vorm.
- ✅ Geen secrets, geen nieuwe env-vars nodig.
- ⚠️ Geen rate-limiting genoemd voor de nieuwe permissie-check-query zelf — niet nodig (het zit achter `requireSession`, geen publieke route), maar had als expliciete "n.v.t." mogen staan naast de bestaande rate-limit-eis op login/forgot-password.

**Verdict:** GOEDGEKEURD — met de kanttekening als kleine documentatie-aanvulling, geen blocker.

### Security Engineer
**Bestanden gereviewed (ontwerp):** volledige route-mapping-tabel, escalatiepad-analyse, `PUT /supplier-filter-column`-fix.
- ✅ Admin-only sub-acties op `users` (rol, delete, force-reset, permissies-beheer) blijven expliciet `requireRole(ADMIN)`, nooit via de nieuwe permissie ontsloten — het kernrisico van de vorige twee reviewrondes is nu dichtgetimmerd met 4 losse testgevallen.
- ✅ Bestaande kwetsbaarheid (`PUT /supplier-filter-column` zonder guard) wordt gefixed binnen deze wijziging, niet uitgesteld.
- ✅ Permissies niet in de sessie gecached — voorkomt dat een ingetrokken permissie pas na herlogin effect heeft.
- ✅ Geen gevoelige data in `localStorage`; permissies komen via de bestaande sessie-gebonden `/auth/me`-call.
- ⚠️ `vendor_account`-fallback op e-mailprefix blijft bestaan (bewust buiten scope, expliciet benoemd) — geen blocker, maar wel een open item dat een aparte follow-up nodig heeft, anders raakt het vergeten.

**Verdict:** GOEDGEKEURD — het document benoemt zijn eigen restrisico's expliciet in plaats van ze te verzwijgen.

### Refactor Specialist
**Bestanden gereviewed (ontwerp):** volledige route-mapping (3 routers), `requirePagePermission`-plaatsing.
- ⚠️ "Shotgun surgery"-signaal: deze wijziging raakt guards in 3 losse routerbestanden (`admin.js`, `data.js`, `dataLinks.js`) plus 2 frontend-bestanden plus een migratie. Dat is meer dan de vuistregel van "10+ bestanden = coupling te hoog" op zichzelf niet overschrijdt, maar het is wel verspreid. Dit is echter inherent aan het probleem (de instellingenroutes zijn al verspreid vóór deze wijziging) en geen resultaat van slecht ontwerp — het document benoemt dit zelf al via de route-mapping-tabel, wat het beheersbaar maakt.
- ✅ `hasPagePermission` als losse module (`server/utils/pagePermissions.js`) i.p.v. inline in `auth.js` — goede scheiding, consistent met het bestaande `supplierRowAccess.js`-patroon naast `dataAccess.js`.
- ✅ Geen cyclische dependency: `pagePermissions.js` → `sqlPool.js`, `auth.js` → `pagePermissions.js`, één richting.
- ✅ Geen stille semantiekwijziging: elke bestaande guard die verandert staat expliciet in de route-mapping-tabel met oude/nieuwe guard naast elkaar.

**Verdict:** GOEDGEKEURD — de verspreiding is inherent aan het probleem, niet aan het ontwerp, en is volledig getabelleerd.

### UI Engineer
**Bestanden gereviewed (ontwerp):** `EditPermissionsDialog.jsx`-uitbreiding.
- ✅ Geen `<Tooltip>` in de geplande checkbox-lijst (blijft `Checkbox` + `Text`-omschrijving, zoals de bestaande 2-item-versie).
- ✅ Alle nieuwe labels Engels (`"Admin, Employee (with permission)"`, checkbox-labels blijven de bestaande `PAGE_PERMISSIONS`-labels, al Engels).
- ✅ Geen nieuwe portal-componenten (Menu/Popover/Dialog) toegevoegd — de dialoog zelf bestaat al.

**Verdict:** GOEDGEKEURD.

### Design Lead
**Bestanden gereviewed (ontwerp):** `EditPermissionsDialog.jsx`-uitbreiding, sectie-groepering.
- ✅ Groepering per sectie (App/People/Data) hergebruikt de bestaande `SETTINGS_NAV_SECTIONS`-structuur — geen nieuw parallel indelingssysteem.
- ✅ Geen nieuwe kleuren/tokens nodig — checkboxen en tekst gebruiken de bestaande `makeStyles`/tokens uit het component.
- ✅ Fouten/status (403) blijven tekst-gebaseerd via de bestaande `MessageBar`-aanpak in de dialoog, niet alleen kleur.

**Verdict:** GOEDGEKEURD.

### Release Manager
**Bestanden gereviewed (ontwerp):** migratie 050, volgorde-sectie, versie-eis.
- ✅ Migratie idempotent, volgnummer correct bepaald tegen de laatste bestaande migratie (`049`).
- ✅ Versienummer-ophoging expliciet in de volgorde-sectie (stap 9) en in de Constraints.
- ✅ Geen aanwijzing voor directe push naar `main`/`develop` — dit blijft, conform de standaardflow van dit project, lokaal bouwen en pas op expliciet verzoek pushen.
- ⚠️ Geen expliciete commit-message-prefix (`feat`/`fix`) benoemd voor de losse security-quick-fix versus de rest van de feature — bij een gesplitste PR-aanpak zou dat helder moeten zijn (bv. `fix:` voor de guard, `feat:` voor de rest).

**Verdict:** GOEDGEKEURD — kleine aanbeveling, geen blocker.

## Van Bommel Team Review — 2026-09-16 (design-fase, vóór DevOps/bouwen)

### Samenvatting per teamlid
| Teamlid | Verdict | Belangrijkste bevinding |
|---------|---------|------------------------|
| Dev Lead | ⚠️ | Geen regelschatting voor `EditPermissionsDialog.jsx` na uitbreiding |
| React Architect | ⚠️ | Niet vastgelegd waar `permissions` in de frontend-state landt (AuthContext vs. lokaal) |
| Backend Engineer | ✅ | Idempotente migratie, async guard met foutafhandeling, geen secrets |
| Security Engineer | ✅ | Escalatiepad dichtgetimmerd, bestaande kwetsbaarheid meegenomen als fix |
| UI Engineer | ✅ | Geen Tooltip-risico, Engelse labels, geen nieuwe portal-componenten |
| Release Manager | ✅ | Idempotente migratie, versie-eis expliciet, geen main-push-risico |
| Refactor Specialist | ✅ | Verspreiding over 3 routers is inherent aan het probleem, volledig getabelleerd |
| Design Lead | ✅ | Hergebruikt bestaande sectie-structuur en tokens, geen parallel systeem |

### BLOCKERs (moet opgelost voor merge)
Geen blockers.

### Verbeterpunten (aanbevolen)
1. Regelschatting toevoegen voor `EditPermissionsDialog.jsx` na de uitbreiding (Dev Lead).
2. Expliciteren dat `permissions` in de bestaande `AuthContext` landt, niet lokaal in `AdminPage.jsx` (React Architect).
3. Commit-message-prefixes benoemen als de security-quick-fix los gecommit wordt van de rest (Release Manager).

### Eindoordeel
🟢 GOEDGEKEURD — klaar voor `post-plan-to-devops` (als een tracker gewenst is) of `develop-from-devops` (lokaal bouwen). Geen blockers; de 3 verbeterpunten zijn klein genoeg om tijdens het bouwen zelf in te vullen.
