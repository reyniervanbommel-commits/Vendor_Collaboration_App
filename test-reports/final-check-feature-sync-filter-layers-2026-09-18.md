# Final check - sync filter layers (D365 PO-sync, werkitem #325)

**Scope:** 12 bestanden (`git diff --name-only origin/develop...HEAD`), schaalniveau **feature/risicovol** (backend routes + service + frontend hook/componenten).
**Skills aangeroepen:** eigen checks (stap 1), security-review (subagent), lichte UI-check tegen `fluentui-valkuilen.mdc`, handmatige browsertest op de preview-URL.
**Skills ontbraken:** `ui-design-review`/`perf-review` niet als losse subagent-run uitgevoerd (geen apart subagent-type beschikbaar); wel handmatig tegen de standaarden getoetst.

| Onderdeel | Verdict |
|-----------|---------|
| Eigen checks | ok - nieuwe/gewijzigde UI-bestanden ruim onder 300 regels (130-194); geen dode code na verwijderen "add template as layer"; versie al verhoogd (v1.62.2); geen onnodige apiRequests in loops |
| UI | ok - geen Tooltip/portal-valkuilen, consistente `size="small"`-styling met de rest van het panel |
| Snelheid | ok (screening, statisch) - admin-instellingenpagina, geen hot path; count-calls na save bewust parallel via `Promise.all`, gebruiker-getriggerd |
| Security | ok - subagent-review: geen medium/high/critical issues. Routes admin-only, `{ layers }`-payload correct genormaliseerd/gevalideerd, SQL geparameteriseerd |
| Browser | ok - handmatig getest op de preview-URL met credentials van de gebruiker: 2e laag toegevoegd, regel ingevuld, opgeslagen, gewisseld naar Vendors-tab en terug - beide lagen bleven staan, "Saved"-melding en per-laag tellingen correct, geen console-errors. Testlaag na afloop weer verwijderd en opgeslagen zodat de DEV-database niet met een testfilter blijft zitten. |
| Cleanup | ok - geen zwerfbestanden, werkdirectory schoon |

**Gedaan:**
- 2 root-causes gevonden en opgelost na testfeedback: (1) route wrapte { layers } niet correct, waardoor de 2e laag als 1 kapotte laag werd opgeslagen; (2) useDataModelAdmin herlaadde nooit na save, waardoor de UI na een tab-wissel stale data toonde.
- Regressietest toegevoegd die het layers-vs-legacy-array-contract vastlegt.
- "Add template as layer" verwijderd op verzoek (verwarrend, niet nodig).
- Security-review: geen blokkerende bevindingen.
- Browsertest op de preview: bug bevestigd opgelost (2e laag blijft staan na tab-wissel).

**Open:**
- `TableDataService.js`-functies die in deze feature zijn herschreven (saveSyncFilters, countSyncFilter, unmarkInScopeCacheRows) hebben geen directe unit-tests (alleen de onderliggende pure odataSyncFilter.js-functies zijn getest - dat was ook de bron van de eerdere bug). Niet blokkerend, wel een aandachtspunt voor een vervolg-PR.
- odataSyncFilter.js is door deze feature gegroeid naar 340 regels (utility-bestand, geen UI-component); geen harde regel voor niet-UI-bestanden, maar wel de moeite van het in de gaten houden.
