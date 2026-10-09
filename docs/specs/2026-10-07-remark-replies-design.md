# Replies op opmerkingen (remarks) — design

Datum: 2026-10-07 · Status: goedgekeurd ontwerp (wacht op spec-review)
Bouwt voort op: `docs/specs/2026-10-07-supply-chain-remark-visibility-design.md`

## Doel

Gebruikers kunnen in het opmerkingenpanel van een PO direct reageren op een opmerking, zodat een gesprek bij elkaar blijft in plaats van los in de tijdlijn te staan. De zichtbaarheidsregels (Vendor / Internal) mogen daarbij nooit omzeild worden.

## Beslissingen (afgestemd met gebruiker)

1. **Eén niveau diep** (Teams-stijl): replies staan onder de oorspronkelijke opmerking; op een reply kan niet opnieuw gereageerd worden.
2. **Gesprek schuift naar boven** bij een nieuwe reply (volgorde op laatste activiteit). Teller en "laatste opmerking"-kolom tellen replies mee.
3. **Reageren mag ook in de toggle-stand All**; het reply-venster toont waar de reply terechtkomt (Internal / Vendor).

## Datamodel — migratie `054_tb_row_remarks_replies.sql` (idempotent)

- `parent_id BIGINT NULL` → FK naar `dbo.tb_row_remarks(id)` (`NO ACTION`; remarks worden alleen soft-deleted). `NULL` = begin van een gesprek (root).
- `last_activity_at DATETIME2 NULL` → gevuld voor roots: bij insert = `created_at`, bij elke nieuwe reply = moment van die reply. Backfill: alle bestaande rijen `last_activity_at = created_at`. Daarna `NOT NULL` met default `SYSUTCDATETIME()` (zelfde rollout-reden als 053: oude code insert zonder kolom). Voor replies niet gebruikt in sortering.
- Index `IX_tb_row_remarks_parent` op `(parent_id) INCLUDE (created_at, is_deleted, visibility)` WHERE `parent_id IS NOT NULL`.
- Index `IX_tb_row_remarks_thread` op `(table_id, partition_key, record_key, detail_key, last_activity_at DESC, id DESC)` WHERE `parent_id IS NULL`.
- Statements die nieuwe kolommen gebruiken in `EXEC(N'...')` (run-migrations draait alles als één batch, geen `GO`).

## Server

### Plaatsen (`RowRemarksService.addRemark`, nieuw veld `parentId`)

- Zonder `parentId`: ongewijzigd (zichtbaarheidsregels uit de vorige spec).
- Met `parentId`, binnen één transactie (`SERIALIZABLE`, `UPDLOCK` op de parent):
  1. Parent bestaat, staat op **dezelfde tabel + rij**, valt binnen het **leesfilter van de actor** (`visibility`) → anders **404 `Remark not found`**.
  2. Parent is verwijderd → **409 `Replying to a deleted remark is not allowed`**.
  3. Is de parent zelf een reply, dan wordt `parent_id` = root van die parent (altijd één niveau).
  4. `visibility` = visibility van de root; meegestuurde `visibility` wordt genegeerd (voor alle rollen, ook admin/supply_chain).
  5. Insert reply; `UPDATE root SET last_activity_at = SYSUTCDATETIME()`.
- Route `POST /:tableKey/remarks` accepteert optioneel `parentId` (positief geheel getal, anders 400).

### Lezen

- **`listRemarks`** (tab Remarks): pagineert **roots** op `(last_activity_at DESC, id DESC)` binnen het leesfilter; haalt daarna in één query alle replies van die roots op (zelfde leesfilter, incl. tombstones), oud → nieuw. Response:
  - `items`: roots, elk met `replies: Remark[]` en `replyCount`.
  - `total`: aantal zichtbare remarks **inclusief** replies (tabteller).
  - `nextCursor`: cursor op `last_activity_at` + `id` van de laatste root.
- **`summarizeRemarks`, search, has-comment**: tellen replies als gewone remarks (geen wijziging nodig behalve dat ze niet uitgesloten worden).
- **Activity-feed (tab All)**: replies blijven losse chronologische items, met extra veld `replyTo: { id, authorName }` voor de "↳ Reply to …"-regel.
- **Reacties en verwijderen**: ongewijzigd, werken ook op replies. Verwijderde root blijft als tombstone met zijn replies zichtbaar.
- DTO-uitbreiding: `parentId` (null voor root), `replyTo` (alleen in activity), `replies`/`replyCount` (alleen roots in listRemarks).

### Polling

`useRowRemarks` ontvangt via de bestaande activity-delta (`afterCursor`) nieuwe remarks. Een delta-item met `parentId` wordt in de `replies` van de juiste root gezet en die root schuift naar boven; een onbekende root (nog niet geladen) triggert een refresh van de eerste pagina.

## UI

### Gesprek (tab Remarks)

- Root-kaart zoals nu (naam, datum eronder, badge, accent).
- Replies ingesprongen (24px, smal paneel 16px) met links een verticale lijn in de visibility-kleur van de root (amber = Internal, blauw = Vendor; neutraal voor rollen zonder visibility).
- Replies oud → nieuw, kleinere avatar (24), geen visibility-badge.
- Meer dan 2 replies: alleen de laatste 2 zichtbaar + link **"Show N earlier replies"** erboven.
- Een nieuw geplaatste reply wordt kort gemarkeerd (respecteert `prefers-reduced-motion`).

### Reageren

- Knop **↩ Reply** (subtle, naast Like) alleen op roots; verborgen bij verwijderde root of zonder `comments.write`.
- Klik opent een inline reply-venster onder het gesprek met focus in het tekstvak. Kop: **"Replying to {naam}"**; voor admin/supply_chain plus visibility-chip (🔒 Internal / 👁 Vendor) in dezelfde kleuren als de badges.
- Knoppen **Reply** (primary) en **Cancel**; **Ctrl/Cmd+Enter** plaatst, **Esc** annuleert.
- Max. één reply-venster tegelijk open.
- Na succes: venster sluit, reply onderaan het gesprek, focus terug naar de Reply-knop. Bij fout: tekst blijft staan, foutmelding (`role="alert"`).
- Ook beschikbaar in toggle-stand **All** (nieuwe root-post blijft daar uitgeschakeld).

### Toggle All / Vendor / Internal

Filtert per gesprek (root.visibility); replies volgen hun root.

### Tab All (tijdlijn)

Replies als losse items met regel **"↳ Reply to {naam}"** boven de tekst; geen inspringen.

### Toegankelijkheid

- Reply-knop `aria-label="Reply to {naam}"`.
- Replies-lijst `role="list"` met `aria-label="Replies to {naam}'s remark"`.
- Focusbeheer zoals hierboven; alle teksten Engels.

## Tests

**Server**
- Reply op root: erft visibility (ook als vendor/employee/admin iets anders stuurt); `last_activity_at` van root bijgewerkt.
- Reply op reply → wordt gekoppeld aan root.
- Parent op andere rij/tabel, onzichtbaar voor actor, of niet bestaand → 404; verwijderde parent → 409.
- `listRemarks`: roots gesorteerd op `last_activity_at`, replies oud → nieuw, leesfilter op roots én replies, `total` inclusief replies, cursor per root.
- Route: `parentId` validatie (400 bij ongeldig) en doorgifte.
- Activity: reply-items krijgen `replyTo`.

**Frontend**
- Reply-knop alleen op roots, niet bij tombstone of zonder schrijfrechten.
- Reply-venster: focus, Ctrl+Enter, Esc, Cancel, foutpad, één tegelijk, visibility-chip alleen admin/supply_chain.
- Inklappen bij > 2 replies.
- Toggle filtert per gesprek.
- Polling-delta met `parentId` komt in juiste gesprek; gesprek schuift naar boven.

## Buiten scope

- Notificaties/e-mail bij replies.
- @mentions.
- Bewerken van opmerkingen of replies.
- Replies verplaatsen of gesprekken samenvoegen.
