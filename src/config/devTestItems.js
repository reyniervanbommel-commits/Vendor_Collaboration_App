// Testchecklist voor de DEV-omgeving. Leeg na een PROD-deploy (schone lei);
// push-feature-to-dev voegt automatisch nieuwe items toe zodra een feature naar DEV gaat.
// Format per item: { id, title, checks: ['wat de tester controleert', ...] }.
// Rechtsonder op DEV opent DevFeatureChecklist deze checks als afvinkbare vakjes.
export const devTestItems = [
  {
    id: 'vendor-tab-startswith-v1.73.4',
    title: 'Vendor tab starts-with filter (v1.73.4)',
    checks: [
      'Save a vendor tab with a starts-with filter on a push-to-header column and confirm the tab still filters after reload',
      'Hover a view tab and confirm the tooltip lists view-base filters plus the tab extra filter',
    ],
  },
  {
    id: 'q-vendor-sync-filter-v1.73.4',
    title: 'Q-vendor prefix stays local (v1.73.4)',
    checks: [
      'Run a PO sync and confirm Q-vendors stay excluded without a D365 startswith error on OrderVendorAccountNumber',
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
