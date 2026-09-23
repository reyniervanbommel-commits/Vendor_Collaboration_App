// Testchecklist voor de DEV-omgeving. Leeg na een PROD-deploy (schone lei);
// push-feature-to-dev voegt automatisch nieuwe items toe zodra een feature naar DEV gaat.
// Format per item: { id, title, checks: ['wat de tester controleert', ...] }.
// Rechtsonder op DEV opent DevFeatureChecklist deze checks als afvinkbare vakjes.
export const devTestItems = [
  {
    id: 'feature-328-comment-permissions-v1-73-0',
    title: 'Feature 328 - Comment-rechten per gebruiker (v1.73.0)',
    checks: [
      'Instellingen > Users: bij een employee opent Manage permissions een Comments-sectie met View comments, Add comments en Show comments column',
      'Add comments of Show comments column aanzetten zet View comments ook aan; View comments uitzetten zet de andere twee uit',
      'Bij een vendor zie je alleen die drie comment-opties, geen OData-vinkje, en Save werkt',
      'Bij een admin zie je geen comment-vinkjes',
      'Zet View comments uit bij een employee, herlaad als die gebruiker: geen remarks-badge, geen Remarks in het celmenu, wel de orderhistorie',
      'Zet Show comments column uit: de remarks-kolom staat niet meer op het board',
    ],
  },
  {
    id: 'kpi-pill-position-v1-73-1',
    title: 'KPI-pil positie op PO-tabel (v1.73.1)',
    checks: [
      'Purchase orders → tab KPIs: de gekleurde %-pil op de KPI-kaarten staat boven de balk, niet erop',
      'Performance & Planning op de PO-tabel en de aparte RCCP-pagina: pil-positie is ongewijzigd',
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
