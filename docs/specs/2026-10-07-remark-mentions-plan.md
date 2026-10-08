# @mentions in opmerkingen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@waarde` in een nieuwe opmerking plaatst die opmerking als groep kopieën (één per PO, gedeeld `broadcast_id`) op alle PO's met die waarde, met suggesties, bereik vooraf en admin-instelbare mentionable kolommen.

**Architecture:** Nieuwe service `RemarkMentionsService` (kolommen, suggesties, doel-PO's resolven, preview). `RowRemarksService.addRemark` plaatst bij `mentions` in één transactie N rijen via `OPENJSON`. Lees-/zichtbaarheidslogica blijft per rij ongewijzigd; DTO krijgt `broadcastId`, `mentions`, `broadcastCount` (staff). Client: pure tekst-helpers `mentionText.js`, hooks voor suggesties/preview, `MentionSuggestions`-popover in `RemarkComposer`, chips in `RemarkMessageCard`, vinkje in Data model.

**Tech Stack:** Express + `mssql` (Azure SQL: `JSON_VALUE`, `OPENJSON`), React 18 + Fluent UI v9, Vitest.

**Spec:** `docs/specs/2026-10-07-remark-mentions-design.md`

## Global Constraints

- UI-tekst Engels. Teksten: `Searching…`, `No matches`, `Will be posted on {n} purchase orders from {v} vendors` (enkelvoud: `1 purchase order`, `1 vendor`), `Will be posted on {n} of your purchase orders`, `Too many purchase orders (max 200)`, `No purchase orders found for @{value}`, `This value cannot be mentioned`, `Posted on {n} purchase orders`, `Delete this remark on all {n} purchase orders?`, `Mentionable`, `Allow @mentions of this column's values in remarks.`
- Max 5 mentions per opmerking; max 200 doel-PO's; suggesties: min 2 tekens, max 10, prefix-match.
- Mentions alleen bij nieuwe opmerkingen; `parentId` + `mentions` → 400 `Mentions are not allowed in replies`.
- Supplier: suggesties/tellingen/doelen beperkt tot eigen zichtbare PO's; `broadcastCount` nooit naar supplier.
- Migraties idempotent, één batch (geen `GO`), nieuwe kolommen in `EXEC(N'...')`; uitvoeren op DEV na akkoord (gegeven door gebruiker: "bouw beide").
- Geen commits zonder verzoek.
- Waarde-pad in `tb_cache.data_json`: `$.{column.key}` (zie `projectJson` in `TableDataService`). Detail-kolommen: join naar master (`detail_key = -1`), beide `removed_at_source = 0`.

## Review Focus

1. Supplier zoekt `@` op een artikel dat ook bij andere vendors voorkomt → suggestie-telling en preview tonen alleen eigen PO's; plaatsen landt alleen op eigen PO's. (Task 2: supplier-scope tests.)
2. Gebruiker typt `@SFM` maar kiest geen suggestie, of wist de chip-tekst → er wordt geen mention meegestuurd voor tekst die er niet (meer) staat. (Task 5: `activeMentions` tests.)
3. Een groep met kopieën bij 3 vendors; de auteur verwijdert hem op één PO → alle kopieën weg, ook op PO's die de auteur nu niet open heeft. (Task 3: delete-groep test.)
4. JSON-pad-injectie via een kolom-key → kolom-key komt uit `tb_columns` (gevalideerd mentionable), nooit van de client; pad als parameter. (Task 2: test dat onbekende/niet-mentionable `columnId` 400 geeft en dat het pad als input wordt gebonden.)
5. Esc in de suggestielijst sluit alleen de lijst, niet het panel; Enter met open lijst kiest i.p.v. plaatst. (Task 6: tests.)

---

### Task 1: Migratie 055 + kolomvlag `mentionable` (server + admin-route)

**Files:** Create `scripts/db/migrations/055_remark_mentions.sql`; Modify `server/services/TableRegistryService.js` (mapper + `COLUMN_SELECT`), `server/services/TableColumnsService.js` (`setMentionable`), `server/routes/data.js` (route); Test `server/services/TableColumnsService.test.js` (of nieuw `TableColumnsService.mentionable.test.js`), `server/routes/data.test.js`.

**Produces:** column DTO `mentionable: boolean`, `mentionableAllowed` (client-afgeleid in Task 7); `columnsService.setMentionable(columnId, flag, userId)`; route `PATCH /:tableKey/columns/:id/mentionable` body `{ mentionable: boolean }` (admin).

- [ ] **Step 1: Migratie**
```sql
-- Migratie 055: @mentions in remarks — mentionable kolommen, broadcast-groepen en mention-log.
IF COL_LENGTH('dbo.tb_columns', 'mentionable') IS NULL
BEGIN
  ALTER TABLE dbo.tb_columns ADD mentionable BIT NOT NULL
    CONSTRAINT DF_tb_columns_mentionable DEFAULT 0;
  -- Eenmalig bij aanmaken: Artikel (regelniveau) staat standaard aan.
  EXEC(N'
    UPDATE c SET mentionable = 1
    FROM dbo.tb_columns c
    INNER JOIN dbo.tb_tables t ON t.id = c.table_id
    WHERE t.[key] = ''purchase-orders'' AND c.scope = ''detail'' AND c.[key] = ''itemNumber'';
  ');
END;

IF COL_LENGTH('dbo.tb_row_remarks', 'broadcast_id') IS NULL
BEGIN
  ALTER TABLE dbo.tb_row_remarks ADD broadcast_id UNIQUEIDENTIFIER NULL;
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_tb_row_remarks_broadcast' AND object_id = OBJECT_ID('dbo.tb_row_remarks')
)
BEGIN
  EXEC(N'CREATE INDEX IX_tb_row_remarks_broadcast ON dbo.tb_row_remarks (broadcast_id)
    WHERE broadcast_id IS NOT NULL;');
END;

IF OBJECT_ID('dbo.tb_row_remark_mentions', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.tb_row_remark_mentions (
    id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_tb_row_remark_mentions PRIMARY KEY,
    broadcast_id UNIQUEIDENTIFIER NOT NULL,
    column_id BIGINT NOT NULL CONSTRAINT FK_tb_row_remark_mentions_column REFERENCES dbo.tb_columns(id),
    value NVARCHAR(200) NOT NULL
  );
  CREATE INDEX IX_tb_row_remark_mentions_broadcast ON dbo.tb_row_remark_mentions (broadcast_id);
END;
```
- [ ] **Step 2: Failing tests** — `setMentionable` (mock pool zoals bestaande `TableColumnsService`-tests; als die er niet zijn, test via route met gemockte service):
```js
it('weigert mentionable op een niet-text of custom kolom', async () => {
  // getColumnById → { id: 5, dataType: 'number', source: 'source' }
  await expect(setMentionable(5, true, 1)).rejects.toMatchObject({ status: 400 });
  // getColumnById → { id: 6, dataType: 'text', source: 'custom' }
  await expect(setMentionable(6, true, 1)).rejects.toMatchObject({ status: 400 });
});
it('zet mentionable op een text-bronkolom', async () => {
  // getColumnById → { id: 7, dataType: 'text', source: 'source' } → UPDATE ... SET mentionable = @flag
});
```
Route-test in `data.test.js`: `PATCH /api/data/purchase-orders/columns/7/mentionable` als employee → 403; als admin → `columnsService.setMentionable` aangeroepen met `(7, true, 1)`.
- [ ] **Step 3: Implementatie**
  - `TableRegistryService.js`: `COLUMN_SELECT` + `, mentionable`; mapper `mentionable: Boolean(row.mentionable),`.
  - `TableColumnsService.js`:
```js
// Mag deze kolom met @ in remarks worden genoemd? Alleen D365-tekstkolommen (waarde staat in data_json).
async function setMentionable(columnId, flag, userId) {
  const existing = await getColumnById(columnId);
  if (!existing) throw Object.assign(new Error('Column not found'), { status: 404 });
  if (existing.source !== 'source' || existing.dataType !== 'text') {
    throw Object.assign(new Error('Only text columns from the source can be mentioned'), { status: 400 });
  }
  const pool = await getPool();
  await pool.request()
    .input('id', sql.BigInt, columnId)
    .input('flag', sql.Bit, flag ? 1 : 0)
    .input('userId', sql.Int, userId || null)
    .query(`UPDATE dbo.tb_columns SET mentionable = @flag, updated_by = @userId, updated_at = SYSUTCDATETIME() WHERE id = @id`);
  return getColumnById(columnId);
}
```
  (exporteren; als `getColumnById` een cache heeft, invalideren zoals `setVendorEditable` doet.)
  - `data.js`: route naast `vendor-editable`, `requireRole(ROLES.ADMIN)`, body `Boolean(req.body?.mentionable)`.
- [ ] **Step 4:** tests PASS. Migratie 2× draaien op DEV; verifieer `SELECT [key], mentionable FROM tb_columns WHERE mentionable = 1` → `itemNumber`.

---

### Task 2: `RemarkMentionsService`

**Files:** Create `server/services/RemarkMentionsService.js`, `server/services/RemarkMentionsService.test.js`

**Produces:**
- `loadMentionableColumns(tableId) → Column[]` (id, key, label, scope)
- `suggestMentions({ table, q, actor }) → [{ columnId, columnLabel, value, orderCount }]`
- `resolveMentionTargets({ table, mentions, actor, currentRow }) → { rows: [{ partitionKey, recordKey }], vendorCount }` — gooit 400's uit de spec.
- `setTestDependencies({ getPool, loadColumns, getSupplierScope })`

Supplier-scope: hergebruik `getSupplierFilterColumnKey`, `loadSupplierVisibleRowKeys`, `filterRowsForSupplier` (zoals `summarizeRemarks`). Vendor-telling: `COUNT(DISTINCT JSON_VALUE(m.data_json, @vendorPath))` met `@vendorPath = '$.' + supplierFilterColumn`.

- [ ] **Step 1: Failing tests** (fake pool à la `RowRemarksSearchService.test.js`):
```js
const COLS = [
  { id: 11, key: 'itemNumber', label: 'Artikel', scope: 'detail' },
  { id: 12, key: 'vendorAccount', label: 'Vendor', scope: 'master' },
];
describe('suggestMentions', () => {
  it('zoekt prefix per mentionable kolom met gebonden JSON-pad, max 10', async () => {
    mocks.queryHandler = () => result([{ value: 'SFM-12542-00-01', order_count: 3 }]);
    const out = await suggestMentions({ table: { id: 7 }, q: 'sfm', actor: staff });
    const q = mocks.queries[0];
    expect(q.inputs.jsonPath).toBe('$.itemNumber');
    expect(q.inputs.prefix).toBe('sfm%');
    expect(q.text).toContain('TOP (10)');
    expect(out[0]).toEqual({ columnId: 11, columnLabel: 'Artikel', value: 'SFM-12542-00-01', orderCount: 3 });
  });
  it('korte query (<2) geeft lege lijst zonder query', async () => {
    expect(await suggestMentions({ table: { id: 7 }, q: 's', actor: staff })).toEqual([]);
    expect(mocks.queries).toHaveLength(0);
  });
  it('supplier: tellingen alleen over eigen zichtbare PO\'s', async () => {
    // query levert rows met partition_key/record_key per waarde; visibleKeys bevat er 1 van 3
    // → orderCount 1; waarden zonder eigen PO verdwijnen
  });
});
describe('resolveMentionTargets', () => {
  it('detail-kolom: masters via join, huidige PO erbij, vendorCount', async () => { /* ... */ });
  it('onbekende of niet-mentionable kolom → 400 This value cannot be mentioned', async () => { /* ... */ });
  it('geen treffers → 400 No purchase orders found for @X', async () => { /* ... */ });
  it('> 200 PO\'s → 400 Too many purchase orders (max 200)', async () => { /* ... */ });
  it('> 5 mentions → 400', async () => { /* ... */ });
  it('supplier: alleen eigen PO\'s, vendorCount 1', async () => { /* ... */ });
});
```
(De executor vult de `/* ... */`-tests uit met dezelfde fake-pool-opzet: `queryHandler` retourneert rijen `{ partition_key, record_key, vendor_value }`; asserties op `rows`, `vendorCount`, statuscodes en meldingen uit Global Constraints.)

- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementatie** — kern-SQL:

Suggesties (per kolom; detail-scope):
```sql
SELECT TOP (10) v.value, COUNT(DISTINCT CONCAT(v.partition_key, '|', v.record_key)) AS order_count
FROM (
  SELECT LTRIM(RTRIM(JSON_VALUE(d.data_json, @jsonPath))) AS value, d.partition_key, d.record_key
  FROM dbo.tb_cache d WITH (NOLOCK)
  INNER JOIN dbo.tb_cache m WITH (NOLOCK)
    ON m.table_id = d.table_id AND m.scope = 'master' AND m.partition_key = d.partition_key
   AND m.record_key = d.record_key AND m.detail_key = -1 AND m.removed_at_source = 0
  WHERE d.table_id = @tableId AND d.scope = 'detail' AND d.removed_at_source = 0
    AND JSON_VALUE(d.data_json, @jsonPath) LIKE @prefix
) v
GROUP BY v.value
ORDER BY v.value;
```
Master-scope: zelfde zonder join (`FROM dbo.tb_cache m WHERE m.scope='master' AND m.detail_key=-1`). Supplier: query zonder `TOP`/`GROUP BY` maar met `partition_key, record_key` (max 2000 rijen), dan in JS filteren op `visibleKeys`, groeperen, sorteren, top 10.
`@prefix` = `q.replace(/[%_[]/g, '[$&]') + '%'`; collation case-insensitive via `COLLATE Latin1_General_CI_AS` op de vergelijking.

Doelen: per mention dezelfde join met `= @value` (`SELECT DISTINCT m.partition_key, m.record_key, JSON_VALUE(m.data_json, @vendorPath) AS vendor_value`), union in JS (Map op `p|r`), huidige rij toevoegen, supplier-filter, grenzen checken, `vendorCount` = distinct non-null `vendor_value` (+ huidige rij-vendor via dezelfde query op de huidige rij of `1` minimum).

Wrap queries in `time('remarks_mention_sql', ...)`.

- [ ] **Step 4:** PASS.

---

### Task 3: Plaatsen, lezen en verwijderen van groepen (`RowRemarksService` + mapper + routes)

**Files:** Modify `server/services/RowRemarksService.js`, `RowRemarksMapper.js`, `server/routes/data.js`; Test `RowRemarksService.test.js`, `data.test.js`

**Consumes:** `resolveMentionTargets` (Task 2). **Produces:**
- `addRemark({ ..., mentions?: [{ columnId, value }] }, actor)`; DTO `broadcastId: string|null`, `mentions: [{ columnLabel, value }]`, `broadcastCount?: number` (alleen `actor.seesVisibility || isStaff`, d.w.z. niet supplier).
- Routes: `GET /:tableKey/remarks/mentions?q=` (comments.write) → `{ suggestions }`; `POST /:tableKey/remarks/mentions/preview` (comments.write) → `{ orderCount, vendorCount }`; `POST /:tableKey/remarks` neemt `mentions` door (array, anders 400).

- [ ] **Step 1: Failing tests**
```js
describe('RowRemarksService mentions', () => {
  it('plaatst één rij per doel-PO met één broadcast_id in één transactie', async () => {
    // RemarkMentionsService.resolveMentionTargets gemockt via setTestDependencies({ resolveMentionTargets })
    // → rows [{whsl,PO-1},{whsl,PO-2},{whsl,PO-3}]
    // assert: INSERT ... FROM OPENJSON(@targets) met 3 targets, @broadcastId uuid, transaction gezet,
    //         mentions-insert met 1 rij, commit; resultaat = remark van PO-1
  });
  it('replies met mentions → 400', async () => {
    await expect(addRemark({ ...baseInput, body: 'x', parentId: 41, mentions: [{ columnId: 11, value: 'A' }] }, employee))
      .rejects.toMatchObject({ status: 400, message: 'Mentions are not allowed in replies' });
  });
  it('verwijderen van een groepsremark verwijdert alle kopieën', async () => {
    // UPDATE-batch bevat tweede statement 'WHERE broadcast_id = @broadcastId AND is_deleted = 0'
  });
  it('DTO: broadcastCount voor staff, niet voor supplier; mentions voor iedereen', async () => {
    // remarkRow({ broadcast_id: 'b1', broadcast_count: 3, mentions_json: '[{"value":"A","columnLabel":"Artikel"}]' })
  });
});
```
Route-tests: `mentions` geen array → 400; doorgifte naar service; `GET mentions` en `POST preview` roepen service aan met actor.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementatie**
  - `remarkSelect()` uitbreiden: `p.broadcast_id, bc.broadcast_count, mj.mentions_json` met
```sql
  OUTER APPLY (SELECT COUNT_BIG(*) AS broadcast_count FROM dbo.tb_row_remarks b
               WHERE p.broadcast_id IS NOT NULL AND b.broadcast_id = p.broadcast_id) bc
  OUTER APPLY (SELECT (SELECT m.value, c2.label AS columnLabel FROM dbo.tb_row_remark_mentions m
                       INNER JOIN dbo.tb_columns c2 ON c2.id = m.column_id
                       WHERE p.broadcast_id IS NOT NULL AND m.broadcast_id = p.broadcast_id
                       FOR JSON PATH) AS mentions_json) mj
```
  - Mapper: `broadcastId: row.broadcast_id || null`, `mentions: row.mentions_json ? JSON.parse(row.mentions_json) : []`, `...(!actor?.isSupplier && row.broadcast_id ? { broadcastCount: Number(row.broadcast_count) } : {})`.
  - `addRemark`: na `resolveWriteVisibility`: `if (Array.isArray(input.mentions) && input.mentions.length) return addBroadcast(ctx, { body, columnId, visibility, mentions: input.mentions });` en bij `parentId` + mentions → 400.
  - `addBroadcast`: `const { rows } = await dependencies.resolveMentionTargets({ table: ctx.table, mentions, actor, currentRow: ctx.row })`; `broadcastId = crypto.randomUUID()`; transactie:
```sql
INSERT INTO dbo.tb_row_remarks
  (table_id, partition_key, record_key, detail_key, column_id, body, created_by, visibility, broadcast_id)
SELECT @tableId, t.p, t.r, -1, NULL, @body, @actorId, @newVisibility, @broadcastId
FROM OPENJSON(@targets) WITH (p NVARCHAR(32) '$.p', r NVARCHAR(128) '$.r') t;
INSERT INTO dbo.tb_row_remark_mentions (broadcast_id, column_id, value)
SELECT @broadcastId, j.c, j.v FROM OPENJSON(@mentions) WITH (c BIGINT '$.c', v NVARCHAR(200) '$.v') j;
SELECT id FROM dbo.tb_row_remarks
WHERE broadcast_id = @broadcastId AND partition_key = @partitionKey AND record_key = @recordKey;
```
   (`@broadcastId` als `sql.UniqueIdentifier`; `@targets`/`@mentions` als `sql.NVarChar(sql.MAX)` JSON.) Commit, dan `fetchRemark(ctx, id)`. `columnId` van de huidige kolom wordt niet meegenomen (kopieën op andere PO's).
  - `deleteRemark`: aan het eind van de UPDATE-batch (na de bestaande `UPDATE r ...`):
```sql
DECLARE @broadcastId UNIQUEIDENTIFIER = (SELECT broadcast_id FROM dbo.tb_row_remarks WHERE id = @remarkId AND is_deleted = 1 AND deleted_by = @actorId);
IF @broadcastId IS NOT NULL
  UPDATE dbo.tb_row_remarks SET is_deleted = 1, deleted_by = @actorId, deleted_at = SYSUTCDATETIME()
  WHERE broadcast_id = @broadcastId AND is_deleted = 0;
```
   Plaats dit **tussen** de eerste UPDATE en de status-SELECT zodat recordset-indexen gelijk blijven (`recordsets[0]` = OUTPUT van de eerste UPDATE, `recordsets[1]` = status).
  - Routes zoals beschreven; `remarksActor(req)` als actor; table via `getTableByKey`.
- [ ] **Step 4:** PASS; `npx vitest run server` groen.

---

### Task 4: Client-API + hooks

**Files:** Create `src/components/supplier/remarks/useMentionSuggestions.js`, `useMentionPreview.js` (+ tests); Modify `useRowRemarks.js` (`createRemark(body, columnId, visibility, parentId, mentions)`), `RemarksPanel.jsx` (`handleSubmitRemark(body, columnId, visibility, mentions)`).

**Produces:**
- `useMentionSuggestions({ tableKey, query }) → { suggestions, loading }` — debounce 200 ms, `apiRequest('/data/{t}/remarks/mentions?q=')`, `query` < 2 → `[]`, verouderde responses genegeerd.
- `useMentionPreview({ tableKey, row, mentions }) → { orderCount, vendorCount, error, loading }` — debounce 300 ms, `POST /remarks/mentions/preview` met `partitionKey/recordKey/mentions`; lege mentions → null-waarden zonder call.

- [ ] **Step 1: Failing tests** (fake timers, `vi.mock('../../../utils/api')`): debounce (1 call na 200 ms), korte query geen call, out-of-order responses (laatste wint), preview geen call zonder mentions, error-tekst bij 400 doorgegeven; `createRemark('x', null, 'vendor', null, [{ columnId: 11, value: 'A' }])` → body bevat `mentions`.
- [ ] **Step 2:** FAIL. **Step 3:** implementatie. **Step 4:** PASS.

---

### Task 5: `mentionText.js` (pure tekst-helpers)

**Files:** Create `src/components/supplier/remarks/mentionText.js` (+ test)

**Produces:**
- `findMentionQuery(text, caret) → { start, query } | null` — laatste `@` vóór de caret, voorafgegaan door begin of whitespace, zonder whitespace ertussen.
- `insertMention(text, start, caret, value) → { text, caret }` — vervangt `@query` door `@value ` .
- `activeMentions(text, mentions) → mentions` — alleen waarvan `@value` als los token in `text` staat; dedupe op `columnId|value`.
- `splitMentions(body, mentions) → Array<{ type: 'text'|'mention', value }>`.

- [ ] **Step 1: Failing tests**
```js
import { describe, expect, it } from 'vitest';
import { activeMentions, findMentionQuery, insertMention, splitMentions } from './mentionText';

describe('mentionText', () => {
  it('vindt de query achter @ bij de caret', () => {
    expect(findMentionQuery('Check @SFM-12', 13)).toEqual({ start: 6, query: 'SFM-12' });
    expect(findMentionQuery('mail a@b.nl', 11)).toBeNull();
    expect(findMentionQuery('@x y', 4)).toBeNull();
  });
  it('voegt de gekozen waarde in en zet de caret erachter', () => {
    expect(insertMention('Check @SFM tomorrow', 6, 10, 'SFM-12542-00-01'))
      .toEqual({ text: 'Check @SFM-12542-00-01  tomorrow', caret: 23 });
  });
  it('houdt alleen mentions die nog in de tekst staan', () => {
    const m = [{ columnId: 11, value: 'A-1' }, { columnId: 11, value: 'B-2' }, { columnId: 11, value: 'A-1' }];
    expect(activeMentions('see @A-1 now', m)).toEqual([{ columnId: 11, value: 'A-1' }]);
    expect(activeMentions('see @A-10', [{ columnId: 11, value: 'A-1' }])).toEqual([]);
  });
  it('splitst tekst in tekst- en mention-delen', () => {
    expect(splitMentions('Late @A-1 again', [{ value: 'A-1' }])).toEqual([
      { type: 'text', value: 'Late ' }, { type: 'mention', value: 'A-1' }, { type: 'text', value: ' again' },
    ]);
  });
});
```
- [ ] **Step 2:** FAIL. **Step 3:** implementatie (regex met `escapeRegExp`, token-grens `(?=\s|$|[.,;:!?)])`). **Step 4:** PASS.

---

### Task 6: Composer — suggesties + bereik

**Files:** Create `src/components/supplier/remarks/MentionSuggestions.jsx`; Modify `RemarkComposer.jsx`, `remarks.css`; Test `RemarkComposer.test.jsx`

**Consumes:** Task 4 hooks, Task 5 helpers. `RemarkComposer` krijgt props `tableKey`, `row`; `onSubmit(draft, columnId, visibility, mentions)`.

- [ ] **Step 1: Failing tests** (mock hooks met `vi.mock('./useMentionSuggestions')` / `useMentionPreview`):
  - `@SF` typen → listbox met opties `SFM-12542-00-01 · Artikel · 3 POs`; ↓ + Enter kiest → tekst `@SFM-12542-00-01 `, form **niet** gesubmit.
  - Esc sluit lijst, keydown propageert niet naar wrapper.
  - Preview staff: "Will be posted on 14 purchase orders from 3 vendors"; met visibility `vendor` en `vendorCount > 1` → klasse `remarks-mention-reach--warning`.
  - Preview supplier: "Will be posted on 4 of your purchase orders".
  - `orderCount > 200` → "Too many purchase orders (max 200)" en knop disabled.
  - Submit stuurt `activeMentions` mee; tekst gewist → `[]`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implementatie:
  - Caret bijhouden via `onSelect`/`onChange` (`event.target.selectionStart`).
  - `const mentionQuery = findMentionQuery(draft, caret)`; `useMentionSuggestions({ tableKey, query: mentionQuery?.query || '' })`.
  - `MentionSuggestions({ open, suggestions, loading, activeIndex, onPick, id })`: `role="listbox"`, opties `role="option"` + `aria-selected`; textarea `aria-controls`/`aria-activedescendant`/`aria-expanded`.
  - Keydown op textarea wanneer lijst open: ArrowDown/Up wisselen `activeIndex`, Enter/Tab → pick (preventDefault), Escape → sluiten + `stopPropagation`.
  - `chosen` state: lijst gekozen mentions; `const mentions = activeMentions(draft, chosen)`; `useMentionPreview({ tableKey, row, mentions })`.
  - Reach-regel en limiet zoals spec; submit disabled bij > 200 of preview-error.
- [ ] **Step 4:** PASS.

---

### Task 7: Weergave + verwijderen + admin-vinkje

**Files:** Modify `RemarkMessageCard.jsx`, `RemarksPanel.jsx` (props doorgeven), `src/hooks/useDataModelAdmin.js`, `src/components/admin/datamodel/DataPreviewColumnConfigRow.jsx`, `EntityConfigTable.jsx`, `dataModelInfoCopy.js`; Tests `RemarksComponents.test.jsx`, datamodel-tests.

- [ ] **Step 1: Failing tests**
  - Card met `mentions: [{ value: 'A-1' }]` en body `Late @A-1` → element met klasse `remark-mention-chip` en tekst `@A-1`.
  - `broadcastCount: 14` → "Posted on 14 purchase orders"; zonder → niets.
  - Delete-bevestiging met `broadcastCount: 14` → "Delete this remark on all 14 purchase orders?".
  - Data model: kolom `{ dataType: 'text', source: 'd365', mentionable: false }` toont switch "Mentionable for {label}"; klik → `PATCH .../mentionable` met `{ mentionable: true }`; custom/number-kolom → "Not available".
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implementatie:
  - Body: `splitMentions(remark.body, remark.mentions || [])` → `<span className="remark-mention-chip">@{value}</span>`.
  - `useDataModelAdmin`: `mentionable: Boolean(col.mentionable)`, `mentionableAllowed: column.source === 'd365' && column.dataType === 'text'`, `toggleMentionable` naar patroon `toggleVendorEditable` (togglingKey `mn-{id}`), bulk-type `mentionable`.
  - Kolomrij + header "Mentionable" met info `DATA_MODEL_INFO.mentionable = "Allow @mentions of this column's values in remarks."`.
  - CSS: `.remark-mention-chip { padding: 0 4px; border-radius: 4px; background: var(--colorBrandBackground2); color: var(--colorBrandForeground2); font-weight: 600; }`, `.remarks-mention-reach--warning { color: var(--colorPaletteMarigoldForeground2); }`, listbox-styling met `--colorNeutralBackground1`, schaduw `var(--shadow16)`, actieve optie `--colorNeutralBackground1Hover`.
- [ ] **Step 4:** PASS.

---

### Task 8: Eindverificatie
- [ ] `npx vitest run server`, `npx vitest run src` groen; `npm run build`; lint 0 errors.
- [ ] Handmatig (localhost, DEV-data heeft `ITEM-000x` artikelen): `@ITEM-0002` → suggestie met aantal; preview; plaatsen als Supply Chain (Vendor) op meerdere vendors met amber waarschuwing; opmerking verschijnt op alle betreffende PO's; vendor ziet alleen eigen; reply op één PO niet zichtbaar op andere; verwijderen op één PO verwijdert overal; Data model-vinkje werkt.
- [ ] Onafhankelijke review.
