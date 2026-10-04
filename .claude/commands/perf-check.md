# /perf-check — Performance review (laadtijden & tab-switches)

Meet en verklaar de laadtijden die de gebruiker voelt. Volg skill `perf-review`.

## Wat te doen

1. Lees de skill `perf-review` (inclusief `reference.md` indien nodig)
2. Bepaal de modus (default: **screening**)
3. Voer de workflow uit: voorbereiding → meten → toerekenen → diagnose (top 3) → rapport + baseline → meetgaten
4. Meet elke actie 3× en rapporteer de mediaan

## Modus kiezen

| Argument | Modus |
|----------|-------|
| geen | `screening` — alle routes en tabs |
| `regression` | alleen de baseline-acties hermeten en vergelijken |
| `drilldown <component>` | component-niveau via React `<Profiler>` (tijdelijke codewijziging — meld dit vooraf) |

## Randvoorwaarden

- Dev-server moet draaien (5178) of gebruik een preview-URL — **start hem niet zelf**
- `window.__perf` moet bestaan; anders draai je een productie-build en kan er niet gemeten worden
- Geen browser-tools beschikbaar → alleen statische analyse, vermeld **"static only"** in het rapport

## Output

- Rapport: `test-reports/perf-review-<datum>.md`
- Baseline: `test-reports/perf-baseline.json` (aangemaakt of bijgewerkt)
- Verdict: **STABIEL** / **REGRESSIE** / **VERBETERPUNTEN** / **NIET MEETBAAR**

## Grenzen

Deze skill **past geen optimalisaties toe**. Ze stelt ze voor, met de afweging erbij.
De enige wijzigingen die ze zelf voorstelt zijn extra `time()` / `measure()`-metingen.
</content>
