# Granulaire instellingen-permissies voor employees (DevOps)

**Work item:** [#326](https://reyniervanbommel0745.visualstudio.com/Vendor-App/_workitems/edit/326) (User Story, aangemaakt via `az boards work-item create`)
**Doel:** admins kunnen employees granulaire toegang geven tot losse Instellingen-onderdelen (8 permissies) i.p.v. alleen de rol `employee`, met de bestaande maar tot nu toe ongebruikte `dbo.user_permissions`-tabel daadwerkelijk afgedwongen in backend en frontend.
**Referentie in repo:** [docs/specs/2026-09-16-granular-settings-permissions.md](../specs/2026-09-16-granular-settings-permissions.md)
**Repo-document:** `docs/devops/326-granular-settings-permissions.md`
**Tags:** settings; permissions; rbac; security; admin

> **Aanmaak-methode:** de Azure DevOps MCP-verbinding was niet geautoriseerd (`TF400813`, verlopen/ontbrekend token). Het work item is in plaats daarvan via de **Azure CLI** (`az boards work-item create`) aangemaakt — zie `post-plan-to-devops`-skill, sectie "Pad ADO via CLI (fallback)".

---

## User story

**Als** admin
**wil ik** een employee toegang kunnen geven tot losse Instellingen-onderdelen (bijv. alleen OData, of alleen Analytics)
**zodat** ik werk kan delegeren zonder de employee volledige admin-rechten te geven.

---

## Acceptatiecriteria (definitie van "klaar")

1. Een employee zonder `odata`-permissie krijgt `403` op de OData-instellingenroutes en ziet de tab niet in de Instellingen-sidebar.
2. Een employee met de `users`-permissie kan de gebruikerslijst zien en een supplier aanmaken, maar krijgt `403` bij het wijzigen van een rol, verwijderen van een user, force-reset, of het wijzigen van permissies (ook van zichzelf).
3. Een supplier ziet geen instellingen-permissie-checkboxen in `EditPermissionsDialog`.
4. Bestaande employees behouden na de migratie hun huidige toegang tot Analytics en External links, zonder handmatige actie van de admin.
5. `PUT /api/admin/supplier-filter-column` retourneert `403` voor een niet-admin (bestaande kwetsbaarheid, meegenomen als quick-fix).
6. Alle nieuwe/gewijzigde tests slagen (`npm test`); versienummer in `src/config/version.js` is verhoogd.

---

## Wat is al gedaan (geen DevOps-tasks meer nodig tenzij verificatie)

| Item | Locatie |
|------|---------|
| Permissie-opslag (`dbo.user_permissions`) en CRUD-routes bestaan al | `server/routes/admin.js` regel 154-190, migratie `004_user_permissions.sql` |
| Permissiedialoog-UI (rendert dynamisch uit `PAGE_PERMISSIONS`) | `src/components/admin/EditPermissionsDialog.jsx` |
| Instellingen-sidebar en rol-gating per tab | `src/utils/settingsAudience.js`, `src/components/admin/AdminSettingsSidebar.jsx` |
| Volledig ontwerp incl. route-mapping, migratie-SQL, middleware-code, team-review | `docs/specs/2026-09-16-granular-settings-permissions.md` |

---

## Backlog — tasks

- [ ] Security-quick-fix: `requireRole(ROLES.ADMIN)` toevoegen aan `PUT /api/admin/supplier-filter-column` (`server/routes/admin.js` regel 435) + test.
- [ ] Migratie `scripts/db/migrations/050_settings_page_permissions.sql`: bestaande employees krijgen `analytics`+`external-links`-permissie; oude `page_name='admin'`-rijen opschonen. Idempotent, lokaal getest via `npm run migrate:db`.
- [ ] `PAGE_PERMISSIONS` (`src/constants/pagePermissions.js`) uitbreiden naar 8 instellingen-ids; `SETTINGS_NAV_SECTIONS` (`src/utils/settingsAudience.js`) krijgt `grantable: true/false` per tab.
- [ ] Nieuwe module `server/utils/pagePermissions.js` (`hasPagePermission`) + `requirePagePermission`-middleware in `server/middleware/auth.js`, met tests in `server/middleware/auth.test.js`.
- [ ] Guards toepassen conform de route-mapping-tabel in het ontwerp, verspreid over `server/routes/admin.js`, `server/routes/data.js`, `server/routes/dataLinks.js`.
- [ ] `GET /api/auth/me` uitbreiden met een verse `permissions`-array (`server/routes/auth.js`).
- [ ] Frontend: `getVisibleSettingsSections(userRole, userPermissions)`, `AdminPage.jsx` (permissies uit `AuthContext`), `EditPermissionsDialog.jsx` (checkboxen alleen bij `role === employee`, gegroepeerd per sectie), labels in `settingsAudience.js` (`"Admin, Employee (with permission)"`).
- [ ] Tests: `settingsAudience.test.js` (`grantable`-regel); nieuwe route-test in de stijl van `admin.general-settings.test.js` met de 4 escalatie-testgevallen (rol-wijziging, delete, force-reset, permissies-beheer) + 1 test voor de `supplier-filter-column`-guard.
- [ ] Versienummer ophogen in `src/config/version.js`.

_(Zie het volledige ontwerp voor exacte routepaden, SQL en codevoorbeelden: [docs/specs/2026-09-16-granular-settings-permissions.md](../specs/2026-09-16-granular-settings-permissions.md))_

---

## Versie document

Aangemaakt op basis van [docs/specs/2026-09-16-granular-settings-permissions.md](../specs/2026-09-16-granular-settings-permissions.md); wijzig dit bestand bij nieuwe afspraken. Geen work item-ID — zie let-op boven.
