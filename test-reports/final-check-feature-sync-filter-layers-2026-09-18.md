# Final check — sync filter layers (D365 PO-sync, werkitem #325)

**Scope:** 12 bestanden (`git diff --name-only origin/develop...HEAD`), schaalniveau **feature/risicovol** (backend routes + service + frontend hook/componenten).
**Skills aangeroepen:** eigen checks (stap 1), security-review (subagent), lichte UI-check tegen `fluentui-valkuilen.mdc`.
**Skills ontbraken / niet uitgevoerd:** `browser-feature-test` — geen werkende inlog op de Azure-preview-DB en een reeds lokaal draaiende dev-server hoort bij een andere worktree (niet deze feature-branch); geen server zelf gestart (regel). `ui-design-review`/`perf-review` niet als losse subagent-run uitgevoerd (geen apart subagent-type beschikbaar); wel handmatig tegen de standaarden getoetst.

| Onderdeel | Verdict |
|-----------|---------|
| Eigen checks | ok — nieuwe/gewijzigde UI-bestanden ruim onder 300 regels (130–194); geen dode code na verwijderen "add template as layer"; versie al verhoogd (v1.62.2); geen onnodige apiRequests in loops |
| UI | ok — geen Tooltip/portal-valkuilen, consistente `size="small"`-styling met de rest van het panel |
| Snelheid | ok (screening, statisch) — admin-instellingenpagina, geen hot path; count-calls na save bewust parallel via `Promise.all`, gebruiker-getriggerd |
| Security | ok — subagent-review: geen medium/high/critical issues. Routes admin-only, `{ layers }`-payload correct genormaliseerd/gevalideerd, SQL geparameteriseerd |
| Browser | **niet uitgevoerd** — zie beperking hierboven |
| Cleanup | ok — geen zwerfbestanden, werkdirectory schoon |

**Gedaan:**
- 2 root-causes gevonden en opgelost na jouw testfeedback: (1) route wrapte `{ layers }` niet correct → 2e laag werd als 1 kapotte laag opgeslagen; (2) `useDataModelAdmin` herlaadde nooit na save → UI toonde stale data na tab-wissel.
- Regressietest toegevoegd die het layers-vs-legacy-array-contract vastlegt.
- "Add template as layer" verwijderd op jouw verzoek (verwarrend, niet nodig).
- Security-review: geen blokkerende bevindingen.

**Open:**
- Geen browser-e2e-bevestiging van deze final-check (alleen unit-tests + eerdere handmatige/API-controle). Aanbevolen: kort handmatig testen op de preview-URL met geldige DEV-inloggegevens, of lokaal via `npm run dev:all` in déze worktree (`feature-325`).
- `TableDataService.js`-functies die in deze feature zijn herschreven (`saveSyncFilters`, `countSyncFilter`, `unmarkInScopeCacheRows`) hebben geen directe unit-tests (alleen de onderliggende pure `odataSyncFilter.js`-functies zijn getest — dat was ook de bron van de eerdere bug). Niet blokkerend, wel een aandachtspunt voor een vervolg-PR.
- `odataSyncFilter.js` is door deze feature gegroeid naar 340 regels (utility-bestand, geen UI-component); geen harde regel voor niet-UI-bestanden, maar wel de moeite van het in de gaten houden.
