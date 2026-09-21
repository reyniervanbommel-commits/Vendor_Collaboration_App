# Final check — AND/OR in de formule-kolom

**Datum:** 2026-09-21
**Versie:** v1.71.0
**Branch:** `develop` (geen feature-branch; ad-hoc lokaal werk, niets gecommit)
**Plan:** `~/.cursor/plans/and_formule-kolom_5fa3d1c2.plan.md` — child van Feature #187

**Scope (8 bestanden):**

| Bestand | Wijziging |
|---|---|
| `server/utils/tableFormulaEngine.js` | parseOr/parseAnd, lazy dispatch, toBoolean, hasOwnProperty-guard |
| `server/utils/tableFormulaEngine.test.js` | +22 tests |
| `server/utils/tableColumnFormulaValidation.test.js` | nieuw, 9 tests |
| `src/components/supplier/purchaseOrderFormulaFunctions.js` | 3 chips (AND, OR, TRUE/FALSE) |
| `src/components/supplier/PurchaseOrderFormulaColumnDialog.jsx` | hint op Formula + Result type |
| `src/components/supplier/purchaseOrderFormulaValidationTips.js` | functienamen in de tip |
| `src/components/onboarding/guidesBoard.js` | cheatsheet-regel |
| `src/config/version.js` | v1.70.7 → v1.71.0 |

*Niet in scope:* de RccpKpiCard/kpiQtyFormat-wijzigingen die al in de working tree stonden.

**Skills aangeroepen:** `security-review` (gescoped op de feature-diff), `ui-design-review` (light, static only)
**Niet uitgevoerd:** `browser-feature-test` en `perf-review` browser-modus — geen browser-automatisering in deze sessie; dev-server draait wel op 5178 maar mag niet door de agent gestart/bestuurd worden

| Onderdeel | Verdict |
|-----------|---------|
| Eigen checks | ok, met 2 groottewaarschuwingen |
| UI | verbeterpunten — beide nu gefixt |
| Snelheid | ok (statisch onderbouwd, geen meting nodig) |
| Security | geen bevindingen; 1 harden-fix toegepast |
| Browser | niet uitgevoerd — handmatige checklist hieronder |
| Cleanup | ok |

---

## Stap 1 — Eigen checks

- **Bestandsgrootte:** `tableFormulaEngine.js` 600 → 715 regels. Ruim boven de 300-norm, in het plan
  vastgelegd als bewuste uitzondering (een split van tokenizer/parser/eval in dezelfde PR als een
  parserwijziging is shotgun surgery). → tech-debt-item onder Feature #142.
  `PurchaseOrderFormulaColumnDialog.jsx` 279 → 284 regels: boven de waarschuwingsgrens van 250,
  onder de 300. Deze wijziging voegde er 5 aan toe (hint-prop). Pre-existing, niet nu splitsen.
- **Dode code:** geen. De oude `IF`-tak in `evalNode` is verwijderd, niet blijven staan naast de
  nieuwe dispatch-entry.
- **Tests:** engine 46, validatie 9 (nieuw bestand voor een util die er nog geen had),
  TableDataService 105 — alle groen. `npm run test:changed`: 13 bestanden, 107 tests groen.
  `npm run build`: groen in 1m30.
- **Versie:** v1.71.0 (MINOR — nieuwe functionaliteit).
- **Statische snelheid:** geen extra `apiRequest`-calls, geen werk in loops, geen nieuwe state.

## Stap 2 — UI (light, static)

Getoetst tegen `docs/guides/UI_DESIGN_STANDARDS.md` en `.cursor/rules/fluentui-valkuilen.mdc`.

- **OK** — chips gebruiken het `title`-attribuut binnen een `.map()`, precies zoals §"Tooltip in
  lists" voorschrijft (nooit `<Tooltip>` in een lijst). De nieuwe chips erven dat patroon.
- **OK** — alle nieuwe strings Engels; geen inline styles, geen hardcoded kleuren, geen nieuwe
  componenten of tokens.
- **VERBETERPUNT (gefixt)** — de AND-chipbeschrijving was 167 tekens tegen maximaal 94 bij de
  bestaande chips. Ingekort naar 87 (AND) en 93 (OR), nu binnen de bandbreedte van de rest.
- **VERBETERPUNT (gefixt)** — de Yes/No-aanwijzing stond eerst in de hint van het **Formula**-veld,
  terwijl de keuze bij **Result type** gemaakt wordt. Verplaatst naar dat veld; de Formula-hint is
  weer kort.

Golden reference: `RccpSettingsForm.jsx` (Field + hint-patroon) — komt overeen.

**Verdict:** GOEDGEKEURD na de twee fixes.

## Stap 3 — Snelheid

Geen meting uitgevoerd; ook niet nodig, want de hot path krijgt geen extra werk:

- Parsen gebeurt één keer per read via `compileFormulaColumns` (`TableDataService.js:3864`), niet
  per rij. De twee extra parserlagen kosten dus niets meetbaars, ook niet bij 2000 rijen.
- Evaluatie wordt door short-circuit eerder sneller: een AND stopt bij de eerste onware voorwaarde.
- Geen nieuwe API-route, geen nieuwe SQL, geen extra render-werk (3 chips in een bestaande lijst).

## Stap 4 — Security

Beoordeeld op de feature-diff. De skill vergelijkt standaard tegen `main`, wat hier 557KB aan
niet-gerelateerde develop-commits meetrok; die zijn buiten scope gelaten.

Aanvalsoppervlak is de formule-string, die een ingelogde gebruiker via de dialog indient.

- **Geen bevindingen.** Geen `eval`/`Function`, geen SQL, geen nieuwe route, geen auth-wijziging.
  De bestaande guards (`MAX_FORMULA_LENGTH` 2000, `MAX_TOKENS` 1024, `MAX_EVAL_DEPTH` 64) zijn
  ongewijzigd en dekken de nieuwe AST-knopen mee.
- **Harden-fix toegepast:** `FORMULA_FUNCTIONS[node.name]` is een lookup met user-input als sleutel,
  en is door het weghalen van de `IF`-special-case nu het enige pad. Er was geen exploit — namen
  worden ge-uppercased en Object.prototype kent geen uppercase leden — maar die redenering is te
  fragiel om op te leunen. Nu via `Object.prototype.hasOwnProperty.call(...)`, hetzelfde patroon
  dat de kolomreferentie-lookup in ditzelfde bestand al gebruikt. Vastgelegd in een test.

## Stap 5 — Browser

Niet uitgevoerd: geen browser-automatisering beschikbaar in deze sessie. Functionele dekking komt
nu van 160 servertests, waaronder de volledige AC-set. Handmatig te bevestigen (dev-server draait
al op 5178):

1. PO-board → kolomkop → `+ Add column right` → **Formula**
2. Result type **Text**, formule `IF((qty)>0 AND (status)='Open';'ok';'no')` → **Check formula** → groen
3. Opslaan → board toont `ok` op regels die aan beide voorwaarden voldoen
4. Tweede kolom, Result type **Yes/No**, formule `(qty)>0 AND (qty)<100` → toont Yes/No, niet "true"
5. Typ een onzin-functie (`FOO()`) → tip noemt And/Or in de lijst

## Stap 6 — Cleanup

Eén nieuw bestand (`tableColumnFormulaValidation.test.js`) en dat hoort erbij. Geen debug-logs,
geen wegwerpscripts, geen screenshots.

---

**Gedaan:** engine (parser + lazy dispatch + toBoolean + harden-fix), UI-teksten, 31 nieuwe tests,
versie, twee UI-verbeterpunten gefixt.

**Open:**
- Handmatige browsercheck (5 stappen hierboven).
- Tech-debt-item voor het splitsen van `tableFormulaEngine.js` onder Feature #142 — nog niet
  aangemaakt.
- Niets gecommit of gepusht.
