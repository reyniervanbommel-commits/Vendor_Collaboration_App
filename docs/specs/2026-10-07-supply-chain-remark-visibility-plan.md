# Supply Chain-rol + zichtbaarheid opmerkingen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nieuwe rol `supply_chain` toevoegen en elke opmerking (`tb_row_remarks`) een opgeslagen zichtbaarheid `vendor` | `internal` geven, server-side afgedwongen op alle lees- en schrijfpaden, met een duidelijke keuze-UI voor Supply Chain/Admin.

**Architecture:** Eén kolom `visibility` op `tb_row_remarks`. Eén server-util `server/utils/remarkVisibility.js` bepaalt (a) welke waarde een auteur schrijft en (b) welk SQL-predicaat een lezer krijgt; alle remark-services gebruiken die. Rol-checks die "staff" bedoelen gebruiken voortaan `STAFF_ROLES` / `isStaffRole` / `hasEmployeeAccess` uit de roles-constants zodat `supply_chain` overal employee-rechten krijgt.

**Tech Stack:** Express + `mssql`, React 18 + Fluent UI v9, Vitest.

**Spec:** `docs/specs/2026-10-07-supply-chain-remark-visibility-design.md`

## Global Constraints

- Alle UI-tekst Engels (`.cursor/rules/app-taal.mdc`).
- Migraties idempotent; `run-migrations.js` draait **alle** bestanden bij elke run.
- Geen commit/push tenzij de gebruiker erom vraagt (`.cursor/rules/otap-local-first.mdc`). De "Commit"-stappen hieronder zijn alleen checkpoints: `git add` + commit **pas na expliciete toestemming**; anders overslaan.
- Rolwaarde: `'supply_chain'`; label `'Supply Chain'`.
- Visibility-waarden: `'vendor'`, `'internal'`.
- Server bepaalt visibility: vendor → `vendor`, employee → `internal`, supply_chain/admin → verplicht expliciet; ontbreekt → 400 `Choose who can see this remark`.
- Leesfilter: supplier → `visibility = 'vendor'`; employee → `visibility = 'internal'`; supply_chain/admin → geen filter.
- Remark buiten het leesfilter → 404 (`Remark not found`) bij delete/reaction.
- Frontend backend-calls via `apiRequest`; zware queries blijven binnen bestaande `time()`-wrappers.

## Review Focus

1. Een **vendor** krijgt via géén enkel endpoint (list, summary-latest, search, has-comment, activity "All", reaction/delete) een interne remark of het bestaan ervan te zien.
2. Een **employee** ziet een vendor-remark ook niet indirect: badge-telling en "latest"-preview in `summarizeRemarks` moeten op het gefilterde set gebaseerd zijn (geen telling van onzichtbare remarks).
3. Een client die `visibility: 'vendor'` meestuurt als **employee** of `'internal'` als **supplier** krijgt de server-waarde, niet de meegestuurde.
4. Supply Chain-gebruiker kan na de migratie inloggen, het board/Settings bereiken en opmerkingen verwijderen zoals een employee (geen 403 door vergeten `ROLES.EMPLOYEE`-lijst).
5. Migratie op een DB die al gemigreerd is (tweede run) faalt niet en overschrijft geen bestaande visibility-waarden.

Elke regel heeft een test in de eigenaar-taak (1→Task 6/7, 2→Task 6, 3→Task 5, 4→Task 2, 5→Task 4).

---

## File structure

| Bestand | Verantwoordelijkheid |
|---|---|
| `server/constants/roles.js`, `src/constants/roles.js` | `SUPPLY_CHAIN`, `STAFF_ROLES`, `isStaffRole`, `hasEmployeeAccess`, `canChooseRemarkVisibility` |
| `scripts/db/migrations/052_role_supply_chain.sql` | Rol-constraint uitbreiden |
| `scripts/db/migrations/053_tb_row_remarks_visibility.sql` | Kolom + backfill + check |
| `server/utils/remarkVisibility.js` (nieuw) | Schrijfregel + leespredicaat |
| `server/services/RowRemarksService.js`, `RowRemarksMapper.js`, `RowRemarksSearchService.js`, `RowActivityService.js` | Filter + DTO |
| `server/routes/data.js` | `visibility` uit body doorgeven |
| `src/components/supplier/remarks/RemarkComposer.jsx`, `RemarkVisibilityPicker.jsx` (nieuw), `RemarkMessageCard.jsx`, `RemarkVisibilityBadge.jsx` (nieuw), `RemarksLatestCell.jsx`, `RowActivityFeed.jsx`, `useRowRemarks.js`, `RemarksPanel.jsx`, `remarks.css` | UI |
| Admin-UI + overige rol-plekken | Supply Chain als rol |

---

### Task 1: Rol-constants + migratie rol-constraint

**Files:**
- Modify: `server/constants/roles.js`, `src/constants/roles.js`
- Create: `scripts/db/migrations/052_role_supply_chain.sql`
- Test: `server/constants/roles.test.js` (nieuw), `src/constants/roles.test.js` (nieuw)

**Interfaces — Produces (server CommonJS én client ESM, zelfde namen):**
- `ROLES.SUPPLY_CHAIN = 'supply_chain'`
- `STAFF_ROLES: readonly ['admin','employee','supply_chain']`
- `isStaffRole(role: string): boolean`
- `hasEmployeeAccess(role: string): boolean` — `employee` of `supply_chain` (granulaire permissies)
- `canChooseRemarkVisibility(role: string): boolean` — `admin` of `supply_chain`
- `ROLE_LABELS` (alleen client): `{ admin:'Admin', employee:'Employee', supply_chain:'Supply Chain', supplier:'Vendor' }`

- [ ] **Step 1: Failing test** `server/constants/roles.test.js`

```js
'use strict';
const { ROLES, ALLOWED_ROLES, STAFF_ROLES, isStaffRole, hasEmployeeAccess, canChooseRemarkVisibility } = require('./roles');

describe('roles', () => {
  it('kent supply_chain als toegestane staff-rol', () => {
    expect(ROLES.SUPPLY_CHAIN).toBe('supply_chain');
    expect(ALLOWED_ROLES).toContain('supply_chain');
    expect(STAFF_ROLES).toEqual(['admin', 'employee', 'supply_chain']);
  });
  it('isStaffRole', () => {
    expect(['admin', 'employee', 'supply_chain'].map(isStaffRole)).toEqual([true, true, true]);
    expect(isStaffRole('supplier')).toBe(false);
    expect(isStaffRole(undefined)).toBe(false);
  });
  it('hasEmployeeAccess geldt voor employee en supply_chain', () => {
    expect(hasEmployeeAccess('employee')).toBe(true);
    expect(hasEmployeeAccess('supply_chain')).toBe(true);
    expect(hasEmployeeAccess('admin')).toBe(false);
    expect(hasEmployeeAccess('supplier')).toBe(false);
  });
  it('canChooseRemarkVisibility alleen admin en supply_chain', () => {
    expect(canChooseRemarkVisibility('admin')).toBe(true);
    expect(canChooseRemarkVisibility('supply_chain')).toBe(true);
    expect(canChooseRemarkVisibility('employee')).toBe(false);
    expect(canChooseRemarkVisibility('supplier')).toBe(false);
  });
});
```

`src/constants/roles.test.js`: zelfde cases met `import { ... } from './roles'` plus `expect(ROLE_LABELS.supply_chain).toBe('Supply Chain')`.

- [ ] **Step 2:** `npx vitest run server/constants/roles.test.js src/constants/roles.test.js` → FAIL.

- [ ] **Step 3: Implementatie** `server/constants/roles.js`

```js
'use strict';

const ROLES = Object.freeze({
  ADMIN: 'admin',
  EMPLOYEE: 'employee',
  SUPPLY_CHAIN: 'supply_chain',
  SUPPLIER: 'supplier',
});

const ALLOWED_ROLES = Object.freeze(Object.values(ROLES));
// Supply Chain heeft employee-rechten plus de keuze voor remark-zichtbaarheid.
const STAFF_ROLES = Object.freeze([ROLES.ADMIN, ROLES.EMPLOYEE, ROLES.SUPPLY_CHAIN]);

function isAllowedRole(role) {
  return ALLOWED_ROLES.includes(role);
}

function isStaffRole(role) {
  return STAFF_ROLES.includes(role);
}

function hasEmployeeAccess(role) {
  return role === ROLES.EMPLOYEE || role === ROLES.SUPPLY_CHAIN;
}

function canChooseRemarkVisibility(role) {
  return role === ROLES.ADMIN || role === ROLES.SUPPLY_CHAIN;
}

module.exports = {
  ROLES, ALLOWED_ROLES, STAFF_ROLES,
  isAllowedRole, isStaffRole, hasEmployeeAccess, canChooseRemarkVisibility,
};
```

`src/constants/roles.js`: dezelfde `ROLES`, `STAFF_ROLES` en drie functies als named ESM-exports, plus:

```js
export const ROLE_LABELS = Object.freeze({
  [ROLES.ADMIN]: 'Admin',
  [ROLES.EMPLOYEE]: 'Employee',
  [ROLES.SUPPLY_CHAIN]: 'Supply Chain',
  [ROLES.SUPPLIER]: 'Vendor',
});
```

- [ ] **Step 4: Migratie** `scripts/db/migrations/052_role_supply_chain.sql`

```sql
-- Migratie 052: rol supply_chain toestaan. Idempotent: constraint alleen vervangen als
-- de huidige definitie supply_chain nog niet bevat.
IF EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = 'CK_users_role_allowed' AND parent_object_id = OBJECT_ID('dbo.users')
    AND definition NOT LIKE '%supply_chain%'
)
BEGIN
  ALTER TABLE dbo.users DROP CONSTRAINT CK_users_role_allowed;
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = 'CK_users_role_allowed' AND parent_object_id = OBJECT_ID('dbo.users')
)
BEGIN
  ALTER TABLE dbo.users ADD CONSTRAINT CK_users_role_allowed
    CHECK (role IN ('admin', 'employee', 'supply_chain', 'supplier'));
END;

-- Supply Chain krijgt dezelfde default comment-rechten als employee (zie migratie 051).
INSERT INTO dbo.user_permissions (user_id, page_name)
SELECT u.id, v.page_name
FROM dbo.users u
CROSS JOIN (VALUES ('comments.view'), ('comments.write'), ('comments.column')) AS v(page_name)
WHERE u.role = 'supply_chain'
  AND NOT EXISTS (
    SELECT 1 FROM dbo.user_permissions p WHERE p.user_id = u.id AND p.page_name = v.page_name
  );
```

- [ ] **Step 5:** Tests opnieuw → PASS. `npm run migrate:db` lokaal twee keer → beide keren "Alle migraties voltooid".
- [ ] **Step 6: Checkpoint** (commit alleen met toestemming): `feat: add supply_chain role constants and migration`

---

### Task 2: Server — Supply Chain krijgt employee-toegang

**Files (Modify):**
- `server/middleware/auth.js:43` — `requirePagePermission`
- `server/middleware/dataAccess.js:56`
- `server/server.js:156,157,165,167,168`
- `server/routes/data.js:127`, `server/routes/media.js:62`
- `server/utils/supplierScope.js:18`
- `server/services/TableDataService.js:5277`
- `server/utils/runtimeHeaderLinks.js:113-121`
- `server/utils/commentPermissions.js:49-65,107-120`
- `server/services/TrackChangesService.js:19`
- `server/services/RowRemarksService.js:42-51`, `server/services/RowRemarksSearchService.js:34-43`
- `server/routes/admin.js`: `grantsCommentPermissionsByDefault`-gebruik en rolvalidatie (regels 41-42, 70, 103-112, 132, 203 — nalopen: overal waar `EMPLOYEE` als "staff" gecheckt wordt `hasEmployeeAccess`/`isStaffRole` gebruiken)
- Test: `server/middleware/requirePagePermission.test.js`, `server/utils/commentPermissions.test.js`, `server/routes/admin.user-role.test.js`, `server/routes/admin.authorization-matrix.test.js`

**Interfaces — Consumes:** Task 1 helpers. **Produces:** `normalizeActor` in beide remark-services retourneert `{ id, role, isAdmin, isSupplier }` en accepteert `supply_chain`.

- [ ] **Step 1: Failing tests** — voeg toe:

`server/middleware/requirePagePermission.test.js` (volg bestaande mock-stijl van dat bestand):
```js
it('supply_chain met permissie mag door, zonder permissie 403', async () => {
  pagePermissions.hasPagePermission.mockResolvedValueOnce(true);
  const next = vi.fn();
  await requirePagePermission('users')({ user: { id: 5, role: 'supply_chain' } }, mockRes(), next);
  expect(next).toHaveBeenCalledWith();

  pagePermissions.hasPagePermission.mockResolvedValueOnce(false);
  const res = mockRes();
  await requirePagePermission('users')({ user: { id: 5, role: 'supply_chain' } }, res, vi.fn());
  expect(res.status).toHaveBeenCalledWith(403);
});
```

`server/utils/commentPermissions.test.js`:
```js
it('supply_chain gedraagt zich als employee', () => {
  expect(grantsCommentPermissionsByDefault('supply_chain')).toBe(true);
  expect(classifyPermissionPatch('supply_chain', ['users', 'comments.view'])).toEqual({ ok: true, pageNames: ['users', 'comments.view'] });
});
it('applyRoleChangePermissions(supply_chain) vult comment-rechten aan zonder iets te wissen', async () => {
  const queries = [];
  const pool = { request: () => ({ input() { return this; }, query: async (q) => { queries.push(q); return {}; } }) };
  await applyRoleChangePermissions(pool, 3, 'supply_chain');
  expect(queries).toHaveLength(1);
  expect(queries[0]).toContain('INSERT INTO dbo.user_permissions');
});
```

`server/routes/admin.authorization-matrix.test.js`: voeg `supply_chain` toe aan de rollen-matrix met dezelfde verwachtingen als `employee`.
`server/routes/admin.user-role.test.js`: rolwissel naar `supply_chain` → 200 en `role: 'supply_chain'`.

- [ ] **Step 2:** `npx vitest run server/middleware server/utils/commentPermissions.test.js server/routes/admin` → FAIL.

- [ ] **Step 3: Implementatie**

`auth.js` `requirePagePermission`:
```js
const { ROLES, hasEmployeeAccess } = require('../constants/roles');
// ...
if (!hasEmployeeAccess(req.user.role)) {
  return res.status(403).json({ error: 'Access denied — insufficient permissions' });
}
```

`dataAccess.js:56`: `if (isStaffRole(role)) return next();`
`supplierScope.js:18`: `return isStaffRole(user?.role);`
`TableDataService.js:5277`: `const isStaffUser = isStaffRole(role);`
`server.js`:
```js
app.use('/api/admin', requireSession, requireAnyRole(STAFF_ROLES), adminRouter);
app.use('/api/supplier', requireSession, requireAnyRole([ROLES.SUPPLIER, ROLES.EMPLOYEE, ROLES.SUPPLY_CHAIN, 'user']), supplierRouter);
app.use('/api/bi', requireSession, requireAnyRole([...STAFF_ROLES, ROLES.SUPPLIER]), biRouter);
app.use('/api/data-links', requireSession, requireAnyRole(STAFF_ROLES), dataLinksRouter);
app.use('/api/rccp', requireSession, requireAnyRole([...STAFF_ROLES, ROLES.SUPPLIER]), rccpAccess, rccpRouter);
```
`data.js:127`: `requireAnyRole(STAFF_ROLES)`. `media.js:62`: `requireAnyRoleFn(STAFF_ROLES)`.

`runtimeHeaderLinks.js`: vervang de twee role-inputs door een `IN`-lijst van de drie staff-rollen:
```js
.input('adminRole', sql.NVarChar(32), ROLES.ADMIN)
.input('employeeRole', sql.NVarChar(32), ROLES.EMPLOYEE)
.input('supplyChainRole', sql.NVarChar(32), ROLES.SUPPLY_CHAIN)
// ...
AND LOWER(LTRIM(RTRIM(u.role))) IN (LOWER(@adminRole), LOWER(@employeeRole), LOWER(@supplyChainRole))
```

`commentPermissions.js`:
```js
const { ROLES, isAllowedRole, hasEmployeeAccess } = require('../constants/roles');
// classifyPermissionPatch: vervang de laatste rolcheck door
if (!isAllowedRole(role)) return { ok: false, error: 'Invalid role' };
// grantsCommentPermissionsByDefault:
return hasEmployeeAccess(role) || role === ROLES.SUPPLIER;
// applyRoleChangePermissions laatste tak:
if (hasEmployeeAccess(newRole)) {
  await ensureCommentPermissions(pool, userId);
}
```
(Commentaar regel 37: "Employee/Supply Chain: instellingen + comments".)

`TrackChangesService.js:19`: `const DEFAULT_SESSION_ROLES = Object.freeze(['admin', 'employee', 'supply_chain']);`

`RowRemarksService.js` en `RowRemarksSearchService.js` `normalizeActor`:
```js
if (!isStaffRole(actor?.role)) {
  throw httpError(403, 'Insufficient permissions');
}
return { id, role: actor.role, isAdmin: actor.role === ROLES.ADMIN, isSupplier: false };
```

- [ ] **Step 4:** Tests → PASS. Daarna `npx vitest run server` → geen nieuwe failures.
- [ ] **Step 5:** `grep -rn "ROLES.EMPLOYEE\|'employee'" server --include=*.js | grep -v test` — elke resterende treffer bewust beoordelen (alleen constants, seeds en `hasEmployeeAccess` mogen overblijven).
- [ ] **Step 6: Checkpoint:** `feat: give supply_chain employee access on the server`

---

### Task 3: Client — Supply Chain in User Management en rol-checks

**Files (Modify):**
- `src/components/admin/CreateUserDialog.jsx:94-96`, `EditRoleDialog.jsx:23-25,69`, `UsersTableRow.jsx:51`, `EditPermissionsDialog.jsx:91`, `AdminTrackChangesSettings.jsx:49-51,66`, `UserSecurityActions.jsx:18`
- `src/hooks/useUsersManagement.js:38`, `useCommentPermissions.js:17`, `useRouteAnalytics.js:6`, `useTrackChanges.js:22`
- `src/utils/settingsAudience.js:4-12,80`, `src/utils/userAccessSummary.js`
- `src/components/supplier/PurchaseOrdersPage.jsx:62`, `PurchaseOrdersPageContent.jsx:62`, `PurchaseOrdersPageTopBar.jsx:84`
- `src/components/rccp/KpiFormulaFold.jsx:141`, `src/components/onboarding/tourSelectors.js:3`, `src/components/layout/KeepAliveDataPages.jsx:29-30`, `src/App.jsx:95`
- Test: `src/components/admin/EditRoleDialog.test.jsx`, `src/components/admin/EditPermissionsDialog.test.jsx`, `src/utils/settingsAudience.test.js` (bestaand of nieuw)

**Interfaces — Consumes:** client-helpers uit Task 1.

- [ ] **Step 1: Failing tests**

`EditRoleDialog.test.jsx`:
```jsx
it('biedt Supply Chain als rol aan', () => {
  render(<EditRoleDialog user={{ id: 1, role: 'employee' }} open onOpenChange={() => {}} onSave={vi.fn()} />);
  expect(screen.getByRole('option', { name: /Supply Chain/ })).toBeInTheDocument();
});
it('waarschuwt niet over permissieverlies bij employee → supply_chain', async () => {
  render(<EditRoleDialog user={{ id: 1, role: 'employee' }} open onOpenChange={() => {}} onSave={vi.fn()} />);
  await userEvent.selectOptions(screen.getByRole('combobox'), 'supply_chain');
  expect(screen.queryByText(/permissions/i)).not.toBeInTheDocument();
});
```
(Pas de selector aan de bestaande test-opzet van het bestand aan als die anders rendert.)

`settingsAudience.test.js`:
```js
import { canAccessSettingsTab, SETTINGS_AUDIENCE } from './settingsAudience';
it('supply_chain ziet grantable tab met permissie', () => {
  expect(canAccessSettingsTab({ id: 'users', roles: SETTINGS_AUDIENCE.ADMIN, grantable: true }, 'supply_chain', ['users'])).toBe(true);
  expect(canAccessSettingsTab({ id: 'users', roles: SETTINGS_AUDIENCE.ADMIN, grantable: true }, 'supply_chain', [])).toBe(false);
});
it('supply_chain zit in STAFF', () => {
  expect(SETTINGS_AUDIENCE.STAFF).toContain('supply_chain');
});
```

`EditPermissionsDialog.test.jsx`: render met `user.role = 'supply_chain'` → de instellingen-checklist is zichtbaar (zelfde assertie als bestaande employee-test).

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3: Implementatie**

`EditRoleDialog.jsx`:
```js
const ROLE_OPTIONS = [
  { value: ROLES.ADMIN, label: 'Admin — full access to every setting' },
  { value: ROLES.EMPLOYEE, label: 'Employee — access per granted settings permission' },
  { value: ROLES.SUPPLY_CHAIN, label: 'Supply Chain — employee access + can post remarks for the vendor or internal only' },
  { value: ROLES.SUPPLIER, label: 'Vendor — only the purchase orders of their own vendor account' },
];
// regel 69:
const losesPermissions = hasEmployeeAccess(user?.role) && !hasEmployeeAccess(role);
```
`CreateUserDialog.jsx`: na de Employee-optie `{allowStaffRoles && <option value={ROLES.SUPPLY_CHAIN}>Supply Chain</option>}`.
`UsersTableRow.jsx:51`: `<Badge ...>{ROLE_LABELS[user.role] || user.role}</Badge>`.
`EditPermissionsDialog.jsx:91`: `const isEmployee = hasEmployeeAccess(user.role);`
`useUsersManagement.js:38`: `.filter((user) => hasEmployeeAccess(user.role))`.
`settingsAudience.js`: `ALL: [ADMIN, EMPLOYEE, SUPPLY_CHAIN, SUPPLIER]`, `STAFF: STAFF_ROLES`, `ROLE_LABELS` hergebruiken uit `constants/roles` (her-exporteren), regel 80 `if (!hasEmployeeAccess(userRole)) return false;`.
`userAccessSummary.js`: supply_chain valt in de employee-tak (gebruik `hasEmployeeAccess`).
`useCommentPermissions.js:17`: `const isAdmin = role === ROLES.ADMIN;` (alleen constant, gedrag ongewijzigd).
`useRouteAnalytics.js:6`: `const ANALYTICS_ROLES = new Set(STAFF_ROLES);`
`useTrackChanges.js:22`: `sessionRoles: ['admin', 'employee', 'supply_chain']`.
`AdminTrackChangesSettings.jsx`: optie `{ value: 'supply_chain', label: 'Supply Chain' }` toevoegen; default-state `['admin','employee','supply_chain']`.
`PurchaseOrdersPage.jsx:62`, `PurchaseOrdersPageContent.jsx:62`, `PurchaseOrdersPageTopBar.jsx:84`, `KpiFormulaFold.jsx:141`: `isStaffRole(user?.role)` (resp. `isStaffRole(userRole)`).
`tourSelectors.js:3`: `export const STAFF = STAFF_ROLES;`
`KeepAliveDataPages.jsx:29-30`, `App.jsx:95`: `[...STAFF_ROLES, ROLES.SUPPLIER]`.
`UserSecurityActions.jsx:18`: bekijk de check; als het "staff" betekent → `isStaffRole`.

- [ ] **Step 4:** Tests → PASS; `npx vitest run src` geen nieuwe failures; `npm run lint`.
- [ ] **Step 5:** `grep -rn "ROLES.EMPLOYEE\|'employee'" src | grep -v test` — resterende treffers beoordelen.
- [ ] **Step 6: Checkpoint:** `feat: supply chain role in user management`

---

### Task 4: Migratie — `visibility` op `tb_row_remarks`

**Files:**
- Create: `scripts/db/migrations/053_tb_row_remarks_visibility.sql`

**Interfaces — Produces:** kolom `dbo.tb_row_remarks.visibility NVARCHAR(16) NOT NULL`, check `CK_tb_row_remarks_visibility`.

Indexnoot: alle remark-queries seeken op `IX_tb_row_remarks_row` (table_id[, partition_key, record_key]); `visibility` wordt een residual predicate op de gezochte rijen — geen extra index nodig. Controleer in Task 11 met Server-Timing.

- [ ] **Step 1: Migratie**

`run-migrations.js` voert het hele bestand als één batch uit (`pool.request().batch`) en kent geen `GO`. Statements die de nieuwe kolom gebruiken gaan daarom in `EXEC(N'...')` (zelfde patroon als `022_tb_cache_sync_retained.sql`), anders faalt de compile op een DB waar de kolom nog niet bestaat.

```sql
-- Migratie 053: zichtbaarheid per remark ('vendor' | 'internal').
-- Idempotent; draait bij elke migrate-run. Backfill raakt alleen NULL-rijen.
IF COL_LENGTH('dbo.tb_row_remarks', 'visibility') IS NULL
BEGIN
  ALTER TABLE dbo.tb_row_remarks ADD visibility NVARCHAR(16) NULL;
END;

-- Backfill op huidige rol van de auteur: employee → internal; supplier/admin/onbekend → vendor.
EXEC(N'
  UPDATE r
  SET visibility = CASE WHEN u.role IN (''employee'', ''supply_chain'') THEN ''internal'' ELSE ''vendor'' END
  FROM dbo.tb_row_remarks r
  LEFT JOIN dbo.users u ON u.id = r.created_by
  WHERE r.visibility IS NULL;
');

IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.tb_row_remarks') AND name = 'visibility' AND is_nullable = 1
)
BEGIN
  EXEC(N'ALTER TABLE dbo.tb_row_remarks ALTER COLUMN visibility NVARCHAR(16) NOT NULL;');
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = 'CK_tb_row_remarks_visibility' AND parent_object_id = OBJECT_ID('dbo.tb_row_remarks')
)
BEGIN
  EXEC(N'ALTER TABLE dbo.tb_row_remarks ADD CONSTRAINT CK_tb_row_remarks_visibility
    CHECK (visibility IN (''vendor'', ''internal''));');
END;
```

Let op: `ALTER COLUMN ... NOT NULL` faalt als `IX_tb_row_remarks_row` de kolom zou bevatten — dat is niet zo (kolom is nieuw), dus veilig.

- [ ] **Step 2:** `npm run migrate:db` twee keer → beide succesvol.
- [ ] **Step 3: Verifieer** in SQL: `SELECT visibility, COUNT(*) FROM dbo.tb_row_remarks GROUP BY visibility;` → alleen `vendor`/`internal`, geen NULL. `SELECT r.visibility, u.role, COUNT(*) FROM dbo.tb_row_remarks r LEFT JOIN dbo.users u ON u.id=r.created_by GROUP BY r.visibility, u.role;` → employee ↔ internal, rest ↔ vendor.
- [ ] **Step 4: Checkpoint:** `feat: add visibility column to row remarks`

---

### Task 5: `remarkVisibility` util (schrijf- en leesregel)

**Files:**
- Create: `server/utils/remarkVisibility.js`
- Test: `server/utils/remarkVisibility.test.js`

**Interfaces — Produces:**
- `REMARK_VISIBILITY = { VENDOR: 'vendor', INTERNAL: 'internal' }`
- `resolveWriteVisibility(role: string, requested: unknown): 'vendor'|'internal'` — gooit `{status:400, message:'Choose who can see this remark'}` als admin/supply_chain zonder geldige keuze; gooit 403 voor onbekende rol.
- `readVisibilityFilter(role: string): 'vendor'|'internal'|null` — `null` = geen filter.
- `visibilitySql(alias: string, filter: string|null): string` — `''` of `` `AND ${alias}.visibility = @visibility` ``.
- `canSeeVisibilityDetails(role: string): boolean` — admin/supply_chain.

- [ ] **Step 1: Failing test**

```js
'use strict';
const {
  resolveWriteVisibility, readVisibilityFilter, visibilitySql, canSeeVisibilityDetails,
} = require('./remarkVisibility');

describe('resolveWriteVisibility', () => {
  it('supplier schrijft altijd vendor, ook als client internal stuurt', () => {
    expect(resolveWriteVisibility('supplier', 'internal')).toBe('vendor');
    expect(resolveWriteVisibility('supplier', undefined)).toBe('vendor');
  });
  it('employee schrijft altijd internal, ook als client vendor stuurt', () => {
    expect(resolveWriteVisibility('employee', 'vendor')).toBe('internal');
  });
  it.each(['admin', 'supply_chain'])('%s moet expliciet kiezen', (role) => {
    expect(resolveWriteVisibility(role, 'vendor')).toBe('vendor');
    expect(resolveWriteVisibility(role, 'internal')).toBe('internal');
    expect(() => resolveWriteVisibility(role, undefined)).toThrow(expect.objectContaining({ status: 400, message: 'Choose who can see this remark' }));
    expect(() => resolveWriteVisibility(role, 'public')).toThrow(expect.objectContaining({ status: 400 }));
  });
  it('onbekende rol → 403', () => {
    expect(() => resolveWriteVisibility('user', 'vendor')).toThrow(expect.objectContaining({ status: 403 }));
  });
});

describe('readVisibilityFilter', () => {
  it('per rol', () => {
    expect(readVisibilityFilter('supplier')).toBe('vendor');
    expect(readVisibilityFilter('employee')).toBe('internal');
    expect(readVisibilityFilter('supply_chain')).toBeNull();
    expect(readVisibilityFilter('admin')).toBeNull();
  });
  it('onbekende rol krijgt het strengste filter niet maar een fout', () => {
    expect(() => readVisibilityFilter('user')).toThrow(expect.objectContaining({ status: 403 }));
  });
});

describe('visibilitySql', () => {
  it('leeg zonder filter, anders predicaat op alias', () => {
    expect(visibilitySql('r', null)).toBe('');
    expect(visibilitySql('r', 'vendor')).toBe('AND r.visibility = @visibility');
  });
});

it('canSeeVisibilityDetails', () => {
  expect(['admin', 'supply_chain', 'employee', 'supplier'].map(canSeeVisibilityDetails)).toEqual([true, true, false, false]);
});
```

- [ ] **Step 2:** `npx vitest run server/utils/remarkVisibility.test.js` → FAIL.

- [ ] **Step 3: Implementatie**

```js
'use strict';

// Zichtbaarheid van remarks. Server bepaalt de waarde; de client mag alleen kiezen
// als de rol dat toestaat (admin, supply_chain).
const { ROLES, canChooseRemarkVisibility } = require('../constants/roles');

const REMARK_VISIBILITY = Object.freeze({ VENDOR: 'vendor', INTERNAL: 'internal' });
const VALUES = new Set(Object.values(REMARK_VISIBILITY));

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function resolveWriteVisibility(role, requested) {
  if (role === ROLES.SUPPLIER) return REMARK_VISIBILITY.VENDOR;
  if (role === ROLES.EMPLOYEE) return REMARK_VISIBILITY.INTERNAL;
  if (canChooseRemarkVisibility(role)) {
    if (!VALUES.has(requested)) throw httpError(400, 'Choose who can see this remark');
    return requested;
  }
  throw httpError(403, 'Insufficient permissions');
}

function readVisibilityFilter(role) {
  if (role === ROLES.SUPPLIER) return REMARK_VISIBILITY.VENDOR;
  if (role === ROLES.EMPLOYEE) return REMARK_VISIBILITY.INTERNAL;
  if (canChooseRemarkVisibility(role)) return null;
  throw httpError(403, 'Insufficient permissions');
}

function visibilitySql(alias, filter) {
  return filter ? `AND ${alias}.visibility = @visibility` : '';
}

function canSeeVisibilityDetails(role) {
  return canChooseRemarkVisibility(role);
}

module.exports = {
  REMARK_VISIBILITY,
  resolveWriteVisibility,
  readVisibilityFilter,
  visibilitySql,
  canSeeVisibilityDetails,
};
```

- [ ] **Step 4:** Test → PASS.
- [ ] **Step 5: Checkpoint:** `feat: remark visibility rules`

---

### Task 6: `RowRemarksService` + mapper — filter en DTO

**Files:**
- Modify: `server/services/RowRemarksService.js`, `server/services/RowRemarksMapper.js`
- Test: `server/services/RowRemarksService.test.js`

**Interfaces — Consumes:** Task 5. **Produces:**
- `normalizeActor(actor)` → `{ id, role, isAdmin, isSupplier, visibilityFilter: 'vendor'|'internal'|null, seesVisibility: boolean }`
- `addRemark(input: {..., visibility?: string}, actor)`
- Remark-DTO extra velden **alleen als `actor.seesVisibility`**: `visibility: 'vendor'|'internal'`, `fromVendor: boolean`.
- Summary-item: `latest.visibility` alleen als `seesVisibility`.

- [ ] **Step 1: Failing tests** — toevoegen aan `RowRemarksService.test.js` (gebruik bestaande `mocks`, `remarkRow`, `result`):

```js
const supplier = { id: 30, role: 'supplier', vendor_account: 'V001' };
const supplyChain = { id: 40, role: 'supply_chain' };

describe('zichtbaarheid', () => {
  it.each([
    [employee, 'internal'],
    [supplier, 'vendor'],
  ])('listRemarks filtert voor %o op %s (lijst én total)', async (actor, expected) => {
    // supplier-rijtoegang: mock assertSupplierPurchaseOrderRow zoals de bestaande supplier-tests doen
    await listRemarks(baseInput, actor);
    const q = mocks.queries.find((x) => x.text.includes('WITH paged'));
    expect(q.inputs.visibility).toBe(expected);
    expect(q.text.match(/r\.visibility = @visibility|visibility = @visibility/g)).toHaveLength(2);
  });

  it.each([admin, supplyChain])('listRemarks zonder filter voor %o', async (actor) => {
    await listRemarks(baseInput, actor);
    const q = mocks.queries.find((x) => x.text.includes('WITH paged'));
    expect(q.text).not.toContain('@visibility');
  });

  it('addRemark: employee schrijft internal ondanks meegestuurd vendor', async () => {
    await addRemark({ ...baseInput, body: 'x', visibility: 'vendor' }, employee);
    const insert = mocks.queries.find((x) => x.text.includes('INSERT INTO dbo.tb_row_remarks'));
    expect(insert.inputs.newVisibility).toBe('internal');
    expect(insert.text).toContain('@newVisibility');
  });

  it('addRemark: supply_chain zonder keuze → 400 en geen insert', async () => {
    await expect(addRemark({ ...baseInput, body: 'x' }, supplyChain)).rejects.toMatchObject({ status: 400 });
    expect(mocks.queries.some((x) => x.text.includes('INSERT INTO'))).toBe(false);
  });

  it('addRemark: supply_chain kiest internal', async () => {
    mocks.queryHandler = (ctx) => (ctx.text.includes('r.id = @remarkId')
      ? result([remarkRow({ id: ctx.inputs.remarkId, visibility: 'internal', author_role: 'supply_chain' })])
      : defaultQueryHandler(ctx));
    const remark = await addRemark({ ...baseInput, body: 'x', visibility: 'internal' }, supplyChain);
    expect(remark.visibility).toBe('internal');
    expect(remark.fromVendor).toBe(false);
  });

  it('DTO verbergt visibility voor employee', async () => {
    const page = await listRemarks(baseInput, employee);
    expect(page.items[0]).not.toHaveProperty('visibility');
    expect(page.items[0]).not.toHaveProperty('fromVendor');
  });

  it('setReaction op onzichtbare remark → 404', async () => {
    mocks.queryHandler = (ctx) => (ctx.text.includes('WITH (UPDLOCK, HOLDLOCK)') && ctx.text.includes('r.created_by')
      ? (expect(ctx.text).toContain('@visibility'), result([]))
      : defaultQueryHandler(ctx));
    await expect(setReaction({ ...baseInput, id: 41, emoji: '👍', active: true }, employee))
      .rejects.toMatchObject({ status: 404 });
  });

  it('deleteRemark filtert ook op visibility (onzichtbaar → 404)', async () => {
    mocks.queryHandler = (ctx) => (ctx.text.includes('UPDATE r')
      ? (expect(ctx.text).toContain('@visibility'), result([], [[], []]))
      : defaultQueryHandler(ctx));
    await expect(deleteRemark({ ...baseInput, id: 41 }, employee)).rejects.toMatchObject({ status: 404 });
  });
});
```

En voor `summarizeRemarks` (import toevoegen):
```js
it('summarizeRemarks telt en kiest latest binnen het filter', async () => {
  mocks.queryHandler = ({ text, inputs }) => {
    expect(inputs.visibility).toBe('internal');
    expect(text.match(/visibility = @visibility/g)).toHaveLength(2); // counts én latest
    return result([]);
  };
  await summarizeRemarks('purchase-orders', employee);
});
```

- [ ] **Step 2:** `npx vitest run server/services/RowRemarksService.test.js` → FAIL.

- [ ] **Step 3: Implementatie** `RowRemarksService.js`

```js
const {
  readVisibilityFilter, resolveWriteVisibility, visibilitySql, canSeeVisibilityDetails,
} = require('../utils/remarkVisibility');

function normalizeActor(actor) {
  const id = normalizePositiveId(actor?.id, 'actor');
  const role = actor?.role;
  if (role !== ROLES.SUPPLIER && !isStaffRole(role)) throw httpError(403, 'Insufficient permissions');
  return {
    id,
    role,
    isAdmin: role === ROLES.ADMIN,
    isSupplier: role === ROLES.SUPPLIER,
    visibilityFilter: readVisibilityFilter(role),
    seesVisibility: canSeeVisibilityDetails(role),
  };
}

function remarkRequest(request, { tableId, row, actorId, visibilityFilter = null }) {
  request
    .input('tableId', sql.BigInt, tableId)
    .input('partitionKey', sql.NVarChar(32), row.partitionKey)
    .input('recordKey', sql.NVarChar(128), row.recordKey)
    .input('actorId', sql.Int, actorId);
  if (visibilityFilter) request.input('visibility', sql.NVarChar(16), visibilityFilter);
  return request;
}
```

Overal waar `remarkRequest(..., { tableId, row, actorId: ctx.actor.id })` staat: `visibilityFilter: ctx.actor.visibilityFilter` toevoegen. `const vis = visibilitySql('r', ctx.actor.visibilityFilter);` en in de queries:
- `REMARK_SELECT`: `u.role AS author_role, p.visibility` toevoegen aan de SELECT-lijst.
- `listRemarks`: in de `paged`-CTE `WHERE ... ${vis}`; de `COUNT_BIG` query: `FROM dbo.tb_row_remarks r WHERE r.table_id = @tableId AND ... ${vis}` (alias `r` toevoegen).
- `fetchRemark`: `... AND r.detail_key = -1 ${vis}` — maakt elke onzichtbare remark een 404.
- `addRemark`:
  ```js
  const visibility = resolveWriteVisibility(ctx.actor.role, input.visibility);
  // .input('newVisibility', sql.NVarChar(16), visibility)
  //   (table_id, ..., body, created_by, visibility)
  //   SELECT @tableId, ..., @body, @actorId, @newVisibility
  ```
  `resolveWriteVisibility` aanroepen **vóór** de query zodat een 400 geen insert veroorzaakt. Naam `@newVisibility` zodat hij niet botst met het leesfilter `@visibility` dat `remarkRequest` voor employee/supplier al op dezelfde request zet.
- `deleteRemark`: `UPDATE ... AND r.is_deleted = 0 AND (r.created_by = @actorId OR @isAdmin = 1) ${vis}` en de state-SELECT ook met alias `r` + `${vis}` → onzichtbaar valt in `!state` → 404.
- `setReaction`: locked-SELECT `... AND r.detail_key = -1 ${vis}`; `remarkRequest(dependencies.createRequest(tx), { ..., visibilityFilter: ctx.actor.visibilityFilter })`.
- `summarizeRemarks`: request `.input('visibility', ...)` als filter gezet; in `counts`-subquery `FROM dbo.tb_row_remarks r WHERE r.table_id = @tableId AND r.detail_key = -1 AND r.is_deleted = 0 ${vis}` en in `latest` CROSS APPLY `... AND r.is_deleted = 0 ${vis}`; `latest.visibility` selecteren (`r.visibility`). Mapping:
  ```js
  latest: {
    id: Number(row.id),
    bodyPreview: [...row.body].slice(0, 280).join(''),
    authorName: row.author_name || null,
    createdAt: iso(row.created_at),
    ...(normalizedActor.seesVisibility ? { visibility: row.visibility } : {}),
  },
  ```

`RowRemarksMapper.js` in het object na `reactions: []`:
```js
...(actor?.seesVisibility ? {
  visibility: row.visibility,
  fromVendor: row.author_role === 'supplier',
} : {}),
```

- [ ] **Step 4:** Test → PASS. Bestaande tests in het bestand ook groen (de default-handler retourneert rijen zonder `visibility`; dat is ok voor employee).
- [ ] **Step 5: Checkpoint:** `feat: enforce remark visibility in row remarks service`

---

### Task 7: Search, has-comment en activity-feed filteren

**Files:**
- Modify: `server/services/RowRemarksSearchService.js`, `server/services/RowActivityService.js`, `server/routes/data.js:161-…` (activity-route: `currentUser` wordt al doorgegeven — controleren)
- Test: `server/services/RowRemarksSearchService.test.js`, `server/services/RowActivityService.test.js`

**Interfaces — Consumes:** Task 5 (`readVisibilityFilter`, `visibilitySql`, `canSeeVisibilityDetails`). **Produces:** activity-remark-items krijgen `visibility` + `fromVendor` alleen voor admin/supply_chain.

- [ ] **Step 1: Failing tests**

`RowRemarksSearchService.test.js` (bestaande fake-pool-opzet volgen):
```js
it.each([
  [{ id: 1, role: 'employee' }, 'internal'],
  [{ id: 2, role: 'supplier', vendor_account: 'V1' }, 'vendor'],
])('searchRemarks filtert op visibility', async (actor, expected) => {
  await searchRemarks('purchase-orders', 'abc', actor);
  const q = lastQuery();
  expect(q.inputs.visibility).toBe(expected);
  expect(q.text).toContain('r.visibility = @visibility');
});
it('hasRemarks zonder filter voor supply_chain', async () => {
  await hasRemarks('purchase-orders', { id: 3, role: 'supply_chain' });
  expect(lastQuery().text).not.toContain('@visibility');
});
```

`RowActivityService.test.js`:
```js
it('activity "all" filtert remarks voor employee', async () => {
  await getRowActivity({ ...baseOptions, kind: 'all', currentUser: { id: 1, role: 'employee' } });
  const q = lastQuery();
  expect(q.inputs.visibility).toBe('internal');
  expect(q.text).toMatch(/r\.visibility\s*=\s*@visibility/);
});
it('activity zonder visibility-filter voor admin; remark-item krijgt visibility', async () => {
  // fake row met activity_type 'remark', visibility 'internal', author_role 'supplier'
  const res = await getRowActivity({ ...baseOptions, kind: 'all', currentUser: { id: 9, role: 'admin' } });
  expect(lastQuery().text).not.toContain('@visibility');
  expect(res.items.find((i) => i.type === 'remark')).toMatchObject({ visibility: 'internal', fromVendor: true });
});
it('remark-item zonder visibility voor employee', async () => {
  const res = await getRowActivity({ ...baseOptions, kind: 'all', currentUser: { id: 1, role: 'employee' } });
  expect(res.items.find((i) => i.type === 'remark')).not.toHaveProperty('visibility');
});
```

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3: Implementatie**

`RowRemarksSearchService.js`: `normalizeActor` uitbreiden net als in Task 6 (`visibilityFilter`). In `queryRemarkRowKeys`:
```js
const request = pool.request().input('tableId', sql.BigInt, table.id);
if (normalizedActor.visibilityFilter) request.input('visibility', sql.NVarChar(16), normalizedActor.visibilityFilter);
applyInputs(request);
// WHERE ... AND r.is_deleted = 0 ${visibilitySql('r', normalizedActor.visibilityFilter)} ${extraCondition};
```

`RowActivityService.js`:
- `buildQuery(visibilityFilter)`: in de remark-tak `AND (@columnId IS NULL OR r.column_id=@columnId) ${visibilitySql('r', visibilityFilter)}`. Voeg aan **alle** UNION-takken twee kolommen toe aan het einde: `CAST(NULL AS NVARCHAR(16)) visibility, CAST(NULL AS NVARCHAR(50)) author_role` en in de remark-tak `r.visibility, u.role`.
- In `getRowActivity`: `const visibilityFilter = readVisibilityFilter(options.currentUser?.role);` (vóór de query; onbekende rol → 403), `if (visibilityFilter) request.input('visibility', sql.NVarChar(16), visibilityFilter);`, `request.query(buildQuery(visibilityFilter))`.
- `mapActivityRow`: `visibility: row.visibility || null, authorRole: row.author_role || null`.
- `enrichRemarkActivity(item, reactions, currentUser)`:
  ```js
  const { visibility, authorRole, ...rest } = item;
  return {
    ...rest,
    author, column, reactions: reactions || [],
    canDelete: !item.isDeleted && currentUser?.role !== ROLES.SUPPLIER && Boolean(
      currentUser?.role === ROLES.ADMIN
      || (author?.id && String(author.id) === String(currentUser?.id))
    ),
    ...(canSeeVisibilityDetails(currentUser?.role)
      ? { visibility, fromVendor: authorRole === ROLES.SUPPLIER } : {}),
  };
  ```
  Niet-remark items: `visibility`/`authorRole` ook strippen (`if (item.type !== 'remark') { const { visibility, authorRole, ...rest } = item; return rest; }`).
- De totals-query (`remarks` count) telt uit `#activity`, die al gefilterd is → klopt automatisch.

- [ ] **Step 4:** Tests → PASS; `npx vitest run server/services server/routes/data` groen.
- [ ] **Step 5: Checkpoint:** `feat: filter remark search and activity by visibility`

---

### Task 8: Route — `visibility` doorgeven

**Files:**
- Modify: `server/routes/data.js:110-125`
- Test: `server/routes/data.test.js`

- [ ] **Step 1: Failing test** (bestaande route-test-opzet met gemockte `remarksService`):
```js
it('POST /remarks geeft visibility door aan de service', async () => {
  await request(app).post('/api/data/purchase-orders/remarks')
    .send({ partitionKey: 'whsl', recordKey: 'PO-1', body: 'Hi', visibility: 'internal' })
    .expect(201);
  expect(remarksService.addRemark).toHaveBeenCalledWith(
    expect.objectContaining({ visibility: 'internal' }), expect.anything(),
  );
});
it('POST /remarks: 400 uit service komt door als 400', async () => {
  remarksService.addRemark.mockRejectedValueOnce(Object.assign(new Error('Choose who can see this remark'), { status: 400 }));
  const res = await request(app).post('/api/data/purchase-orders/remarks')
    .send({ partitionKey: 'whsl', recordKey: 'PO-1', body: 'Hi' });
  expect(res.status).toBe(400);
  expect(res.body.error).toBe('Choose who can see this remark');
});
```

- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** In de POST-handler:
```js
const visibility = typeof req.body?.visibility === 'string' ? req.body.visibility : undefined;
const remark = await remarksService.addRemark(
  { tableKey, ...row, body, columnId, visibility },
  remarksActor(req),
);
```
- [ ] **Step 4:** PASS.
- [ ] **Step 5: Checkpoint:** `feat: accept remark visibility on create`

---

### Task 9: Composer — keuze-UI

**Files:**
- Create: `src/components/supplier/remarks/RemarkVisibilityPicker.jsx`
- Modify: `src/components/supplier/remarks/RemarkComposer.jsx`, `useRowRemarks.js:107-130`, `RemarksPanel.jsx:64-71`, `remarks.css`
- Test: `src/components/supplier/remarks/RemarksComponents.test.jsx` (of nieuw `RemarkComposer.test.jsx`)

**Interfaces:**
- `RemarkVisibilityPicker({ value: 'vendor'|'internal'|null, onChange(v), vendorAccount?: string, disabled?: boolean })`
- `RemarkComposer` props: `+ vendorAccount?: string`; `onSubmit(draft, columnId, visibility|null)`
- `createRemark(body, columnId = null, visibility = null)` — stuurt `visibility` alleen mee als niet-null.

- [ ] **Step 1: Failing tests**

```jsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RemarkComposer from './RemarkComposer';

const sc = { id: 4, role: 'supply_chain', display_name: 'Sam' };

it('supply_chain: submit disabled tot er gekozen is, knoptekst volgt keuze', async () => {
  const onSubmit = vi.fn().mockResolvedValue({});
  render(<RemarkComposer currentUser={sc} onSubmit={onSubmit} vendorAccount="V001" />);
  await userEvent.type(screen.getByRole('textbox'), 'Hello');
  expect(screen.getByText('Choose who can see this remark')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /add remark|send|post/i })).toBeDisabled();

  await userEvent.click(screen.getByRole('radio', { name: /For vendor/ }));
  expect(screen.getByRole('button', { name: 'Send to vendor' })).toBeEnabled();
  expect(screen.getByText(/Visible to vendor V001/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole('radio', { name: /Internal/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Post internal note' }));
  expect(onSubmit).toHaveBeenCalledWith('Hello', null, 'internal');
});

it('reset keuze na plaatsen', async () => {
  const onSubmit = vi.fn().mockResolvedValue({});
  render(<RemarkComposer currentUser={sc} onSubmit={onSubmit} />);
  await userEvent.type(screen.getByRole('textbox'), 'Hi');
  await userEvent.click(screen.getByRole('radio', { name: /Internal/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Post internal note' }));
  expect(screen.getByRole('radio', { name: /Internal/ })).not.toBeChecked();
});

it('employee: geen keuze, vaste internal-hint en knop', () => {
  render(<RemarkComposer currentUser={{ id: 1, role: 'employee' }} onSubmit={vi.fn()} />);
  expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  expect(screen.getByText('Internal — not visible to vendors')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Post internal note' })).toBeInTheDocument();
});

it('vendor: ongewijzigd', () => {
  render(<RemarkComposer currentUser={{ id: 2, role: 'supplier' }} onSubmit={vi.fn()} />);
  expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add remark' })).toBeInTheDocument();
});
```

`useRowRemarks.test.jsx`: `createRemark('x', null, 'vendor')` → request-body bevat `visibility: 'vendor'`; `createRemark('x')` → body heeft geen `visibility`-key.

- [ ] **Step 2:** FAIL.

- [ ] **Step 3: Implementatie**

`RemarkVisibilityPicker.jsx`:
```jsx
import React, { memo } from 'react';
import { Radio, RadioGroup } from '@fluentui/react-components';
import { EyeRegular, LockClosedRegular } from '@fluentui/react-icons';

function RemarkVisibilityPicker({ value, onChange, vendorAccount = '', disabled = false }) {
  const vendorHint = vendorAccount
    ? `Visible to vendor ${vendorAccount} and Supply Chain/Admin`
    : 'Visible to the vendor and Supply Chain/Admin';
  return (
    <RadioGroup
      className="remark-visibility-picker"
      aria-label="Who can see this remark?"
      layout="horizontal"
      value={value || ''}
      disabled={disabled}
      onChange={(_, data) => onChange(data.value)}
    >
      <Radio
        value="vendor"
        className={`remark-visibility-option${value === 'vendor' ? ' is-selected' : ''}`}
        label={(
          <span className="remark-visibility-option-text">
            <span className="remark-visibility-option-title"><EyeRegular aria-hidden="true" /> For vendor</span>
            <span className="remarks-muted">{vendorHint}</span>
          </span>
        )}
      />
      <Radio
        value="internal"
        className={`remark-visibility-option remark-visibility-option--internal${value === 'internal' ? ' is-selected' : ''}`}
        label={(
          <span className="remark-visibility-option-text">
            <span className="remark-visibility-option-title"><LockClosedRegular aria-hidden="true" /> Internal</span>
            <span className="remarks-muted">Staff only — vendor cannot see this</span>
          </span>
        )}
      />
    </RadioGroup>
  );
}

export default memo(RemarkVisibilityPicker);
```

`RemarkComposer.jsx` wijzigingen:
```jsx
import { LockClosedRegular } from '@fluentui/react-icons';
import { ROLES, canChooseRemarkVisibility } from '../../../constants/roles';
import RemarkVisibilityPicker from './RemarkVisibilityPicker';

function RemarkComposer({ currentUser, column = null, onSubmit, textareaRef = null, vendorAccount = '' }) {
  // ...bestaande state
  const [visibility, setVisibility] = useState(null);
  const canChoose = canChooseRemarkVisibility(currentUser?.role);
  const isEmployee = currentUser?.role === ROLES.EMPLOYEE;
  const needsChoice = canChoose && !visibility;
  const SUBMIT_LABELS = { vendor: 'Send to vendor', internal: 'Post internal note' };
  const submitLabel = canChoose
    ? (SUBMIT_LABELS[visibility] || 'Add remark')
    : (isEmployee ? 'Post internal note' : 'Add remark');
  // handleSubmit: if (invalid || submitting || needsChoice) return;
  //   await onSubmit(draft, column?.id || null, canChoose ? visibility : null);
  //   setDraft(''); setVisibility(null);
  //   deps: + visibility, canChoose, needsChoice
```
Render: `<RemarkVisibilityPicker>` tussen label-blok en textarea als `canChoose`; textarea `className={visibility ? `remarks-composer-input--${visibility}` : undefined}`; voor employee onder de textarea `<span className="remarks-composer-internal-hint"><LockClosedRegular aria-hidden="true" /> Internal — not visible to vendors</span>`; in actions vóór de knop `{needsChoice && normalizedLength > 0 ? <span className="remarks-muted">Choose who can see this remark</span> : null}`; knop `disabled={invalid || submitting || needsChoice}` met `{submitting ? 'Saving…' : submitLabel}`.

`useRowRemarks.js` `createRemark(body, columnId = null, visibility = null)`: body `...(visibility ? { visibility } : {})`; deps ongewijzigd.

`RemarksPanel.jsx` `handleSubmitRemark(body, columnId, visibility)` → `controller.remarks.createRemark(body, columnId, visibility)`. Composer-prop `vendorAccount`: haal het vendor-account van de rij uit de bestaande `row`-prop (veld dat het board als supplier-filterkolom gebruikt; zoek in `PurchaseOrdersPageContent.jsx` hoe de rij het vendor-account bevat, bijv. `row?.vendorAccount`/`row?.values?.[supplierFilterColumn]`). Als het niet beschikbaar is: prop weglaten — de picker heeft een fallback-tekst.

`remarks.css` (Fluent tokens, werkt in licht en donker):
```css
.remark-visibility-picker { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 8px 0; }
@media (max-width: 480px) { .remark-visibility-picker { grid-template-columns: 1fr; } }
.remark-visibility-option {
  border: 1px solid var(--colorNeutralStroke1); border-radius: var(--borderRadiusMedium);
  padding: 8px; margin: 0;
}
.remark-visibility-option.is-selected { border-color: var(--colorBrandStroke1); background: var(--colorBrandBackground2); }
.remark-visibility-option--internal.is-selected { border-color: var(--colorPaletteMarigoldBorder2); background: var(--colorPaletteMarigoldBackground1); }
.remark-visibility-option-text { display: flex; flex-direction: column; gap: 2px; }
.remark-visibility-option-title { display: inline-flex; align-items: center; gap: 4px; font-weight: var(--fontWeightSemibold); }
.remarks-composer textarea.remarks-composer-input--vendor { border-color: var(--colorBrandStroke1); }
.remarks-composer textarea.remarks-composer-input--internal { border-color: var(--colorPaletteMarigoldBorder2); }
.remarks-composer-internal-hint { display: inline-flex; align-items: center; gap: 4px; color: var(--colorNeutralForeground3); font-size: var(--fontSizeBase200); }
```

- [ ] **Step 4:** Tests → PASS; `npm run lint`.
- [ ] **Step 5: Checkpoint:** `feat: remark visibility picker in composer`

---

### Task 10: Badges op kaarten en board-cel

**Files:**
- Create: `src/components/supplier/remarks/RemarkVisibilityBadge.jsx`
- Modify: `RemarkMessageCard.jsx`, `RowActivityFeed.jsx` (`toRemark`), `RemarksLatestCell.jsx`
- Test: `src/components/supplier/remarks/RemarksComponents.test.jsx`

**Interfaces — Consumes:** DTO-velden `visibility`, `fromVendor` (Task 6/7), `summary.latest.visibility` (Task 6).

- [ ] **Step 1: Failing tests**

```jsx
it('kaart toont Internal-badge als visibility aanwezig is', () => {
  render(<RemarkMessageCard remark={{ id: 1, body: 'x', author: { id: 2, displayName: 'A' }, reactions: [], visibility: 'internal', fromVendor: false }} currentUser={{ id: 9 }} onDelete={vi.fn()} onReaction={vi.fn()} />);
  expect(screen.getByText('Internal')).toBeInTheDocument();
});
it('kaart toont Shared with vendor + Vendor-badge', () => {
  render(<RemarkMessageCard remark={{ id: 1, body: 'x', author: { id: 2, displayName: 'A' }, reactions: [], visibility: 'vendor', fromVendor: true }} currentUser={{ id: 9 }} onDelete={vi.fn()} onReaction={vi.fn()} />);
  expect(screen.getByText('Shared with vendor')).toBeInTheDocument();
  expect(screen.getByText('Vendor')).toBeInTheDocument();
});
it('kaart zonder visibility toont geen badge', () => {
  render(<RemarkMessageCard remark={{ id: 1, body: 'x', author: { id: 2, displayName: 'A' }, reactions: [] }} currentUser={{ id: 9 }} onDelete={vi.fn()} onReaction={vi.fn()} />);
  expect(screen.queryByText('Internal')).not.toBeInTheDocument();
  expect(screen.queryByText('Shared with vendor')).not.toBeInTheDocument();
});
it('latest-cel toont slot bij interne laatste remark', () => {
  render(<RemarksLatestCell summary={{ latest: { bodyPreview: 'x', visibility: 'internal', createdAt: '2026-10-07T10:00:00Z' } }} onOpen={vi.fn()} />);
  expect(screen.getByLabelText('Internal remark')).toBeInTheDocument();
});
```
Plus in `RowActivityFeed`-test (of `historyTableModel`/bestaande feed-test): een activity-item met `visibility: 'internal'` levert een kaart met badge "Internal".

- [ ] **Step 2:** FAIL.

- [ ] **Step 3: Implementatie**

`RemarkVisibilityBadge.jsx`:
```jsx
import React, { memo } from 'react';
import { Badge } from '@fluentui/react-components';
import { EyeRegular, LockClosedRegular } from '@fluentui/react-icons';

function RemarkVisibilityBadge({ visibility, fromVendor = false }) {
  if (!visibility) return null;
  return (
    <span className="remark-visibility-badges">
      {visibility === 'internal' ? (
        <Badge appearance="tint" color="warning" icon={<LockClosedRegular />}>Internal</Badge>
      ) : (
        <Badge appearance="tint" color="brand" icon={<EyeRegular />}>Shared with vendor</Badge>
      )}
      {fromVendor ? <Badge appearance="outline" color="informative">Vendor</Badge> : null}
    </span>
  );
}

export default memo(RemarkVisibilityBadge);
```
`RemarkMessageCard.jsx`: in de header na de author-span `<RemarkVisibilityBadge visibility={remark?.visibility} fromVendor={remark?.fromVendor} />`.
`RowActivityFeed.jsx` `toRemark(item)`: `visibility: item.visibility, fromVendor: item.fromVendor` meegeven.
`RemarksLatestCell.jsx`: vóór de preview `{latest?.visibility === 'internal' ? <LockClosedRegular className="remarks-latest-lock" aria-label="Internal remark" role="img" /> : null}`; `title` prefix `'Internal · '` als intern. CSS: `.remarks-latest-lock { flex: none; color: var(--colorPaletteMarigoldForeground2); margin-right: 4px; } .remark-visibility-badges { display: inline-flex; gap: 4px; margin-left: 8px; }` en `.remarks-latest-cell` naar `display:flex; align-items:center` als dat nog niet zo is (controleer bestaande stijl).

- [ ] **Step 4:** PASS; `npm run lint`.
- [ ] **Step 5: Checkpoint:** `feat: remark visibility badges`

---

### Task 11: Eindverificatie

- [ ] **Step 1:** `npm test` → alles groen (output noteren).
- [ ] **Step 2:** `npm run lint` en `npm run build` → zonder fouten.
- [ ] **Step 3:** `npm run migrate:db` (tweede keer) → succesvol.
- [ ] **Step 4: Handmatig op `http://localhost:5178`** (`npm run dev:all`), met vier gebruikers (maak een Supply Chain-user aan via User Management):
  1. Supply Chain plaatst "SC-vendor" (For vendor) en "SC-internal" (Internal) op PO X; employee plaatst "EMP"; vendor van PO X plaatst "VEN".
  2. Vendor ziet: SC-vendor, VEN. Employee ziet: SC-internal, EMP. Supply Chain/Admin zien alle vier met juiste badges.
  3. Controleer per rol ook: badge-telling op de rij, "latest"-kolom, zoeken in Remarks-kolom, filter "has a comment", tab "All".
  4. DevTools Network: vendor-responses van `/remarks`, `/remarks/summary`, `/activity` bevatten geen `SC-internal`/`EMP`.
  5. Supply Chain: Settings bereikbaar met toegekende permissies; eigen remark verwijderen werkt.
- [ ] **Step 5:** `/perf-check` of Server-Timing: `remarks_list_sql`, `remarks_activity`, `remarks_search_sql` niet merkbaar trager dan vóór de wijziging.
- [ ] **Step 6:** `/final-check-feature` draaien.
