# Replies op opmerkingen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eén-niveau replies op remarks, met gesprekken die naar boven schuiven, zichtbaarheid die altijd van de root wordt geërfd, en een inline reply-UI in het remarks-panel.

**Architecture:** `tb_row_remarks` krijgt `parent_id` en `last_activity_at`. De server pagineert roots op `last_activity_at` en hangt hun replies eraan; een reply wordt in een transactie geplaatst die de root vergrendelt, valideert, de visibility overneemt en `last_activity_at` bijwerkt. De client houdt roots met `replies[]` bij via pure helpers in `remarkThreads.js`; UI-componenten `RemarkThread` en `RemarkReplyComposer` renderen het gesprek.

**Tech Stack:** Express + `mssql` (Azure SQL), React 18 + Fluent UI v9, Vitest.

**Spec:** `docs/specs/2026-10-07-remark-replies-design.md` (bouwt voort op `docs/specs/2026-10-07-supply-chain-remark-visibility-design.md`)

## Global Constraints

- Alle UI-tekst Engels.
- Migraties idempotent; `run-migrations.js` draait elk bestand elke run als één batch (geen `GO`) → statements die nieuwe kolommen gebruiken in `EXEC(N'...')`.
- Geen commit/push zonder expliciet verzoek (repo-regel `otap-local-first`). "Checkpoint"-stappen = alleen als de gebruiker om een commit vraagt.
- `.env` wijst naar de gedeelde DEV-DB: `npm run migrate:db` alleen na akkoord van de gebruiker.
- Reply-visibility = visibility van de root, voor **alle** rollen; meegestuurde `visibility` wordt genegeerd.
- Parent niet zichtbaar / andere rij / bestaat niet → 404 `Remark not found`; verwijderde root → 409 `Replying to a deleted remark is not allowed`.
- Eén niveau: reply op reply → gekoppeld aan root.
- Replies binnen gesprek oud → nieuw; gesprekken op `last_activity_at DESC, id DESC`.
- > 2 replies: laatste 2 zichtbaar + "Show N earlier replies".
- Reply-knop alleen in tab **Remarks**, op niet-verwijderde roots, met `comments.write`.
- UI-teksten: `Reply`, `Cancel`, `Replying to {name}`, `Show {n} earlier replies` (`Show 1 earlier reply`), `↳ Reply to {name}`, aria `Reply to {name}`, `Replies to {name}'s remark`.

## Review Focus

1. Een vendor reageert op een vendor-remark terwijl Supply Chain die root intussen verwijdert → reply moet 409 krijgen, niet stilletjes onder een tombstone landen. (Task 3: test "verwijderde root → 409" dekt de check onder `UPDLOCK`.)
2. Polling-delta bevat een reply op een root die niet in de geladen pagina's zit (oud gesprek) → gesprek moet verschijnen (refresh), niet verloren gaan. (Task 6: test `missingRoot` → `loadInitial`.)
3. Een reply verwijderen of erop reageren moet de reply binnen het gesprek bijwerken, niet een (niet-bestaand) top-level item. (Task 6: tests `updateRemarkInThreads` voor reply.)
4. Employee ziet een interne root maar mag nooit een vendor-reply zien — kan niet voorkomen omdat replies de root-visibility erven; leesfilter blijft ook op replies staan als vangnet. (Task 2: test dat de replies-query het leesfilter bevat.)
5. Esc in het reply-venster mag niet het hele remarks-panel sluiten als het panel ook op Esc reageert. (Task 7: test dat Esc-event niet doorpropageert — `stopPropagation`.)

---

## File structure

| Bestand | Verantwoordelijkheid |
|---|---|
| `scripts/db/migrations/054_tb_row_remarks_replies.sql` (nieuw) | `parent_id`, `last_activity_at`, indexes |
| `server/services/RowRemarksMapper.js` | `parentId`, `lastActivityAt` in DTO |
| `server/services/RowRemarksService.js` | threads in `listRemarks`, `addReply` |
| `server/routes/data.js` | `parentId` doorgeven |
| `server/services/RowActivityService.js` | `parentId` + `replyTo` op remark-items |
| `src/components/supplier/remarks/remarkThreads.js` (nieuw) | pure thread-helpers |
| `src/components/supplier/remarks/remarksFormatters.js` | `toRemark` neemt `parentId`/`replyTo` mee |
| `src/components/supplier/remarks/useRowRemarks.js` | replies in state, polling-merge |
| `src/components/supplier/remarks/RemarkReplyComposer.jsx` (nieuw) | inline reply-venster |
| `src/components/supplier/remarks/RemarkThread.jsx` (nieuw) | root + replies + inklappen + composer |
| `src/components/supplier/remarks/RemarkMessageCard.jsx` | Reply-knop, compact, "Reply to"-regel |
| `src/components/supplier/remarks/RowActivityFeed.jsx` | `threaded`-modus |
| `src/components/supplier/remarks/RemarksPanel.jsx` | reply-state + wiring |
| `src/components/supplier/remarks/remarks.css` | thread-styling |

---

### Task 1: Migratie 054

**Files:** Create `scripts/db/migrations/054_tb_row_remarks_replies.sql`

**Produces:** kolommen `parent_id BIGINT NULL` (FK `FK_tb_row_remarks_parent`), `last_activity_at DATETIME2 NOT NULL` (default `DF_tb_row_remarks_last_activity`), indexes `IX_tb_row_remarks_parent`, `IX_tb_row_remarks_thread`.

- [ ] **Step 1: Schrijf de migratie**

```sql
-- Migratie 054: replies op remarks (één niveau) + laatste activiteit per gesprek.
-- Idempotent; statements die nieuwe kolommen raken staan in EXEC (één batch, geen GO).
IF COL_LENGTH('dbo.tb_row_remarks', 'parent_id') IS NULL
BEGIN
  ALTER TABLE dbo.tb_row_remarks ADD parent_id BIGINT NULL;
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys
  WHERE name = 'FK_tb_row_remarks_parent' AND parent_object_id = OBJECT_ID('dbo.tb_row_remarks')
)
BEGIN
  EXEC(N'ALTER TABLE dbo.tb_row_remarks ADD CONSTRAINT FK_tb_row_remarks_parent
    FOREIGN KEY (parent_id) REFERENCES dbo.tb_row_remarks(id);');
END;

IF COL_LENGTH('dbo.tb_row_remarks', 'last_activity_at') IS NULL
BEGIN
  ALTER TABLE dbo.tb_row_remarks ADD last_activity_at DATETIME2 NULL;
END;

EXEC(N'
  UPDATE dbo.tb_row_remarks SET last_activity_at = created_at WHERE last_activity_at IS NULL;
');

IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.tb_row_remarks') AND name = 'last_activity_at' AND is_nullable = 1
)
BEGIN
  EXEC(N'ALTER TABLE dbo.tb_row_remarks ALTER COLUMN last_activity_at DATETIME2 NOT NULL;');
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.default_constraints
  WHERE name = 'DF_tb_row_remarks_last_activity' AND parent_object_id = OBJECT_ID('dbo.tb_row_remarks')
)
BEGIN
  EXEC(N'ALTER TABLE dbo.tb_row_remarks ADD CONSTRAINT DF_tb_row_remarks_last_activity
    DEFAULT (SYSUTCDATETIME()) FOR last_activity_at;');
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_tb_row_remarks_parent' AND object_id = OBJECT_ID('dbo.tb_row_remarks')
)
BEGIN
  EXEC(N'CREATE INDEX IX_tb_row_remarks_parent ON dbo.tb_row_remarks (parent_id)
    INCLUDE (created_at, is_deleted, visibility) WHERE parent_id IS NOT NULL;');
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_tb_row_remarks_thread' AND object_id = OBJECT_ID('dbo.tb_row_remarks')
)
BEGIN
  EXEC(N'CREATE INDEX IX_tb_row_remarks_thread ON dbo.tb_row_remarks
    (table_id, partition_key, record_key, detail_key, last_activity_at DESC, id DESC)
    WHERE parent_id IS NULL;');
END;
```

- [ ] **Step 2:** Uitvoeren pas na akkoord gebruiker (gedeelde DEV-DB): `npm run migrate:db` twee keer → beide "Alle migraties voltooid". Verifieer: `SELECT COUNT(*) FROM dbo.tb_row_remarks WHERE last_activity_at IS NULL` → 0.

---

### Task 2: Mapper + `listRemarks` als gesprekken

**Files:** Modify `server/services/RowRemarksMapper.js`, `server/services/RowRemarksService.js` (`REMARK_SELECT`, `listRemarks`); Test `server/services/RowRemarksService.test.js`

**Produces:**
- Remark-DTO: `parentId: number|null`, `lastActivityAt: string` (ISO).
- `listRemarks` → `{ items: Array<Remark & { replies: Remark[], replyCount: number }>, total, nextCursor }`; `nextCursor` codeert `{ createdAt: lastActivityAt, id }` van de laatste root (zelfde `encodeCursor`-vorm).

- [ ] **Step 1: Failing tests** (voeg toe aan `RowRemarksService.test.js`; `remarkRow` krijgt default `parent_id: null, last_activity_at: new Date('2026-07-13T18:00:00.000Z')`):

```js
describe('RowRemarksService gesprekken', () => {
  const rootsQuery = () => mocks.queries.find(({ text }) => text.includes('r.parent_id IS NULL'));
  const repliesQuery = () => mocks.queries.find(({ text }) => text.includes('STRING_SPLIT(@rootIds'));

  function threadHandler(roots, replies) {
    return (ctx) => {
      if (ctx.text.includes('STRING_SPLIT(@rootIds')) return result(replies);
      if (ctx.text.includes('r.parent_id IS NULL')) return result(roots, [roots, [{ total: roots.length + replies.length }]]);
      return defaultQueryHandler(ctx);
    };
  }

  it('pagineert roots op last_activity_at en hangt replies eraan (oud → nieuw)', async () => {
    mocks.queryHandler = threadHandler(
      [remarkRow({ id: 41 }), remarkRow({ id: 40, body: 'Old root' })],
      [
        remarkRow({ id: 51, parent_id: 41, body: 'First reply', created_at: new Date('2026-07-13T18:01:00Z') }),
        remarkRow({ id: 52, parent_id: 41, body: 'Second reply', created_at: new Date('2026-07-13T18:02:00Z') }),
      ],
    );
    const page = await listRemarks(baseInput, employee);
    expect(rootsQuery().text).toMatch(/ORDER BY r\.last_activity_at DESC, r\.id DESC/);
    expect(repliesQuery().inputs.rootIds).toBe('41,40');
    expect(repliesQuery().text).toMatch(/ORDER BY p\.created_at ASC, p\.id ASC/);
    expect(page.items.map((i) => i.id)).toEqual([41, 40]);
    expect(page.items[0].replies.map((r) => r.body)).toEqual(['First reply', 'Second reply']);
    expect(page.items[0]).toMatchObject({ replyCount: 2, parentId: null });
    expect(page.items[1]).toMatchObject({ replies: [], replyCount: 0 });
    expect(page.total).toBe(4);
  });

  it('past het leesfilter ook op de replies-query toe', async () => {
    mocks.queryHandler = threadHandler([remarkRow({ id: 41 })], []);
    await listRemarks(baseInput, employee);
    expect(repliesQuery().text).toContain('r.visibility = @visibility');
    expect(repliesQuery().inputs.visibility).toBe('internal');
  });

  it('slaat de replies-query over zonder roots', async () => {
    mocks.queryHandler = threadHandler([], []);
    const page = await listRemarks(baseInput, employee);
    expect(repliesQuery()).toBeUndefined();
    expect(page.items).toEqual([]);
  });

  it('cursor gebruikt last_activity_at van de laatste root', async () => {
    const roots = [remarkRow({ id: 41, last_activity_at: new Date('2026-07-14T10:00:00.000Z') }), remarkRow({ id: 40 })];
    mocks.queryHandler = threadHandler(roots, []);
    const page = await listRemarks({ ...baseInput, limit: 1 }, employee);
    expect(normalizeCursor(page.nextCursor)).toEqual({ createdAt: new Date('2026-07-14T10:00:00.000Z'), id: 41 });
  });
});
```

- [ ] **Step 2:** `npx vitest run server/services/RowRemarksService.test.js` → FAIL.

- [ ] **Step 3: Implementatie**

`RowRemarksMapper.js` in het object na `createdAt`:
```js
        parentId: row.parent_id ? Number(row.parent_id) : null,
        lastActivityAt: iso(row.last_activity_at || row.created_at),
```

`RowRemarksService.js`: maak van `REMARK_SELECT` een functie met sortering:
```js
function remarkSelect(orderBy = 'p.created_at DESC, p.id DESC') {
  return `
  SELECT p.id, p.partition_key, p.record_key, p.column_id, p.body, p.created_by,
         p.created_at, p.is_deleted, p.deleted_at, COALESCE(u.display_name, u.email) AS author_name,
         p.visibility, u.role AS author_role, p.parent_id, p.last_activity_at,
         c.[key] AS column_key, c.label AS column_label, rx.emoji,
         rx.reaction_count, rx.reacted_by_current_user
  FROM paged p
  LEFT JOIN dbo.users u ON u.id = p.created_by
  LEFT JOIN dbo.tb_columns c ON c.id = p.column_id
  OUTER APPLY (
    SELECT rr.emoji, COUNT_BIG(*) AS reaction_count,
           MAX(CASE WHEN rr.user_id = @actorId THEN 1 ELSE 0 END) AS reacted_by_current_user
    FROM dbo.tb_row_remark_reactions rr
    WHERE rr.remark_id = p.id
    GROUP BY rr.emoji
  ) rx
  ORDER BY ${orderBy}, rx.emoji;
`;
}
```
Vervang de twee `${REMARK_SELECT}` door `${remarkSelect()}` (fetchRemark) resp. zie hieronder.

`listRemarks`:
```js
async function listRemarks(input, actor) {
  const ctx = await context(input.tableKey, input.partitionKey, input.recordKey, actor);
  const limit = normalizeLimit(input.limit);
  const cursor = normalizeCursor(input.cursor);
  await assertMasterRow(ctx);
  const request = remarkRequest(ctx.pool.request(), {
    tableId: ctx.table.id, row: ctx.row, actor: ctx.actor,
  })
    .input('take', sql.Int, limit + 1)
    .input('cursorAt', sql.DateTime2, cursor?.createdAt || null)
    .input('cursorId', sql.BigInt, cursor?.id || null);
  // Gesprekken: roots op laatste activiteit; replies los opgehaald en eraan gehangen.
  const result = await time('remarks_list_sql', () => request.query(`
    ;WITH paged AS (
      SELECT TOP (@take) r.*
      FROM dbo.tb_row_remarks r
      WHERE r.table_id = @tableId AND r.partition_key = @partitionKey
        AND r.record_key = @recordKey AND r.detail_key = -1 AND r.parent_id IS NULL ${visibleTo(ctx)}
        AND (@cursorAt IS NULL OR r.last_activity_at < @cursorAt
          OR (r.last_activity_at = @cursorAt AND r.id < @cursorId))
      ORDER BY r.last_activity_at DESC, r.id DESC
    )
    ${remarkSelect('p.last_activity_at DESC, p.id DESC')}
    SELECT COUNT_BIG(*) AS total
    FROM dbo.tb_row_remarks r
    WHERE r.table_id = @tableId AND r.partition_key = @partitionKey
      AND r.record_key = @recordKey AND r.detail_key = -1 ${visibleTo(ctx)};
  `));
  const mapped = mapRemarkRows(result.recordsets[0], ctx.actor);
  const hasMore = mapped.length > limit;
  const roots = mapped.slice(0, limit);
  const repliesByRoot = await loadReplies(ctx, roots.map((root) => root.id));
  const items = roots.map((root) => {
    const replies = repliesByRoot.get(root.id) || [];
    return { ...root, replies, replyCount: replies.length };
  });
  const last = hasMore ? roots.at(-1) : null;
  return {
    items,
    total: Number(result.recordsets[1]?.[0]?.total || 0),
    nextCursor: last ? encodeCursor({ created_at: last.lastActivityAt, id: last.id }) : null,
  };
}

async function loadReplies(ctx, rootIds) {
  const byRoot = new Map();
  if (!rootIds.length) return byRoot;
  const result = await time('remarks_replies_sql', () => remarkRequest(ctx.pool.request(), {
    tableId: ctx.table.id, row: ctx.row, actor: ctx.actor,
  }).input('rootIds', sql.NVarChar(sql.MAX), rootIds.join(',')).query(`
    ;WITH paged AS (
      SELECT r.* FROM dbo.tb_row_remarks r
      WHERE r.table_id = @tableId AND r.partition_key = @partitionKey
        AND r.record_key = @recordKey AND r.detail_key = -1
        AND r.parent_id IN (SELECT CAST(value AS BIGINT) FROM STRING_SPLIT(@rootIds, ','))
        ${visibleTo(ctx)}
    )
    ${remarkSelect('p.created_at ASC, p.id ASC')}
  `));
  for (const reply of mapRemarkRows(result.recordset, ctx.actor)) {
    const list = byRoot.get(reply.parentId) || [];
    list.push(reply);
    byRoot.set(reply.parentId, list);
  }
  return byRoot;
}
```
(`rootIds` zijn al gevalideerde getallen uit de DB; STRING_SPLIT voorkomt dynamische SQL.)

- [ ] **Step 4:** Tests → PASS; bestaande tests in het bestand groen (pas de `defaultQueryHandler` aan zodat de nieuwe `STRING_SPLIT`-query `result([])` geeft).
- [ ] **Step 5: Checkpoint** `feat: list remarks as threads`

---

### Task 3: Reply plaatsen (`addRemark` met `parentId`)

**Files:** Modify `server/services/RowRemarksService.js`; Test `server/services/RowRemarksService.test.js`

**Consumes:** `remarkRequest`, `visibleTo`, `fetchRemark`, `dependencies.createTransaction/createRequest` (bestaand). **Produces:** `addRemark({ ..., parentId?: number }, actor)`.

- [ ] **Step 1: Failing tests**

```js
describe('RowRemarksService replies', () => {
  const supplyChain = { id: 40, role: 'supply_chain' };
  const parentRow = (overrides = {}) => ({
    id: 41, parent_id: null, is_deleted: false, visibility: 'vendor', root_id: 41, root_deleted: false, ...overrides,
  });

  function replyHandler(parent) {
    return (ctx) => {
      if (ctx.text.includes('AS root_deleted')) return result(parent ? [parent] : []);
      if (ctx.text.includes('INSERT INTO dbo.tb_row_remarks')) return result([{ id: 60 }]);
      if (ctx.text.includes('SET last_activity_at')) return result([]);
      return defaultQueryHandler(ctx);
    };
  }
  const insertQuery = () => mocks.queries.find(({ text }) => text.includes('INSERT INTO dbo.tb_row_remarks'));

  it('erft de visibility van de root, ook als admin/supply_chain iets anders stuurt', async () => {
    mocks.queryHandler = replyHandler(parentRow({ visibility: 'internal' }));
    await addRemark({ ...baseInput, body: 'Re', parentId: 41, visibility: 'vendor' }, supplyChain);
    expect(insertQuery().inputs).toMatchObject({ newVisibility: 'internal', parentId: 41 });
    expect(insertQuery().transaction).toBeTruthy();
  });

  it('employee mag zonder visibility reageren (geen 400)', async () => {
    mocks.queryHandler = replyHandler(parentRow({ visibility: 'internal' }));
    await addRemark({ ...baseInput, body: 'Re', parentId: 41 }, employee);
    expect(insertQuery().inputs.newVisibility).toBe('internal');
  });

  it('reply op reply wordt aan de root gekoppeld', async () => {
    mocks.queryHandler = replyHandler(parentRow({ id: 51, parent_id: 41, root_id: 41 }));
    await addRemark({ ...baseInput, body: 'Re', parentId: 51 }, supplyChain);
    expect(insertQuery().inputs.parentId).toBe(41);
  });

  it('werkt last_activity_at van de root bij in dezelfde transactie', async () => {
    mocks.queryHandler = replyHandler(parentRow());
    await addRemark({ ...baseInput, body: 'Re', parentId: 41 }, supplyChain);
    const bump = mocks.queries.find(({ text }) => text.includes('SET last_activity_at'));
    expect(bump.inputs.rootId).toBe(41);
    expect(bump.transaction).toBe(insertQuery().transaction);
    expect(mocks.transactions[0].commit).toHaveBeenCalled();
  });

  it('onbekende/onzichtbare parent → 404 en rollback', async () => {
    mocks.queryHandler = replyHandler(null);
    await expect(addRemark({ ...baseInput, body: 'Re', parentId: 99 }, employee)).rejects.toMatchObject({ status: 404 });
    const lock = mocks.queries.find(({ text }) => text.includes('AS root_deleted'));
    expect(lock.text).toContain('p.visibility = @visibility');
    expect(lock.text).toContain('WITH (UPDLOCK, HOLDLOCK)');
    expect(insertQuery()).toBeUndefined();
    expect(mocks.transactions[0].rollback).toHaveBeenCalled();
  });

  it('verwijderde root → 409', async () => {
    mocks.queryHandler = replyHandler(parentRow({ id: 51, parent_id: 41, root_id: 41, root_deleted: true }));
    await expect(addRemark({ ...baseInput, body: 'Re', parentId: 51 }, supplyChain))
      .rejects.toMatchObject({ status: 409, message: 'Replying to a deleted remark is not allowed' });
  });
});
```

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3: Implementatie** — in `addRemark` direct na `const columnId = ...`:
```js
  if (input.parentId) return addReply(ctx, { body, columnId, parentId: normalizePositiveId(input.parentId, 'parentId') });
```
(vóór `resolveWriteVisibility`, zodat admin/supply_chain zonder keuze kunnen reageren.)

```js
// Reply: root vergrendelen, zichtbaarheid + rij valideren, visibility erven, gesprek naar boven.
async function addReply(ctx, { body, columnId, parentId }) {
  const tx = dependencies.createTransaction(ctx.pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const locked = await remarkRequest(dependencies.createRequest(tx), {
      tableId: ctx.table.id, row: ctx.row, actor: ctx.actor,
    }).input('parentId', sql.BigInt, parentId).query(`
      SELECT p.id, p.parent_id, p.is_deleted, p.visibility,
             root.id AS root_id, root.is_deleted AS root_deleted
      FROM dbo.tb_row_remarks p WITH (UPDLOCK, HOLDLOCK)
      INNER JOIN dbo.tb_row_remarks root WITH (UPDLOCK, HOLDLOCK)
        ON root.id = COALESCE(p.parent_id, p.id)
      WHERE p.id = @parentId AND p.table_id = @tableId
        AND p.partition_key = @partitionKey AND p.record_key = @recordKey AND p.detail_key = -1
        ${visibilitySql('p', ctx.actor.visibilityFilter)};
    `);
    const parent = locked.recordset[0];
    if (!parent) throw httpError(404, 'Remark not found');
    if (parent.is_deleted || parent.root_deleted) {
      throw httpError(409, 'Replying to a deleted remark is not allowed');
    }
    const rootId = Number(parent.root_id);
    const inserted = await remarkRequest(dependencies.createRequest(tx), {
      tableId: ctx.table.id, row: ctx.row, actor: ctx.actor,
    }).input('body', sql.NVarChar(2000), body)
      .input('columnId', sql.BigInt, columnId)
      .input('newVisibility', sql.NVarChar(16), parent.visibility)
      .input('parentId', sql.BigInt, rootId)
      .query(`
        INSERT INTO dbo.tb_row_remarks
          (table_id, partition_key, record_key, detail_key, column_id, body, created_by, visibility, parent_id)
        OUTPUT INSERTED.id
        VALUES (@tableId, @partitionKey, @recordKey, -1, @columnId, @body, @actorId, @newVisibility, @parentId);
      `);
    await dependencies.createRequest(tx)
      .input('rootId', sql.BigInt, rootId)
      .query('UPDATE dbo.tb_row_remarks SET last_activity_at = SYSUTCDATETIME() WHERE id = @rootId;');
    await tx.commit();
    return fetchRemark(ctx, Number(inserted.recordset[0].id));
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}
```
Let op: `fetchRemark` na `commit` (buiten de try zou `rollback` na commit voorkomen) — zet `const id = ...; await tx.commit();` en roep `fetchRemark` aan **na** het try/catch-blok:
```js
  let replyId;
  try { ...; replyId = Number(inserted.recordset[0].id); await tx.commit(); }
  catch (error) { await tx.rollback(); throw error; }
  return fetchRemark(ctx, replyId);
```
Importeer `visibilitySql` is al aanwezig (Task 6 vorige feature). `FakeRequest` in de test registreert `transaction` → assertions werken.

- [ ] **Step 4:** PASS; hele bestand groen.
- [ ] **Step 5: Checkpoint** `feat: post replies on remarks`

---

### Task 4: Route — `parentId`

**Files:** Modify `server/routes/data.js` (POST remarks); Test `server/routes/data.test.js`

- [ ] **Step 1: Failing tests** (in bestaande `describe('POST /:tableKey/remarks — zichtbaarheid')`):
```js
  it('geeft parentId door', async () => {
    remarksService.addRemark = vi.fn().mockResolvedValue({ id: 1 });
    await withServer({ id: 4, role: 'employee' }, async (baseUrl) => {
      expect((await post(baseUrl, { parentId: 41 })).status).toBe(201);
    });
    expect(remarksService.addRemark.mock.calls[0][0].parentId).toBe(41);
  });

  it('weigert een ongeldige parentId met 400', async () => {
    remarksService.addRemark = vi.fn();
    await withServer({ id: 4, role: 'employee' }, async (baseUrl) => {
      expect((await post(baseUrl, { parentId: 'abc' })).status).toBe(400);
    });
    expect(remarksService.addRemark).not.toHaveBeenCalled();
  });
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:**
```js
    const parentId = req.body?.parentId === undefined || req.body?.parentId === null
      ? null
      : normalizePositiveId(req.body.parentId, 'parentId');
    // ...
      { tableKey, ...row, body, columnId, visibility, parentId },
```
(`normalizePositiveId` is al geïmporteerd in `data.js`; controleer de import.)
- [ ] **Step 4:** PASS. **Step 5: Checkpoint** `feat: accept parentId on remark create`

---

### Task 5: Activity-feed — `parentId` en `replyTo`

**Files:** Modify `server/services/RowActivityService.js`; Test `server/services/RowActivityService.test.js`

**Produces:** remark-activity-item: `parentId: number|null`, `replyTo: { id: number, authorName: string|null } | null`.

- [ ] **Step 1: Failing tests**
```js
describe('RowActivityService replies', () => {
  it('geeft remark-items parentId en replyTo', async () => {
    const harness = createHarness({ rows: [activityRow({
      source_id: 52, activity_type: 'remark', type_rank: 5, field_key: null, body: 'Re',
      visibility: 'vendor', author_role: 'admin', parent_id: 41, reply_to_name: 'Ann',
    })], totals: { remarks: 1, history: 0 } });
    const result = await harness.getRowActivity({ ...BASE_OPTIONS, kind: 'all', currentUser: { id: 9, role: 'admin' } });
    expect(harness.calls.query).toContain('reply_to_name');
    expect(result.items[0]).toMatchObject({ parentId: 41, replyTo: { id: 41, authorName: 'Ann' } });
  });

  it('root-remark heeft replyTo null; history-items dragen geen reply-velden', () => {
    const root = enrichRemarkActivity(mapActivityRow(activityRow({ activity_type: 'remark', type_rank: 5 })), [], { id: 1, role: 'admin' });
    expect(root).toMatchObject({ parentId: null, replyTo: null });
    const history = enrichRemarkActivity(mapActivityRow(activityRow()), [], { id: 1, role: 'admin' });
    expect(history).not.toHaveProperty('replyTo');
    expect(history).not.toHaveProperty('replyToName');
  });
});
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:**
  - Elke UNION-tak krijgt twee extra kolommen achteraan: eerste tak `, CAST(NULL AS BIGINT) parent_id, CAST(NULL AS NVARCHAR(256)) reply_to_name`; custom- en writeback-tak `, NULL, NULL`; remark-tak `, r.parent_id, COALESCE(pu.display_name, pu.email)` met
    ```sql
    LEFT JOIN dbo.tb_row_remarks pr ON pr.id=r.parent_id
    LEFT JOIN dbo.users pu ON pu.id=pr.created_by
    ```
  - `mapActivityRow`: `parentId: row.parent_id ? Number(row.parent_id) : null, replyToName: row.reply_to_name || null`.
  - `enrichRemarkActivity`: destructure ook `replyToName` (`const { visibility, authorRole, replyToName, ...rest } = item;`); voor remark: `replyTo: item.parentId ? { id: item.parentId, authorName: replyToName } : null`; voor niet-remarks ook `parentId` strippen (`const { visibility, authorRole, replyToName, parentId, ...rest }` in de niet-remark-tak).
- [ ] **Step 4:** PASS. **Step 5: Checkpoint** `feat: expose reply info in activity feed`

---

### Task 6: Client-state — thread-helpers + `useRowRemarks`

**Files:** Create `src/components/supplier/remarks/remarkThreads.js` (+ `remarkThreads.test.js`); Modify `remarksFormatters.js` (`toRemark`), `useRowRemarks.js`; Test `useRowRemarks.test.jsx`, `remarksFormatters.test.js`

**Produces:**
- `mergeThreadItems(current: Root[], incoming: Remark[]) → { items: Root[], missingRoot: boolean }` — roots (`parentId == null`) worden vooraan gezet/gededupliceerd (met `replies: []` als ontbreekt); replies worden achteraan het juiste gesprek gezet (dedupe op id), root krijgt `lastActivityAt` = reply.createdAt en schuift naar voren; onbekende root → `missingRoot: true`.
- `updateRemarkInThreads(items, remarkId, updater: (remark) => remark) → Root[]` — werkt roots én replies bij; behoudt `replies` van een root.
- `createRemark(body, columnId = null, visibility = null, parentId = null)`.

- [ ] **Step 1: Failing tests** `remarkThreads.test.js`
```js
import { describe, expect, it } from 'vitest';
import { mergeThreadItems, updateRemarkInThreads } from './remarkThreads';

const root = (id, extra = {}) => ({ id, parentId: null, replies: [], replyCount: 0, createdAt: '2026-10-01T10:00:00Z', ...extra });
const reply = (id, parentId, createdAt = '2026-10-07T10:00:00Z') => ({ id, parentId, createdAt, body: `r${id}` });

describe('mergeThreadItems', () => {
  it('zet een nieuwe root vooraan en dedupliceert', () => {
    const { items } = mergeThreadItems([root(1)], [root(2), root(1)]);
    expect(items.map((i) => i.id)).toEqual([2, 1]);
    expect(items[0].replies).toEqual([]);
  });

  it('hangt een reply aan zijn gesprek en schuift dat naar voren', () => {
    const { items, missingRoot } = mergeThreadItems([root(2), root(1)], [reply(9, 1)]);
    expect(missingRoot).toBe(false);
    expect(items.map((i) => i.id)).toEqual([1, 2]);
    expect(items[0]).toMatchObject({ replyCount: 1, lastActivityAt: '2026-10-07T10:00:00Z' });
    expect(items[0].replies.map((r) => r.id)).toEqual([9]);
  });

  it('dedupliceert een reply die al in het gesprek staat', () => {
    const start = [root(1, { replies: [reply(9, 1)], replyCount: 1 })];
    const { items } = mergeThreadItems(start, [reply(9, 1)]);
    expect(items[0].replies).toHaveLength(1);
  });

  it('meldt missingRoot voor een reply op een niet-geladen gesprek', () => {
    const { items, missingRoot } = mergeThreadItems([root(1)], [reply(9, 77)]);
    expect(missingRoot).toBe(true);
    expect(items.map((i) => i.id)).toEqual([1]);
  });
});

describe('updateRemarkInThreads', () => {
  it('werkt een root bij en behoudt zijn replies', () => {
    const start = [root(1, { replies: [reply(9, 1)] })];
    const items = updateRemarkInThreads(start, 1, () => ({ id: 1, isDeleted: true, parentId: null }));
    expect(items[0]).toMatchObject({ isDeleted: true });
    expect(items[0].replies).toHaveLength(1);
  });

  it('werkt een reply binnen het gesprek bij', () => {
    const start = [root(1, { replies: [reply(9, 1)] })];
    const items = updateRemarkInThreads(start, 9, (r) => ({ ...r, reactions: [{ emoji: '👍', count: 1 }] }));
    expect(items[0].replies[0].reactions).toHaveLength(1);
  });
});
```
`remarksFormatters.test.js`:
```js
  it('neemt parentId en replyTo mee uit een activity-remark', () => {
    const mapped = toRemark({ type: 'remark', sourceId: '52', body: 'x', parentId: 41, replyTo: { id: 41, authorName: 'Ann' } });
    expect(mapped).toMatchObject({ id: 52, parentId: 41, replyTo: { id: 41, authorName: 'Ann' } });
  });
```
`useRowRemarks.test.jsx`:
```js
  it('plaatst een reply in het juiste gesprek', async () => {
    apiRequest.mockImplementation(async (path, init) => {
      if (init?.method === 'POST') return { remark: { id: 9, parentId: 1, body: 'Re', createdAt: '2026-10-07T10:00:00Z' } };
      if (path.includes('/remarks?')) return { items: [{ id: 2, parentId: null, replies: [] }, { id: 1, parentId: null, replies: [] }], total: 2, nextCursor: null };
      return { items: [], totals: { remarks: 2 }, newestCursor: 'c1' };
    });
    const { result, unmount } = renderHook(() => useRowRemarks(OPTIONS));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await result.current.createRemark('Re', null, null, 1); });
    const post = apiRequest.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(post[1].body).toMatchObject({ body: 'Re', parentId: 1 });
    expect(result.current.items.map((i) => i.id)).toEqual([1, 2]);
    expect(result.current.items[0].replies.map((r) => r.id)).toEqual([9]);
    unmount();
  });

  it('herlaadt bij een polling-reply op een niet-geladen gesprek', async () => {
    let remarksCalls = 0;
    apiRequest.mockImplementation(async (path) => {
      if (path.includes('/remarks?')) { remarksCalls += 1; return { items: [{ id: 1, parentId: null, replies: [] }], total: 1, nextCursor: null }; }
      if (path.includes('afterCursor')) return { items: [{ type: 'remark', sourceId: '9', parentId: 77, body: 'x', createdAt: '2026-10-07T10:00:00Z' }], totals: { remarks: 2 }, newestCursor: 'c2' };
      return { items: [], totals: { remarks: 1 }, newestCursor: 'c1' };
    });
    const { unmount } = renderHook(() => useRowRemarks(OPTIONS));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    await act(async () => { await Promise.resolve(); });
    expect(remarksCalls).toBe(2);
    unmount();
  });
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementatie**

`remarkThreads.js`:
```js
import { normalizeRemarkId } from './remarksFormatters';

const sameId = (a, b) => String(normalizeRemarkId(a)) === String(normalizeRemarkId(b));

function asRoot(remark) {
  return { ...remark, replies: remark.replies || [], replyCount: remark.replyCount ?? (remark.replies || []).length };
}

/**
 * Voegt nieuwe remarks (roots en replies) samen met de geladen gesprekken. Een reply komt
 * onderaan zijn gesprek en schuift dat gesprek naar voren; een onbekend gesprek → missingRoot.
 */
export function mergeThreadItems(current, incoming) {
  let items = [...current];
  let missingRoot = false;
  // Oudste eerst verwerken zodat de nieuwste activiteit vooraan eindigt.
  [...incoming].reverse().forEach((remark) => {
    if (remark.parentId == null) {
      if (items.some((item) => sameId(item.id, remark.id))) return;
      items = [asRoot(remark), ...items];
      return;
    }
    const index = items.findIndex((item) => sameId(item.id, remark.parentId));
    if (index < 0) {
      missingRoot = true;
      return;
    }
    const thread = items[index];
    if (thread.replies.some((r) => sameId(r.id, remark.id))) return;
    const replies = [...thread.replies, remark];
    const updated = { ...thread, replies, replyCount: replies.length, lastActivityAt: remark.createdAt };
    items = [updated, ...items.slice(0, index), ...items.slice(index + 1)];
  });
  return { items, missingRoot };
}

export function updateRemarkInThreads(items, remarkId, updater) {
  return items.map((item) => {
    if (sameId(item.id, remarkId)) {
      return { ...updater(item), replies: item.replies, replyCount: item.replyCount };
    }
    if (!item.replies?.some((r) => sameId(r.id, remarkId))) return item;
    return {
      ...item,
      replies: item.replies.map((r) => (sameId(r.id, remarkId) ? updater(r) : r)),
    };
  });
}
```

`remarksFormatters.js` `toRemark` (activity-tak), na de visibility-regel:
```js
      parentId: item.parentId ?? null,
      ...(item.replyTo ? { replyTo: item.replyTo } : {}),
```

`useRowRemarks.js`:
- import `{ mergeThreadItems, updateRemarkInThreads } from './remarkThreads'`; `mergeNewest` niet meer gebruiken voor `items` (wel laten staan in formatters).
- `createRemark(body, columnId = null, visibility = null, parentId = null)`: body `...(parentId ? { parentId } : {})`; na response:
  ```js
  setItems((current) => mergeThreadItems(current, [remark]).items);
  ```
- `deleteRemark`: `setItems((current) => updateRemarkInThreads(current, remarkId, () => data.remark));`
- `toggleReaction`: `setItems((current) => updateRemarkInThreads(current, remarkId, (item) => ({ ...item, reactions: data?.reactions || [] })));`
- polling:
  ```js
  const newRemarks = (...).filter(isRemarkActivity).map(toRemark);
  let needsReload = false;
  setItems((current) => {
    const merged = mergeThreadItems(current, newRemarks);
    needsReload = merged.missingRoot;
    return merged.items;
  });
  ...
  if (needsReload) loadInitial();
  ```
  (`loadInitial` toevoegen aan de dependency-array van het polling-effect.) Omdat `setItems` met updater synchroon in de batch kan lopen maar niet gegarandeerd vóór de volgende regel, bereken `missingRoot` liever buiten de updater met een ref van de huidige items: houd `itemsRef.current = items` bij in een effect en gebruik `const merged = mergeThreadItems(itemsRef.current, newRemarks); setItems(merged.items); if (merged.missingRoot) loadInitial();`.

- [ ] **Step 4:** `npx vitest run src/components/supplier/remarks` → PASS.
- [ ] **Step 5: Checkpoint** `feat: keep remark threads in client state`

---

### Task 7: `RemarkReplyComposer`

**Files:** Create `src/components/supplier/remarks/RemarkReplyComposer.jsx`, Test `RemarkReplyComposer.test.jsx`

**Interface:** `RemarkReplyComposer({ authorName: string, visibility?: 'vendor'|'internal', showVisibility: boolean, onSubmit(body): Promise, onCancel() })`

- [ ] **Step 1: Failing tests**
```jsx
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import RemarkReplyComposer from './RemarkReplyComposer';

const renderIt = (props = {}) => render(
  <FluentProvider theme={webLightTheme}>
    <RemarkReplyComposer authorName="Ann" onSubmit={vi.fn().mockResolvedValue({})} onCancel={vi.fn()} showVisibility={false} {...props} />
  </FluentProvider>
);

describe('RemarkReplyComposer', () => {
  it('focust het tekstvak en toont Replying to', () => {
    renderIt();
    expect(screen.getByText('Replying to Ann')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Reply to Ann' })).toBe(document.activeElement);
  });

  it('Ctrl+Enter plaatst, lege tekst niet', async () => {
    const onSubmit = vi.fn().mockResolvedValue({});
    renderIt({ onSubmit });
    const box = screen.getByRole('textbox', { name: 'Reply to Ann' });
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: 'Thanks' } });
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Thanks'));
  });

  it('Esc annuleert en propageert niet', () => {
    const onCancel = vi.fn();
    const outer = vi.fn();
    render(
      <div onKeyDown={outer}>
        <FluentProvider theme={webLightTheme}>
          <RemarkReplyComposer authorName="Ann" onSubmit={vi.fn()} onCancel={onCancel} showVisibility={false} />
        </FluentProvider>
      </div>
    );
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Reply to Ann' }), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
    expect(outer).not.toHaveBeenCalled();
  });

  it('houdt tekst bij fout en toont melding', async () => {
    renderIt({ onSubmit: vi.fn().mockRejectedValue(new Error('Save failed')) });
    const box = screen.getByRole('textbox', { name: 'Reply to Ann' });
    fireEvent.change(box, { target: { value: 'Thanks' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Save failed');
    expect(box.value).toBe('Thanks');
  });

  it('toont visibility-chip alleen als showVisibility', () => {
    const { unmount } = renderIt({ showVisibility: true, visibility: 'internal' });
    expect(screen.getByText('Internal')).toBeTruthy();
    unmount();
    renderIt({ showVisibility: false, visibility: 'internal' });
    expect(screen.queryByText('Internal')).toBeNull();
  });
});
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:**
```jsx
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@fluentui/react-components';
import RemarkVisibilityBadge from './RemarkVisibilityBadge';

function RemarkReplyComposer({ authorName, visibility = null, showVisibility, onSubmit, onCancel }) {
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const textareaRef = useRef(null);
  const length = draft.normalize('NFC').trim().length;
  const invalid = length < 1 || length > 2000;

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const submit = useCallback(async () => {
    if (invalid || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await onSubmit(draft);
    } catch (submitError) {
      setError(submitError?.message || 'Failed to save reply');
      setSubmitting(false);
    }
  }, [draft, invalid, onSubmit, submitting]);

  const handleKeyDown = useCallback((event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    }
  }, [onCancel, submit]);

  return (
    <form
      className="remark-reply-composer"
      onSubmit={(event) => { event.preventDefault(); submit(); }}
    >
      <div className="remark-reply-composer-header">
        <span className="remarks-muted">Replying to {authorName}</span>
        {showVisibility ? <RemarkVisibilityBadge visibility={visibility} /> : null}
      </div>
      <textarea
        ref={textareaRef}
        aria-label={`Reply to ${authorName}`}
        rows={2}
        value={draft}
        maxLength={2000}
        disabled={submitting}
        onChange={(event) => { setDraft(event.target.value); setError(''); }}
        onKeyDown={handleKeyDown}
      />
      <div className="remark-reply-composer-actions">
        <Button appearance="secondary" size="small" type="button" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button appearance="primary" size="small" type="submit" disabled={invalid || submitting}>
          {submitting ? 'Saving…' : 'Reply'}
        </Button>
      </div>
      {error ? <div className="remarks-error" role="alert">{error}</div> : null}
    </form>
  );
}

export default memo(RemarkReplyComposer);
```
(Bij succes unmount de parent het venster; daarom alleen bij fout `setSubmitting(false)`.)
- [ ] **Step 4:** PASS. **Step 5: Checkpoint** `feat: inline reply composer`

---

### Task 8: `RemarkMessageCard` + `RemarkThread`

**Files:** Modify `RemarkMessageCard.jsx`; Create `RemarkThread.jsx`; Test `RemarksComponents.test.jsx`, `RemarkThread.test.jsx`

**Interfaces:**
- `RemarkMessageCard` extra props: `onReply?: () => void`, `replyButtonRef?: Ref`, `compact?: boolean`. Toont `↳ Reply to {remark.replyTo.authorName}` als `remark.replyTo`.
- `RemarkThread({ remark, currentUser, remarkActions, canReply, replyOpen, onOpenReply(id), onCloseReply(), onSubmitReply(rootId, body): Promise, showVisibility })`

- [ ] **Step 1: Failing tests** `RemarksComponents.test.jsx` (in describe 'zichtbaarheid' of nieuw describe):
```jsx
  it('toont Reply-knop alleen met onReply en niet op tombstone', () => {
    const onReply = vi.fn();
    const { unmount } = renderWithFluent(<RemarkMessageCard remark={{ ...base }} currentUser={{ id: 9 }} onDelete={vi.fn()} onReaction={vi.fn()} onReply={onReply} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reply to Ann' }));
    expect(onReply).toHaveBeenCalled();
    unmount();
    renderWithFluent(<RemarkMessageCard remark={{ ...base, isDeleted: true }} currentUser={{ id: 9 }} onDelete={vi.fn()} onReaction={vi.fn()} onReply={onReply} />);
    expect(screen.queryByRole('button', { name: 'Reply to Ann' })).toBeNull();
  });

  it('toont Reply to-regel bij replyTo', () => {
    renderWithFluent(<RemarkMessageCard remark={{ ...base, replyTo: { id: 1, authorName: 'Bob' } }} currentUser={{ id: 9 }} onDelete={vi.fn()} onReaction={vi.fn()} />);
    expect(screen.getByText('↳ Reply to Bob')).toBeTruthy();
  });
```
(`base` uit de bestaande describe; als die buiten scope ligt, herdefinieer `const base = { id: 1, body: 'x', author: { id: 2, displayName: 'Ann' }, reactions: [], createdAt: '2026-10-07T10:00:00Z' };`.)

`RemarkThread.test.jsx`:
```jsx
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import RemarkThread from './RemarkThread';

const reply = (id, body) => ({ id, parentId: 1, body, author: { id: 3, displayName: 'Bob' }, reactions: [], createdAt: `2026-10-07T10:0${id % 10}:00Z` });
const root = (replies = []) => ({ id: 1, parentId: null, body: 'Root', visibility: 'internal', author: { id: 2, displayName: 'Ann' }, reactions: [], createdAt: '2026-10-07T09:00:00Z', replies, replyCount: replies.length });
const actions = { onDelete: vi.fn(), onReaction: vi.fn() };

function renderThread(props = {}) {
  const defaults = {
    remark: root(), currentUser: { id: 9 }, remarkActions: actions, canReply: true, replyOpen: false,
    onOpenReply: vi.fn(), onCloseReply: vi.fn(), onSubmitReply: vi.fn().mockResolvedValue({}), showVisibility: true,
  };
  const all = { ...defaults, ...props };
  return { ...render(<FluentProvider theme={webLightTheme}><RemarkThread {...all} /></FluentProvider>), props: all };
}

describe('RemarkThread', () => {
  it('toont maximaal 2 replies met Show earlier-link', () => {
    renderThread({ remark: root([reply(11, 'a'), reply(12, 'b'), reply(13, 'c'), reply(14, 'd')]) });
    expect(screen.queryByText('a')).toBeNull();
    expect(screen.getByText('c')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 earlier replies' }));
    expect(screen.getByText('a')).toBeTruthy();
  });

  it('enkelvoud bij 1 verborgen reply', () => {
    renderThread({ remark: root([reply(11, 'a'), reply(12, 'b'), reply(13, 'c')]) });
    expect(screen.getByRole('button', { name: 'Show 1 earlier reply' })).toBeTruthy();
  });

  it('replies-lijst heeft toegankelijk label en replies hebben geen Reply-knop', () => {
    renderThread({ remark: root([reply(11, 'a')]) });
    expect(screen.getByRole('list', { name: "Replies to Ann's remark" })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Reply to/ })).toHaveLength(1);
  });

  it('opent composer via Reply en plaatst naar de root', async () => {
    const { props, rerender } = renderThread();
    fireEvent.click(screen.getByRole('button', { name: 'Reply to Ann' }));
    expect(props.onOpenReply).toHaveBeenCalledWith(1);
    rerender(<FluentProvider theme={webLightTheme}><RemarkThread {...props} replyOpen /></FluentProvider>);
    fireEvent.change(screen.getByRole('textbox', { name: 'Reply to Ann' }), { target: { value: 'Ok' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    await waitFor(() => expect(props.onSubmitReply).toHaveBeenCalledWith(1, 'Ok'));
    expect(props.onCloseReply).toHaveBeenCalled();
  });

  it('geen Reply-knop zonder canReply', () => {
    renderThread({ canReply: false });
    expect(screen.queryByRole('button', { name: 'Reply to Ann' })).toBeNull();
  });
});
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementatie**

`RemarkMessageCard.jsx`:
- import `ArrowReplyRegular` uit `@fluentui/react-icons`.
- signature `function RemarkMessageCard({ remark, currentUser, onDelete, onReaction, onReply = null, replyButtonRef = null, compact = false })`.
- Avatar `size={compact ? 24 : 28}`; article class `+ (compact ? ' remark-card--compact' : '')`.
- Vóór de body: `{remark?.replyTo ? <span className="remark-reply-to remarks-muted">↳ Reply to {remark.replyTo.authorName || 'Unknown user'}</span> : null}`
- Vervang het reaction-blok door:
```jsx
      {!remark?.isDeleted ? (
        <div className="remark-card-footer">
          <RemarkReactionBar remarkId={remark.id} reactions={remark.reactions} ownRemark={ownRemark} onToggle={onReaction} />
          {onReply ? (
            <Button
              ref={replyButtonRef}
              appearance="subtle"
              size="small"
              icon={<ArrowReplyRegular />}
              aria-label={`Reply to ${authorName}`}
              onClick={onReply}
            >
              Reply
            </Button>
          ) : null}
        </div>
      ) : null}
```

`RemarkThread.jsx`:
```jsx
import React, { memo, useCallback, useRef, useState } from 'react';
import { Button } from '@fluentui/react-components';
import RemarkMessageCard from './RemarkMessageCard';
import RemarkReplyComposer from './RemarkReplyComposer';

const VISIBLE_REPLIES = 2;

function RemarkThread({
  remark, currentUser, remarkActions, canReply, replyOpen,
  onOpenReply, onCloseReply, onSubmitReply, showVisibility,
}) {
  const [expanded, setExpanded] = useState(false);
  const [highlightId, setHighlightId] = useState(null);
  const replyButtonRef = useRef(null);
  const replies = remark.replies || [];
  const hiddenCount = expanded ? 0 : Math.max(0, replies.length - VISIBLE_REPLIES);
  const shownReplies = replies.slice(hiddenCount);
  const authorName = remark?.author?.displayName || remark?.author?.email || 'Unknown user';

  const close = useCallback(() => {
    onCloseReply();
    requestAnimationFrame(() => replyButtonRef.current?.focus());
  }, [onCloseReply]);

  const submit = useCallback(async (body) => {
    const created = await onSubmitReply(remark.id, body);
    setHighlightId(created?.id ?? null);
    close();
  }, [close, onSubmitReply, remark.id]);

  const visibilityClass = showVisibility && remark.visibility ? ` remark-thread--${remark.visibility}` : '';

  return (
    <div className={`remark-thread${visibilityClass}`}>
      <RemarkMessageCard
        remark={remark}
        currentUser={currentUser}
        onDelete={remarkActions.onDelete}
        onReaction={remarkActions.onReaction}
        onReply={canReply && !remark.isDeleted ? () => onOpenReply(remark.id) : null}
        replyButtonRef={replyButtonRef}
      />
      {replies.length > 0 || replyOpen ? (
        <div className="remark-thread-replies">
          {hiddenCount > 0 ? (
            <Button appearance="transparent" size="small" onClick={() => setExpanded(true)}>
              {hiddenCount === 1 ? 'Show 1 earlier reply' : `Show ${hiddenCount} earlier replies`}
            </Button>
          ) : null}
          {shownReplies.length > 0 ? (
            <ul className="remark-thread-list" aria-label={`Replies to ${authorName}'s remark`}>
              {shownReplies.map((reply) => (
                <li key={reply.id} className={reply.id === highlightId ? 'remark-reply--new' : undefined}>
                  <RemarkMessageCard
                    remark={reply}
                    currentUser={currentUser}
                    onDelete={remarkActions.onDelete}
                    onReaction={remarkActions.onReaction}
                    compact
                  />
                </li>
              ))}
            </ul>
          ) : null}
          {replyOpen ? (
            <RemarkReplyComposer
              authorName={authorName}
              visibility={remark.visibility}
              showVisibility={showVisibility}
              onSubmit={submit}
              onCancel={close}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default memo(RemarkThread);
```
(Badges op replies: geef replies geen `visibility` mee aan de kaart → in `RemarkThread` `remark={{ ...reply, visibility: undefined }}` zodat `RemarkVisibilityBadge` niets toont en er geen accentrand op replies komt. Pas dat toe in de `shownReplies.map`.)

- [ ] **Step 4:** PASS. **Step 5: Checkpoint** `feat: remark threads with replies`

---

### Task 9: Feed + panel-wiring + CSS

**Files:** Modify `RowActivityFeed.jsx`, `RemarksPanel.jsx`, `remarks.css`; Test `RemarksPanel.test.jsx`

**Consumes:** `RemarkThread` (Task 8), `createRemark(body, columnId, visibility, parentId)` (Task 6).

- [ ] **Step 1: Failing tests** `RemarksPanel.test.jsx`
```jsx
  describe('replies', () => {
    const SC = { id: 4, role: 'supply_chain', displayName: 'Sam Chain' };
    const thread = {
      id: 1, parentId: null, body: 'Root remark', visibility: 'internal', author: { id: 7, displayName: 'Ann' },
      reactions: [], createdAt: '2026-10-07T09:00:00Z', lastActivityAt: '2026-10-07T09:00:00Z',
      replies: [{ id: 5, parentId: 1, body: 'First reply', visibility: 'internal', author: { id: 8, displayName: 'Bob' }, reactions: [], createdAt: '2026-10-07T09:30:00Z' }],
      replyCount: 1,
    };

    beforeEach(() => {
      apiRequest.mockImplementation(async (path, init) => {
        if (init?.method === 'POST') return { remark: { id: 6, parentId: 1, body: 'New reply', author: { id: 4, displayName: 'Sam Chain' }, reactions: [], createdAt: '2026-10-07T10:00:00Z' } };
        if (path.includes('/remarks?')) return { items: [thread], total: 2, nextCursor: null };
        return responseFor(path);
      });
    });

    it('toont het gesprek en plaatst een reply in stand All', async () => {
      renderPanel({ currentUser: SC });
      expect(await screen.findByText('First reply')).toBeTruthy();
      expect(screen.getByRole('radio', { name: 'All' }).checked).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Reply to Ann' }));
      expect(screen.getByText('Replying to Ann')).toBeTruthy();
      fireEvent.change(screen.getByRole('textbox', { name: 'Reply to Ann' }), { target: { value: 'New reply' } });
      fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
      expect(await screen.findByText('New reply')).toBeTruthy();
      const post = apiRequest.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(post[1].body).toMatchObject({ parentId: 1 });
      expect(post[1].body).not.toHaveProperty('visibility');
    });

    it('opent maar één reply-venster tegelijk', async () => {
      apiRequest.mockImplementation(async (path) => (
        path.includes('/remarks?')
          ? { items: [thread, { ...thread, id: 2, body: 'Other', author: { id: 9, displayName: 'Cas' }, replies: [] }], total: 3, nextCursor: null }
          : responseFor(path)
      ));
      renderPanel({ currentUser: SC });
      await screen.findByText('Other');
      fireEvent.click(screen.getByRole('button', { name: 'Reply to Ann' }));
      fireEvent.click(screen.getByRole('button', { name: 'Reply to Cas' }));
      expect(screen.queryByText('Replying to Ann')).toBeNull();
      expect(screen.getByText('Replying to Cas')).toBeTruthy();
    });
  });
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementatie**

`RowActivityFeed.jsx`: nieuwe props `threaded = false`, `threadProps = null` (`{ canReply, replyOpenId, onOpenReply, onCloseReply, onSubmitReply, showVisibility }`).
- `buildFeedRows(items, threaded)`: dag-label op `threaded ? (item.lastActivityAt || item.createdAt) : getActivityTimestamp(toRemark(item))`.
- In `renderRow` voor `rowType === 'remark'` en `threaded`:
```jsx
          <RemarkThread
            key={row.id}
            remark={toRemark(row.item)}
            currentUser={currentUser}
            remarkActions={remarkActions}
            canReply={threadProps.canReply}
            replyOpen={String(threadProps.replyOpenId) === String(toRemark(row.item).id)}
            onOpenReply={threadProps.onOpenReply}
            onCloseReply={threadProps.onCloseReply}
            onSubmitReply={threadProps.onSubmitReply}
            showVisibility={threadProps.showVisibility}
          />
```
(deps `threaded`, `threadProps` toevoegen.)

`RemarksPanel.jsx`:
```jsx
  const [replyOpenId, setReplyOpenId] = useState(null);
  const handleSubmitReply = useCallback(
    async (rootId, body) => {
      const remark = await controller.remarks.createRemark(body, null, null, rootId);
      return remark;
    },
    [controller.remarks]
  );
  const threadProps = useMemo(() => ({
    canReply: canCompose && canWrite,
    replyOpenId,
    onOpenReply: setReplyOpenId,
    onCloseReply: () => setReplyOpenId(null),
    onSubmitReply: handleSubmitReply,
    showVisibility: canChooseVisibility,
  }), [canChooseVisibility, canCompose, canWrite, handleSubmitReply, replyOpenId]);
```
en op de `RowActivityFeed` van tab **remarks**: `threaded threadProps={threadProps}`. (Tab All blijft niet-threaded, zonder Reply.) Reset `replyOpenId` bij rijwissel: `useEffect(() => setReplyOpenId(null), [row?.partitionKey, row?.recordKey]);`

`remarks.css` (achteraan):
```css
/* Gesprekken: replies ingesprongen met lijn in de visibility-kleur van de root. */
.remark-thread {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.remark-thread-replies {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-left: 24px;
  padding-left: 12px;
  border-left: 2px solid var(--colorNeutralStroke2);
}

.remark-thread--internal .remark-thread-replies {
  border-left-color: var(--colorPaletteMarigoldBorderActive);
}

.remark-thread--vendor .remark-thread-replies {
  border-left-color: var(--colorBrandStroke1);
}

.remark-thread-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.remark-card--compact {
  padding: 8px 10px;
}

.remark-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.remark-reply-to {
  display: block;
}

.remark-reply-composer {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border-radius: 6px;
  background: var(--colorNeutralBackground2);
}

.remark-reply-composer-header,
.remark-reply-composer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.remark-reply-composer-actions {
  justify-content: flex-end;
}

.remark-reply-composer textarea {
  resize: vertical;
  padding: 6px 8px;
  border: 1px solid var(--colorNeutralStroke1);
  border-radius: 4px;
  background: var(--colorNeutralBackground1);
  color: var(--colorNeutralForeground1);
  font: inherit;
}

.remark-reply--new > .remark-card {
  animation: remark-reply-highlight 1.6s ease-out;
}

@keyframes remark-reply-highlight {
  from { background: var(--colorBrandBackground2); }
  to { background: var(--colorNeutralBackground1); }
}

@media (max-width: 480px) {
  .remark-thread-replies {
    margin-left: 16px;
    padding-left: 8px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .remark-reply--new > .remark-card {
    animation: none;
  }
}
```
- [ ] **Step 4:** `npx vitest run src/components/supplier/remarks` → PASS.
- [ ] **Step 5: Checkpoint** `feat: wire remark replies into the panel`

---

### Task 10: Eindverificatie

- [ ] `npx vitest run server` en `npx vitest run src` → groen (output noteren; volledige suite duurt ~20 min, apart per map draaien).
- [ ] `npm run build` → OK. Lint: `ESLINT_USE_FLAT_CONFIG=false npx eslint <gewijzigde niet-test-bestanden>` → 0 errors.
- [ ] Migratie 054 (na akkoord) twee keer draaien; `last_activity_at` zonder NULLs.
- [ ] Handmatig op `http://localhost:5178`:
  1. Supply Chain: reply op interne root in stand All → reply verschijnt, gesprek bovenaan, chip "Internal" in venster.
  2. Vendor: reply op vendor-root → zichtbaar voor vendor en Supply Chain, niet voor employee.
  3. Employee: ziet interne gesprekken + replies; geen vendor-gesprekken.
  4. 4 replies → "Show 2 earlier replies".
  5. Tweede browser: reply plaatsen → verschijnt binnen ~5 s in eerste browser in het juiste gesprek.
  6. Root verwijderen → tombstone met replies; geen Reply-knop.
  7. Tab All: reply toont "↳ Reply to …".
- [ ] Onafhankelijke eindreview (fresh reviewer) op de diff.
