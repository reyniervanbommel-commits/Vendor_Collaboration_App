# /check-ui — UI design review (Fluent UI v9)

Voer een UI design review uit op recente wijzigingen. Volg skill `ui-design-review`.

## Wat te doen

1. Lees de skill `ui-design-review`
2. Lees `docs/guides/UI_DESIGN_STANDARDS.md`
3. Voer de workflow uit (scope → static audit → golden reference → browser indien mogelijk → rapport)
4. Kies **light** mode als ≤3 UI-bestanden gewijzigd zijn

## Browser in Claude Code

- Heeft de omgeving browser- of Playwright-tools → voer stap 3 (browser audit) uit
- Geen browser beschikbaar → alleen static audit; vermeld **"static only"** in het rapport

## Output

- Rapport: `test-reports/ui-design-review-<feature>-<datum>.md`
- Screenshot (indien browser): `playwright/screenshots/ui-review-<feature>.png`
- Geef verdict: **GOEDGEKEURD** / **VERBETERPUNTEN** / **BLOCKER**
