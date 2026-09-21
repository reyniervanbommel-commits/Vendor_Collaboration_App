// Testchecklist voor de DEV-omgeving. Leeg na een PROD-deploy (schone lei);
// push-feature-to-dev voegt automatisch nieuwe items toe zodra een feature naar DEV gaat.
// Format per item: { id, title, checks: ['wat de tester controleert', ...] }.
// Rechtsonder op DEV opent DevFeatureChecklist deze checks als afvinkbare vakjes.
export const devTestItems = [
  {
    id: 'perf-reload-spinner-v1-71-1',
    title: 'Spinner bij herladen Performance & Planning (v1.71.1)',
    checks: [
      'PO-tabel, tab Performance & Planning: na een filter of celwijziging verschijnt een Fluent-spinner over grafiek en matrix tot het herladen klaar is',
      'De bestaande grafiek en tabel blijven zichtbaar onder de spinner (geen lege flits)',
      'Kolomfilter op status: "Open order" en "Backorder" vinden dezelfde rijen',
      'Een Date W/M-kolom toont een ketting-icoon; hover noemt de bron-datumkolom',
    ],
  },
  {
    id: 'formula-and-or-v1-71-0',
    title: 'AND/OR in de formule-kolom (v1.71.0)',
    checks: [
      'Nieuwe formulekolom, result type Text: IF((qty)>0 AND (status)=\'Open\';\'ok\';\'no\') valideert groen en toont ok op regels die aan beide voorwaarden voldoen',
      'Dezelfde voorwaarde als functie geschreven — IF(AND((qty)>0;(status)=\'Open\');\'ok\';\'no\') — geeft exact hetzelfde resultaat',
      'Result type Yes/No met (qty)>0 AND (qty)<100 toont een Yes/No-cel, niet de tekst "true"',
      'OR werkt in beide vormen; EN en OF doen hetzelfde als AND en OR',
      'AND((b)<>0;(a)/(b)>1) met b = 0 geeft No in plaats van een foutmelding over deling door nul',
      'De functielijst in de dialog toont chips voor AND, OR en TRUE/FALSE; een onbekende functienaam geeft een tip waarin And en Or staan',
      'Bestaande formulekolommen zonder AND/OR tonen onveranderde waarden',
    ],
  },
  {
    id: 'kpi-tile-layout-v1-70-5',
    title: 'KPI-tegel layout op de PO-tabel (v1.70.5)',
    checks: [
      'KPIs-tab: titels staan bovenaan op alle kaarten, de teller is volledig leesbaar en de %-pil staat naast de items-regel',
      'Performance & Planning: kleine tegels naast de grafiek tonen het volledige getal (geen 333.2K) en blijven leesbaar',
      'Lange titels op kleine tegels blijven op één regel; hover toont de volledige titel',
    ],
  },
  {
    id: 'split-panel-kpi-tiles',
    title: 'KPI-tegels in het rechterpaneel van de PO-tabel (#315)',
    checks: [
      'Open de PO-tabel, klap het onderpaneel uit en kies de tab "Performance & Planning" — rechts staan de gekozen KPI-tegels',
      'Als admin: open de vouw in de hoek van een KPI-kaart en zet "Show in PO table panel" aan/uit — de tegel verschijnt/verdwijnt direct in het paneel',
      'Meer dan 3 tegels aanzetten lukt niet; de keuze blijft na een refresh bewaard',
      'Als medewerker of supplier: de tegels zijn zichtbaar, maar de toggle is er niet en er komt geen 403 in de console',
      'Klik op een tegel — de PO-tabel filtert en de aantalkolommen tonen de eenheden van die tegel',
    ],
  },
  {
    id: 'kpi-confirmed-date-mode',
    title: 'KPI-tegels omdraaibaar tussen confirmed en requested datum',
    checks: [
      'Zet de C/R-schakelaar boven de KPI-tab om — de tegelwaarden wijzigen naar de confirmed-datumbasis',
      '"Not confirmed" telt alleen nog open regels zonder bevestigde datum (geleverde regels tellen niet meer mee)',
      'De tegels op de RCCP-pagina laten dezelfde waarden zien als die in het PO-tabel-paneel',
    ],
  },
  {
    id: 'collapsed-detail-rollup',
    title: 'Snellere PO-tabel door rollup van ingeklapte detailregels',
    checks: [
      'Open de PO-tabel met ingeklapte orders — totalen per order zijn gelijk aan vóór deze wijziging',
      'Klap een order open — de detailregels laden en tellen op tot hetzelfde totaal',
      'De PO-tabel voelt niet langzamer dan voorheen bij een grote selectie (DevTools → Network → Timing)',
    ],
  },
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
