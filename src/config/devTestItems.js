// Testchecklist voor de DEV-omgeving. Leeg na een PROD-deploy (schone lei);
// push-feature-to-dev voegt automatisch nieuwe items toe zodra een feature naar DEV gaat.
// Format per item: { id, title, checks: ['wat de tester controleert', ...] }.
// Rechtsonder op DEV opent DevFeatureChecklist deze checks als afvinkbare vakjes.
export const devTestItems = [
  {
    id: 'feature-325-sync-filter-layers-v1-62-2',
    title: 'Feature 325 - D365 sync filter layers (v1.62.2)',
    checks: [
      'Admin > Data model > Purchase orders > D365 sync filters: een 2e laag toevoegen, een regel invullen, opslaan',
      'Na Save filters naar een ander tabblad (bv. Vendors) wisselen en terug naar Purchase orders: beide lagen blijven staan',
      'Een laag uitzetten (Active-toggle) laat de andere laag ongewijzigd (geen reset van retentie)',
      'Opslaan van een actieve laag zonder regels geeft een duidelijke foutmelding',
      'Count rows per laag toont een apart resultaat per laag',
    ],
  },
  {
    id: 'feature-326-granular-settings-permissions-v1-69-2',
    title: 'Feature 326 - Granulaire instellingen-permissies (v1.69.2)',
    checks: [
      'Instellingen > Users: bij een employee opent Choose action > Manage permissions een lijst met 8 vinkjes onder People en Data',
      'Geef een employee alleen OData; na herladen ziet die in de Instellingen-sidebar alleen General en OData',
      'Trek die permissie weer in; de tab verdwijnt bij de eerstvolgende keer laden, zonder opnieuw inloggen',
      'Bestaande employees hebben nog steeds Analytics en External links (migratie 050)',
      'Kolom Permissions toont Full access bij een admin en Vendor access bij een vendor, niet No permissions',
      'Choose action > Change role wijzigt de rol van een bestaande gebruiker; bij je eigen account ontbreekt die optie',
      'Bij een vendor toont Manage permissions geen vinkjes maar de melding dat dit alleen voor employees geldt',
      'Als employee zonder de datamodel-permissie is Instellingen > Data model niet zichtbaar en blijft write-back onbereikbaar',
      'Wachtwoord vergeten van een bestaand account loopt via Forgot password; de set-password-pagina weigert een account dat al een wachtwoord heeft',
    ],
  },
];

/** Flat checklist rows for DevFeatureChecklist (one checkbox per check line). */
export function buildDevChecklistItems(items = devTestItems) {
  return items.flatMap((feature) =>
    (feature.checks || []).map((check, index) => ({
      id: `${feature.id}--${index}`,
      label: check,
      title: feature.title,
    }))
  );
}
