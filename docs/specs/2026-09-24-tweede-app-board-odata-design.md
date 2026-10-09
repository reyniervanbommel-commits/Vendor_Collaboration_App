# Tweede app — generiek bord + eigen OData-bron

**Status:** ontwerp, nog geen bouw  
**Datum:** 2026-09-24  
**Huidige app:** Vendor Collaboration App blijft bestaan en blijft D365-PO. Deze repo wordt niet verbouwd voor de 2e app.

## BRD

Er komt een tweede applicatie waarvan het hart het bestaande bord is (views, filters, custom kolommen, formules, master+detail), niet het PO-domein.

Data komt via OData uit **Mendix PLM** (`plm.mendixcloud.com`, service `Published_OData_service/v1/Materials`). Tabellen zijn materialen/modellen, geen PO’s. Extra kolommen mogen lokaal in onze SQL blijven. Terugschrijven naar Mendix is in deze published service **uitgezet** (zie TD).

Gebruikers zijn nieuw/anders; eigen login. Geen Performance/RCCP en geen BI.

## FRD

### Wat de 2e app wél heeft

- Bord als startpagina (generieke naam, geen “purchase orders”)
- Master + detail (kop + regels)
- Inloggen, admin/user, Settings
- Table Builder (later meer tabellen; niet het v1-doel)
- Onboarding/tours, herschreven naar het nieuwe object
- SQL-cache + handmatige/periodieke refresh (bord leest uit cache)
- Lokale extra kolommen; schrijven naar Mendix alleen als de published service dat later toestaat

### Wat de 2e app níet heeft (v1)

- Performance & Planning (RCCP)
- BI
- D365-connector, vendor-verrijking, product attributes
- Gedeelde login / SSO met de Vendor Portal
- Automatische bord-fixes terug naar de Vendor Portal

### v1-scope

Eén master+detail uit Mendix, plus login, cache-refresh, lezen. Table Builder en extra materiaal-tabellen daarna.

**Bevestigd v1:** Models (kop, ~6.3k) + Variants (regels, ~20.7k). Alleen lezen uit Mendix + lokale extra kolommen. Schrijven naar Mendix later, als de published service dat toestaat.

### Rollen

- **admin** — Settings, refresh, later Table Builder
- **user** — bord

## TD

### Aanpak

1. Nieuw git-repo als kopie van deze template.
2. In de kopie D365/RCCP/BI en PO-specifieke stukken weghalen.
3. Bord-laag bron-agnostisch houden, zodat later een gedeelde package mogelijk is. Nu niet extraheren (Vendor Portal blijft ongemoeid).
4. Nieuwe connector: Mendix OData 4, Basic auth, `$metadata` op `…/Materials/$metadata`.
5. Cache-model: OData → SQL → bord. `$filter`, `$orderby`, `$top`, `$skip`, `$count` worden ondersteund; `$search` en batch niet.

### Mendix-bron (gecontroleerd 2026-09-24)

| EntitySet | Rijen (approx.) | Rol |
|---|---|---|
| Models | 6.268 | Artikelmodellen (kop) |
| Variants | 20.663 | Kleuren/varianten per model (detail) |
| PriceCalculations | 14.828 | Kostprijs per variant |
| PriceCalculationLines | 290.462 | Kostprijsregels |
| Leathers / Soles / Lasts / … | 0,3k–10k | Materialen (lookups) |

Alle EntitySets: **niet insertable, niet updatable, niet deletable**. Schrijven vereist een andere Mendix-service of dat write in deze publicatie wordt aangezet.

Credentials: alleen in env van de nieuwe app, nooit in git. Niet in dit document.

### Azure

| | |
|---|---|
| Subscription | VanBommel Azure CSP (`b4fd8e40-f6b2-4fec-8f20-a1270ad38234`) |
| Resource group | `DESIGN-PD-app` (aangemaakt 2026-09-24) |
| Locatie | `northeurope` |
| Nog te plaatsen | SQL, Key Vault, Container Apps Environment, DEV/PROD apps |

Eigen stack, niet delen met `vanbommel-vendorportal`.

### Open punten

- Wanneer schrijven in Mendix wordt aangezet (niet v1)

### Werknaam

**DESIGN-PD-app** — Azure resource group én app-naam.

## Niet in deze repo

Geen codewijzigingen in de Vendor Portal voor dit spoor. Dit bestand is alleen het ontwerp van de spin-off.
