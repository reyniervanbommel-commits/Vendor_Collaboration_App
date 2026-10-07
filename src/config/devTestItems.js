// Testchecklist voor de DEV-omgeving. Leeg na een PROD-deploy (schone lei);
// push-feature-to-dev voegt automatisch nieuwe items toe zodra een feature naar DEV gaat.
// Format per item: { id, title, checks: ['wat de tester controleert', ...] }.
// Rechtsonder op DEV opent DevFeatureChecklist deze checks als afvinkbare vakjes.
export const devTestItems = [
  {
    id: 'saved-view-tabs-v1.73.16',
    title: 'Saved views als header-tabs (v1.73.16)',
    checks: [
      'Klik op de viewnaam of het driehoekje: het view-menu opent',
      'De titel toont geen icoon; naam links, ster en gele punt direct ernaast',
      'Zet in het menu de rechter-switch aan: die view verschijnt als pill naast de titel',
      'Klik een pill: die view wordt actief (blauwe pill)',
      'History zit achter het …-menu in de viewrij, niet meer als switch op de rij',
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
