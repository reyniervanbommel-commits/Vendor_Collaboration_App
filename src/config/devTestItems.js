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
