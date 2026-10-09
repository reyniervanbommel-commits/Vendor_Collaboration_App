# @mentions in opmerkingen — design

Datum: 2026-10-07 · Status: ontwerp; deel 1 besproken, deel 2 (UI) volgt de aanbevelingen — door gebruiker na te lezen
Bouwt voort op: `2026-10-07-supply-chain-remark-visibility-design.md`, `2026-10-07-remark-replies-design.md`

## Doel

Een opmerking met `@<waarde>` (bv. `@SFM-12542-00-01`) wordt in één keer geplaatst op alle purchase orders die die waarde hebben, zodat één bericht alle betrokken PO's (en vendors) bereikt.

## Beslissingen (afgestemd met gebruiker)

1. **Momentopname**: de opmerking komt op de PO's die de waarde hebben op het moment van plaatsen (plus de huidige PO).
2. **Mentionable kolommen** worden door een admin aangewezen (vinkje in Data model); standaard alleen **Artikel** (`itemNumber`, regelniveau).
3. Een **Vendor**-opmerking mag bij **meerdere vendors** landen, met waarschuwing vooraf ("… from 3 vendors").
4. **Replies en reacties per PO**: elke PO heeft zijn eigen gesprek onder de opmerking.
5. **Meerdere mentions combineren** (2026-10-08): verschillende kolommen = **EN**, dezelfde kolom = **OF**. Regelkolommen moeten op **dezelfde orderregel** kloppen (bv. `@artikel @Backorder` = PO's met een regel van dat artikel met regelstatus Backorder); kopkolommen op de PO zelf.

## Model: groep kopieën

Bij plaatsen met mentions maakt de server **één remark-rij per doel-PO**, gekoppeld via `broadcast_id`. Gevolg: zichtbaarheid, replies, reacties, tellers, zoeken, laatste-opmerking en polling werken ongewijzigd per PO; vendors zien nooit elkaars replies of reacties.

## Datamodel — migratie `055_remark_mentions.sql` (idempotent)

- `tb_columns.mentionable BIT NOT NULL DEFAULT 0`; zet `mentionable = 1` voor `purchase-orders` · `detail` · `itemNumber` (alleen als die kolom bestaat; eenmalig: alleen wanneer de kolom net is toegevoegd).
- `tb_row_remarks.broadcast_id UNIQUEIDENTIFIER NULL` + index `IX_tb_row_remarks_broadcast (broadcast_id) WHERE broadcast_id IS NOT NULL`.
- `tb_row_remark_mentions (id BIGINT IDENTITY PK, broadcast_id UNIQUEIDENTIFIER NOT NULL, column_id BIGINT NOT NULL FK tb_columns, value NVARCHAR(200) NOT NULL)` + index op `broadcast_id`.

## Server

### Mentionable kolommen
Actieve kolommen met `source = 'source'`, `data_type = 'text'`, `mentionable = 1` (master of detail). Waarde in `tb_cache.data_json` op pad `$.{column.key}` (zelfde aanpak als `listDistinctCacheFieldValues`). Admin-route `PATCH /:tableKey/columns/:id/mentionable` (admin-only), patroon gelijk aan `vendor-editable`; weigert niet-text/custom/remarks-kolommen met 400.

### Endpoints
- `GET /:tableKey/remarks/mentions?q=<min 2 tekens>` (comments.write) → `{ suggestions: [{ columnId, columnLabel, value, orderCount }] }`, max 10, prefix-match (`LIKE q + '%'`, case-insensitive), alleen niet-verwijderde rijen. Supplier: alleen waarden en tellingen binnen eigen zichtbare PO's.
- `POST /:tableKey/remarks/mentions/preview` body `{ mentions: [{ columnId, value }] }` → `{ orderCount, vendorCount }` inclusief de huidige PO. Supplier krijgt `vendorCount: 1`.
- `POST /:tableKey/remarks` accepteert `mentions: [{ columnId, value }]` (max 5) — alleen voor nieuwe opmerkingen, niet voor replies (`parentId` + `mentions` → 400).

### Plaatsen met mentions
1. Valideer elke mention: kolom bestaat, hoort bij deze tabel, is mentionable → anders 400 `This value cannot be mentioned`.
2. Resolve doel-PO's uit `tb_cache` in één query: kopvoorwaarden op de master, regelvoorwaarden samen in één `EXISTS` op dezelfde detailregel; per kolom een `IN`-lijst (detail-kolom → master van die regel; `removed_at_source = 0`). Supplier: filter op eigen zichtbare PO's. Voeg huidige PO toe.
3. Een mention zonder treffers → 400 `No purchase orders found for @{value}`. Meer dan **200** PO's → 400 `Too many purchase orders (max 200)`.
4. Zichtbaarheid volgens bestaande schrijfregels (supplier → vendor, employee → internal, admin/supply_chain → verplichte keuze).
5. Eén transactie: `broadcast_id = randomUUID()`; insert één rij per doel-PO (zelfde body, auteur, visibility, `broadcast_id`); insert mentions; return de remark van de huidige PO.

### Lezen
DTO-uitbreiding: `broadcastId`, `mentions: [{ columnLabel, value }]` (voor iedereen die de remark ziet — de waarde staat al in de tekst), `broadcastCount` (aantal PO's in de groep) **alleen voor staff** (vendor ziet geen aantallen van andere vendors).

### Verwijderen
Remark met `broadcast_id`: auteur of admin verwijdert **alle** kopieën (soft delete) in één statement. Response bevat `deletedCount`.

## UI (Engels)

### Suggesties bij `@` (hoofd-composer, niet in reply-venster)
- Na `@` + minstens 2 tekens: popover onder het tekstvak (`role="listbox"`), max 10 regels: **waarde** · kolomnaam · `{n} POs`. Debounce 200 ms; laadstatus "Searching…"; geen resultaten: "No matches".
- Toetsenbord: ↑/↓ navigeren, Enter/Tab kiezen, Esc sluiten (stopt propagatie). Muisklik kiest.
- Kiezen vervangt `@<getypt>` door `@<waarde> ` en registreert de mention. Bij plaatsen tellen alleen mentions waarvan `@<waarde>` nog in de tekst staat.

### Bereik vooraf
- Zodra er ≥ 1 mention is: regel boven de knop — **"Will be posted on 14 purchase orders from 3 vendors"** (staff) of **"Will be posted on 4 of your purchase orders"** (vendor). Bij > 200: foutregel, knop uit.
- Vendor-zichtbaarheid + meer dan 1 vendor: regel krijgt waarschuwingskleur (amber) zodat het bewust gebeurt.

### Weergave
- In de tekst wordt `@waarde` als **chip** getoond (alleen waarden uit `remark.mentions`).
- Onder de tekst (staff): **"Posted on 14 purchase orders"** (muted).
- Verwijderbevestiging bij groep: **"Delete this remark on all 14 purchase orders?"**.

### Data model (admin)
- Kolomrij krijgt vinkje **"Mentionable"** (zelfde plek/patroon als *Vendor editable*), alleen voor text-bronkolommen; info-tekst: "Allow @mentions of this column's values in remarks."

## Tests (kern)
- Server: mentionable-validatie; resolve detail→master; supplier-scope; huidige PO altijd erbij; 0 treffers/ > 200 → 400; transactie maakt N rijen met één `broadcast_id`; replies + mentions → 400; delete verwijdert groep; `broadcastCount` niet voor supplier; suggesties prefix + limiet + supplier-scope; preview-tellingen.
- Frontend: popover openen/sluiten, toetsenbord, invoegen, mention vervalt als tekst weg is, preview-regel (staff/vendor/amber/limiet), chips, "Posted on" regel, groepsverwijdertekst, Mentionable-vinkje.

## Buiten scope
- Dynamisch (later toegevoegde PO's), mentions in replies, klikbare chips (board filteren), notificaties, bewerken van mentions achteraf, opzoektabel voor snelheid (pas bij gemeten traagheid).
