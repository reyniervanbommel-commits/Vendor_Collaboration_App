/**
 * Pagina-rechten voor deze app (supplier portal).
 *
 * De instellingen-ids komen 1-op-1 overeen met de tab-ids in `SETTINGS_NAV_SECTIONS`
 * (`src/utils/settingsAudience.js`) en met de `page_name`-waarden in `dbo.user_permissions`.
 * `general` staat er bewust niet bij: die tab blijft altijd zichtbaar voor staff.
 */
export const PAGE_PERMISSIONS = Object.freeze([
  {
    id: 'purchase-orders',
    label: 'Purchase orders',
    description: 'Access to the purchase orders overview',
  },
  {
    id: 'users',
    label: 'Users',
    description: 'View the user list and create vendor accounts (admin-only actions stay blocked)',
  },
  {
    id: 'analytics',
    label: 'Analytics',
    description: 'Access to usage, login and onboarding analytics',
  },
  {
    id: 'mail-template',
    label: 'Mail template',
    description: 'Edit the password reset email template',
  },
  {
    id: 'odata',
    label: 'OData',
    description: 'View and change the D365 OData connection settings',
  },
  {
    id: 'datamodel',
    label: 'Data model',
    description: 'Manage tables, fields and sync filters',
  },
  {
    id: 'external-links',
    label: 'External links',
    description: 'Manage Excel datasets and their links to main tables',
  },
  {
    id: 'track-changes',
    label: 'Track changes',
    description: 'Configure change tracking per column',
  },
  {
    id: 'd365-refresh',
    label: 'D365 refresh',
    description: 'Start refreshes and manage refresh history and alert emails',
  },
]);

export const PAGE_PERMISSION_LABELS = Object.fromEntries(
  PAGE_PERMISSIONS.map((p) => [p.id, p.label])
);

export const PAGE_PERMISSIONS_BY_ID = Object.fromEntries(
  PAGE_PERMISSIONS.map((p) => [p.id, p])
);
