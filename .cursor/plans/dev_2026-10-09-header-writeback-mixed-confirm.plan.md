# Header write-back: bevestiging bij afwijkende regelwaarden + D365-redenen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff krijgt een bevestiging voordat een gepushte header-edit afwijkende regelwaarden (`+N`) overschrijft, ziet per mislukte regel de opgeschoonde D365-reden, en een order met deels geslaagde regels telt als *Partially updated*.

**Architecture:** Server levert per mislukte regel een opgeschoonde reden (`summarizeD365WriteError`) naast de ruwe tekst; `correct-all-details` geeft statusfouten door zoals `/correct`. Client formatteert die failures, propageert een `partial`-uitkomst door de bestaande achtergrondjob, en vraagt vóór de job een bevestiging op basis van de al aanwezige `linkedLineValues` (geen extra requests).

**Tech Stack:** Express + `mssql` (server), React 18 + Fluent UI v9 (client), Vitest + Testing Library.

**Spec:** `docs/specs/2026-10-09-header-writeback-mixed-confirm-design.md` (vervolg op `docs/specs/2026-09-02-header-push-line-writeback-design.md`, #AB:302).

## Global Constraints

- UI-tekst Engels (labels, meldingen, `aria-label`), zie `.cursor/rules/app-taal.mdc`.
- Fluent UI v9 componenten + `tokens`; geen dialoog/portal in herhaalde header-cellen — dialogen op pagina-niveau (`PurchaseOrdersPageDialogs.jsx`).
- Componenten/hooks ≤300 regels.
- Frontend-calls alleen via `apiRequest` (`src/utils/api.js`).
- Geen nieuwe D365-calls; etag/`basedOnValue`-concurrency ongewijzigd; `tb_field_corrections.error` blijft de ruwe tekst.
- Retry-gedrag ongewijzigd (ook beschikbaar voor permanente D365-fouten).
- Staff-gate in de UI ongewijzigd.
- Versie: `src/config/version.js` PATCH +1 (`v1.73.23` → `v1.73.24`).
- OTAP: DevOps-flow — feature-branch, commits per taak, **geen push** zonder expliciet verzoek.

## Review Focus

- D365-melding zonder `Infolog:` (bijv. `PurchaseOrderName is locked`) → leesbare tekst zonder URL/prefix, nooit een lege melding. (Task 1)
- Order waar **alle** regels falen → `failed`, niet `partial`; tekst zonder "0 of 2 lines updated". (Task 3, Task 4)
- `linkedLineValues` met lege/`-`/`null`-waarden naast één echte waarde (bv. `['test', '', null]`) → geen bevestiging (telt als 1 unieke waarde, gelijk aan de server-rollup). (Task 6)
- Cancel in de bevestiging → cel toont de oude waarde zonder foutstatus, geen API-call, geen job. (Task 6)
- Bulk met de beslisdialoog open → nooit twee dialogen tegelijk; de beslisdialoog sluit vóór de bevestiging opent. (Task 6)

---

### Task 0: DevOps-story + feature-branch

**Files:** geen code.

- [ ] **Step 1: Maak de User Story in Vendor-App**

Token: `az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv`.
POST `https://dev.azure.com/reyniervanbommel0745/Vendor-App/_apis/wit/workitems/$User%20Story?api-version=7.1` met `Content-Type: application/json-patch+json`:

```json
[
  {"op":"add","path":"/fields/System.Title","value":"Header write-back: confirm on mixed line values + show D365 reasons"},
  {"op":"add","path":"/fields/System.Description","value":"Vervolg op #302. Spec: docs/specs/2026-10-09-header-writeback-mixed-confirm-design.md. Aanleiding PROD 2026-10-09: whsl|WSPO-0422062 regel 20 geweigerd door D365 (Item 'L-10780-02' is blocked for 'Purchase order'), UI toonde alleen 'Write-back failed on 1 of 2 lines' en 'Updated: 0'."},
  {"op":"add","path":"/relations/-","value":{"rel":"System.LinkTypes.Hierarchy-Reverse","url":"https://dev.azure.com/reyniervanbommel0745/_apis/wit/workItems/130"}},
  {"op":"add","path":"/relations/-","value":{"rel":"System.LinkTypes.Related","url":"https://dev.azure.com/reyniervanbommel0745/_apis/wit/workItems/302"}}
]
```

Expected: 200 met `id`. Noteer het id als `404` voor de rest van het plan.

- [ ] **Step 2: Feature-branch**

```bash
git switch -c feature/404-header-writeback-mixed-confirm
git add docs/specs/2026-10-09-header-writeback-mixed-confirm-design.md .cursor/plans/dev_2026-10-09-header-writeback-mixed-confirm.plan.md
git commit -m "docs: spec en plan header write-back bevestiging + D365-redenen #AB:404"
```

Let op: `src/components/auth/LoginPage.jsx` en `public/login-illustration.png` zijn ongerelateerde lokale wijzigingen — **niet** stagen.

---

### Task 1: `summarizeD365WriteError` (server-util)

**Files:**
- Create: `server/utils/d365ErrorSummary.js`
- Test: `server/utils/d365ErrorSummary.test.js`

**Interfaces:**
- Produces: `summarizeD365WriteError(message: string): string` (CommonJS export).

- [ ] **Step 1: Write the failing test**

```js
'use strict';

const { summarizeD365WriteError } = require('./d365ErrorSummary');

const PROD_FIXTURE = "D365 OData request failed (400): /data/PurchaseOrderLinesV2(dataAreaId='whsl',PurchaseOrderNumber='WSPO-0422062',LineNumber=20): Write failed for table row of type 'PurchPurchaseOrderLineV2Entity'. Infolog: Warning: Item 'L-10780-02' is blocked for 'Purchase order'.; Warning: validateWrite failed on data source 'PurchLine (PurchLine)'.";

describe('summarizeD365WriteError', () => {
  it('haalt de Infolog-reden uit de PROD-melding van 2026-10-09', () => {
    expect(summarizeD365WriteError(PROD_FIXTURE)).toBe("Item 'L-10780-02' is blocked for 'Purchase order'.");
  });

  it('dedupliceert en combineert meerdere Infolog-regels', () => {
    const msg = "D365 OData request failed (400): /data/PurchaseOrderLinesV2(dataAreaId='a',PurchaseOrderNumber='P',LineNumber=1): Infolog: Error: Price is missing.; Warning: Price is missing.; Error: Site is closed.";
    expect(summarizeD365WriteError(msg)).toBe('Price is missing. Site is closed.');
  });

  it('strip prefix en entity-pad als er geen Infolog is', () => {
    const msg = "D365 OData request failed (400): /data/PurchaseOrderLinesV2(dataAreaId='whsl',PurchaseOrderNumber='PO-1',LineNumber=1): PurchaseOrderName is locked";
    expect(summarizeD365WriteError(msg)).toBe('PurchaseOrderName is locked');
  });

  it('valt terug op het origineel als alleen ruis overblijft', () => {
    const msg = "D365 OData request failed (400): /data/PurchaseOrderLinesV2(dataAreaId='a',PurchaseOrderNumber='P',LineNumber=1): Write failed for table row of type 'X'.";
    expect(summarizeD365WriteError(msg)).toBe(msg);
  });

  it('laat app-meldingen (409 concurrency) ongewijzigd', () => {
    const msg = 'The value changed in D365 since you read it. Refresh first and try again.';
    expect(summarizeD365WriteError(msg)).toBe(msg);
  });

  it('geeft een lege string bij lege input', () => {
    expect(summarizeD365WriteError('')).toBe('');
    expect(summarizeD365WriteError(undefined)).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/utils/d365ErrorSummary.test.js`
Expected: FAIL — `Cannot find module './d365ErrorSummary'`.

- [ ] **Step 3: Write minimal implementation**

```js
'use strict';

// Maakt een D365 OData-schrijffout leesbaar voor de gebruiker: alleen de Infolog-reden,
// zonder prefix, entity-pad en generieke ruis. De ruwe tekst blijft in tb_field_corrections.
const ODATA_PREFIX = /^D365 OData request failed \(\d+\)\s*:\s*/i;
const ENTITY_PATH = /^\/data\/[^:]*?\)\s*:\s*/i;
const LEVEL_PREFIX = /^(warning|error|info)\s*:\s*/i;
const NOISE = [
  /^validateWrite failed on data source\b/i,
  /^Write failed for table row of type\b/i,
];

function cleanPart(part) {
  return String(part || '').trim().replace(LEVEL_PREFIX, '').trim();
}

function isNoise(text) {
  return !text || NOISE.some((re) => re.test(text));
}

function uniqueParts(parts) {
  const seen = new Set();
  const result = [];
  for (const raw of parts) {
    const text = cleanPart(raw);
    if (isNoise(text) || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function summarizeD365WriteError(message) {
  const original = String(message || '').trim();
  if (!original) return '';
  if (!ODATA_PREFIX.test(original)) return original;

  const infologIndex = original.search(/Infolog\s*:/i);
  if (infologIndex >= 0) {
    const infolog = original.slice(infologIndex).replace(/^Infolog\s*:\s*/i, '');
    const parts = uniqueParts(infolog.split(';'));
    if (parts.length) return parts.join(' ');
  }

  const detail = original.replace(ODATA_PREFIX, '').replace(ENTITY_PATH, '').trim();
  const parts = uniqueParts(detail.split(/(?<=\.)\s+/));
  return parts.length ? parts.join(' ') : original;
}

module.exports = { summarizeD365WriteError };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/utils/d365ErrorSummary.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add server/utils/d365ErrorSummary.js server/utils/d365ErrorSummary.test.js
git commit -m "feat: D365-schrijffout opschonen tot Infolog-reden #AB:404"
```

---

### Task 2: Fan-out failures met opgeschoonde reden + route-passthrough

**Files:**
- Modify: `server/services/TableDataService.js` (`correctAllDetailFields`, catch in de regel-loop rond regel 5340)
- Modify: `server/routes/data.js:646-665` (`POST /:tableKey/correct-all-details`)
- Test: `server/services/correctAllDetailFields.test.js`, `server/routes/data.test.js`

**Interfaces:**
- Consumes: `summarizeD365WriteError` (Task 1).
- Produces: response `failures: Array<{ detailKey: number, message: string, rawMessage?: string }>` — `message` opgeschoond.

- [ ] **Step 1: Write the failing tests**

Toevoegen aan `server/services/correctAllDetailFields.test.js` (gebruikt bestaande `baseDeps`, `params`, `STAFF`):

```js
describe('correctAllDetailFields failure-redenen', () => {
  it('geeft per mislukte regel een opgeschoonde reden en de ruwe melding', async () => {
    const raw = "D365 OData request failed (400): /data/PurchaseOrderLinesV2(dataAreaId='nl01',PurchaseOrderNumber='PO-1',LineNumber=2): Write failed for table row of type 'PurchPurchaseOrderLineV2Entity'. Infolog: Warning: Item 'L-1' is blocked for 'Purchase order'.; Warning: validateWrite failed on data source 'PurchLine (PurchLine)'.";
    const deps = baseDeps({
      correctOne: vi.fn()
        .mockResolvedValueOnce({ success: true })
        .mockRejectedValueOnce(Object.assign(new Error(raw), { status: 400 })),
    });
    const result = await correctAllDetailFields(params, STAFF, deps);
    expect(result).toMatchObject({ attempted: 2, updated: 1, failed: 1, updatedDetailKeys: [1] });
    expect(result.failures).toEqual([
      { detailKey: 2, message: "Item 'L-1' is blocked for 'Purchase order'.", rawMessage: raw },
    ]);
  });
});
```

Toevoegen aan `server/routes/data.test.js` (zelfde opzet als het `/correct`-blok op regel 182):

```js
describe('POST /:tableKey/correct-all-details — foutdetail in productie', () => {
  const originalCorrectAll = dataService.correctAllDetailFields;
  const originalAppEnv = process.env.APP_ENV;

  afterEach(() => {
    dataService.correctAllDetailFields = originalCorrectAll;
    process.env.APP_ENV = originalAppEnv;
  });

  it('geeft err.message door met err.status, ook als errorHandler in productie draait', async () => {
    process.env.APP_ENV = 'production';
    const err = Object.assign(new Error('Header write-back requires a writable line column'), { status: 400 });
    dataService.correctAllDetailFields = vi.fn().mockRejectedValue(err);

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 1, role: 'employee' }; next(); });
    app.use('/api/data', dataRouter);
    app.use(errorHandler);

    const server = await new Promise((resolve) => {
      const instance = app.listen(0, () => resolve(instance));
    });
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/data/purchase-orders/correct-all-details`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columnId: 1, partitionKey: 'WHSL', recordKey: 'PO-1', value: 'x' }),
      });
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error).toBe('Header write-back requires a writable line column');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/services/correctAllDetailFields.test.js server/routes/data.test.js`
Expected: FAIL — failure `message` is de ruwe tekst / geen `rawMessage`; route geeft `500`/`An error occurred`.

- [ ] **Step 3: Implementatie**

`server/services/TableDataService.js` — bovenaan bij de andere util-requires:

```js
const { summarizeD365WriteError } = require('../utils/d365ErrorSummary');
```

In `correctAllDetailFields`, de business-error-tak in de `catch` vervangen:

```js
        if (isBusinessWriteBackError(err)) {
          failures.push({
            detailKey: line.detailKey,
            message: summarizeD365WriteError(err.message) || GENERIC_DETAIL_WRITEBACK_FAIL,
            rawMessage: err.message,
          });
          continue;
        }
```

`server/routes/data.js` — catch van `correct-all-details`:

```js
  } catch (err) {
    // Zelfde passthrough als /correct: productie-errorHandler mag validatie-/D365-detail niet maskeren.
    if (err.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/services/correctAllDetailFields.test.js server/routes/data.test.js server/utils/detailCorrectionFanout.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/TableDataService.js server/routes/data.js server/services/correctAllDetailFields.test.js server/routes/data.test.js
git commit -m "feat: opgeschoonde D365-reden per regel en foutdetail bij header-fan-out #AB:404"
```

---

### Task 3: Client-fouttekst per regel + partial-flag op de fout

**Files:**
- Create: `src/utils/lineWriteBackFailureText.js`
- Test: `src/utils/lineWriteBackFailureText.test.js`
- Modify: `src/hooks/usePurchaseOrderCorrectAllLines.js:33-37`
- Test: `src/hooks/usePurchaseOrderCorrectAllLines.test.js`

**Interfaces:**
- Consumes: server-response `{ attempted, updated, failed, failures: [{ detailKey, message }] }` (Task 2).
- Produces:
  - `formatLineFailures(failures, { max = 3 } = {}): string`
  - `formatCorrectAllFailure({ updated, attempted, failed, failures }): string`
  - Fout uit `onCorrectAllLines`: `Error` met `.message` (geformatteerd), `.remainingDisplayValue`, `.failures`, `.updated: number`, `.attempted: number`, `.partial: boolean` (`updated > 0`).

- [ ] **Step 1: Write the failing tests**

`src/utils/lineWriteBackFailureText.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { formatCorrectAllFailure, formatLineFailures } from './lineWriteBackFailureText';

const blocked = { detailKey: 20, message: "Item 'L-10780-02' is blocked for 'Purchase order'." };

describe('formatLineFailures', () => {
  it('toont één regel met nummer en reden', () => {
    expect(formatLineFailures([blocked])).toBe("Line 20: Item 'L-10780-02' is blocked for 'Purchase order'.");
  });

  it('zet een punt achter een reden zonder leesteken', () => {
    expect(formatLineFailures([{ detailKey: 1, message: 'PurchaseOrderName is locked' }]))
      .toBe('Line 1: PurchaseOrderName is locked.');
  });

  it('toont maximaal 3 regels plus "+N more"', () => {
    const failures = [1, 2, 3, 4, 5].map((n) => ({ detailKey: n, message: 'Blocked.' }));
    expect(formatLineFailures(failures))
      .toBe('Line 1: Blocked. Line 2: Blocked. Line 3: Blocked. (+2 more)');
  });

  it('geeft een lege string zonder failures', () => {
    expect(formatLineFailures([])).toBe('');
    expect(formatLineFailures(undefined)).toBe('');
  });
});

describe('formatCorrectAllFailure', () => {
  it('partial: aantal bijgewerkt plus regelreden', () => {
    expect(formatCorrectAllFailure({ updated: 1, attempted: 2, failed: 1, failures: [blocked] }))
      .toBe("1 of 2 lines updated. Line 20: Item 'L-10780-02' is blocked for 'Purchase order'.");
  });

  it('alles mislukt: alleen de regelredenen', () => {
    expect(formatCorrectAllFailure({ updated: 0, attempted: 1, failed: 1, failures: [blocked] }))
      .toBe("Line 20: Item 'L-10780-02' is blocked for 'Purchase order'.");
  });

  it('zonder failure-detail: generieke telling', () => {
    expect(formatCorrectAllFailure({ updated: 0, attempted: 2, failed: 2, failures: [] }))
      .toBe('Write-back failed on 2 of 2 lines.');
  });
});
```

Toevoegen aan `src/hooks/usePurchaseOrderCorrectAllLines.test.js`:

```js
  it('gooit een fout met regelredenen en partial-flag', async () => {
    apiRequest.mockResolvedValue({
      attempted: 2, updated: 1, skipped: 0, failed: 1,
      failures: [{ detailKey: 20, message: "Item 'L-1' is blocked for 'Purchase order'." }],
      remainingValues: ['test', 'Reference'],
      updatedDetailKeys: [10],
    });
    const { result } = renderHook(() => usePurchaseOrderCorrectAllLines({
      patchLinkedLineValues: vi.fn(), applyLineValuesBatch: vi.fn(),
    }));
    await expect(result.current.onCorrectAllLines({
      lineColumnId: 44, lineColumnKey: 'ext', headerColumnKey: 'extValues',
      dataAreaId: 'whsl', orderNumber: 'WSPO-1', value: 'test',
    })).rejects.toMatchObject({
      message: "1 of 2 lines updated. Line 20: Item 'L-1' is blocked for 'Purchase order'.",
      partial: true,
      updated: 1,
      attempted: 2,
      failures: [{ detailKey: 20, message: "Item 'L-1' is blocked for 'Purchase order'." }],
    });
  });

  it('partial is false als geen enkele regel slaagde', async () => {
    apiRequest.mockResolvedValue({
      attempted: 1, updated: 0, skipped: 1, failed: 1,
      failures: [{ detailKey: 20, message: 'Blocked.' }],
      remainingValues: ['old'],
      updatedDetailKeys: [],
    });
    const { result } = renderHook(() => usePurchaseOrderCorrectAllLines({
      patchLinkedLineValues: vi.fn(), applyLineValuesBatch: vi.fn(),
    }));
    await expect(result.current.onCorrectAllLines({
      lineColumnId: 44, lineColumnKey: 'ext', headerColumnKey: 'extValues',
      dataAreaId: 'whsl', orderNumber: 'WSPO-1', value: 'test',
    })).rejects.toMatchObject({ message: 'Line 20: Blocked.', partial: false });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/utils/lineWriteBackFailureText.test.js src/hooks/usePurchaseOrderCorrectAllLines.test.js`
Expected: FAIL — module ontbreekt; hook-melding is `Write-back failed on 1 of 2 lines.`

- [ ] **Step 3: Implementatie**

`src/utils/lineWriteBackFailureText.js`:

```js
const MAX_SHOWN = 3;
const FALLBACK_REASON = 'Write-back to D365 failed';

function withPeriod(text) {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/** "Line 20: <reden>." voor de eerste `max` failures, plus "(+N more)". */
export function formatLineFailures(failures, { max = MAX_SHOWN } = {}) {
  const list = Array.isArray(failures) ? failures : [];
  if (!list.length) return '';
  const shown = list.slice(0, max).map((failure) => (
    `Line ${failure.detailKey}: ${withPeriod(String(failure.message || FALLBACK_REASON).trim())}`
  ));
  const extra = list.length - shown.length;
  return extra > 0 ? `${shown.join(' ')} (+${extra} more)` : shown.join(' ');
}

/** Melding voor een header-fan-out met ≥1 mislukte regel (partial of volledig mislukt). */
export function formatCorrectAllFailure({
  updated = 0, attempted = 0, failed = 0, failures = [],
} = {}) {
  const detail = formatLineFailures(failures);
  if (updated > 0) {
    const head = `${updated} of ${attempted} lines updated.`;
    return detail ? `${head} ${detail}` : head;
  }
  return detail || `Write-back failed on ${failed} of ${attempted} lines.`;
}
```

`src/hooks/usePurchaseOrderCorrectAllLines.js` — import toevoegen en de `failed`-tak vervangen:

```js
import { formatCorrectAllFailure } from '../utils/lineWriteBackFailureText';
```

```js
    if (response.failed > 0) {
      const updatedCount = Number(response.updated) || 0;
      const err = new Error(formatCorrectAllFailure(response));
      err.remainingDisplayValue = remaining[0] ?? '';
      err.failures = Array.isArray(response.failures) ? response.failures : [];
      err.updated = updatedCount;
      err.attempted = Number(response.attempted) || 0;
      err.partial = updatedCount > 0;
      throw err;
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/lineWriteBackFailureText.test.js src/hooks/usePurchaseOrderCorrectAllLines.test.js src/components/supplier/PurchaseOrderWriteBackCell.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/lineWriteBackFailureText.js src/utils/lineWriteBackFailureText.test.js src/hooks/usePurchaseOrderCorrectAllLines.js src/hooks/usePurchaseOrderCorrectAllLines.test.js
git commit -m "feat: toon D365-reden per regel bij header write-back #AB:404"
```

---

### Task 4: `partial`-uitkomst in job, samenvatting en badge

**Files:**
- Modify: `src/hooks/purchaseOrderBulkEditRun.js` (`runCorrectRows`)
- Modify: `src/hooks/bulkWriteBackJobState.js` (`buildCorrectSummaryMessage`, `jobBadgeLabel`, nieuw `countAttentionRows`)
- Modify: `src/context/BulkWriteBackJobContext.jsx` (onSettled + 3× summary)
- Test: `src/hooks/purchaseOrderBulkEditRun.test.js`, `src/hooks/bulkWriteBackJobState.test.js`

**Interfaces:**
- Consumes: fout met `.partial: boolean` (Task 3).
- Produces:
  - `runCorrectRows(...)` → `{ updated, skipped, partial: number, failedRows }`; failedRow krijgt `partial: boolean`; `onSettled` outcome `'updated' | 'skipped' | 'failed' | 'partial'`.
  - `countAttentionRows(failedRows): { partialCount: number, failedCount: number }`
  - `buildCorrectSummaryMessage({ updated, skipped, failedCount, partialCount = 0 }): string`

- [ ] **Step 1: Write the failing tests**

Toevoegen aan `src/hooks/purchaseOrderBulkEditRun.test.js` (in `describe('runCorrectRows')`):

```js
  it('markeert een gedeeltelijk geslaagde order als partial', async () => {
    const onSettled = vi.fn();
    const partialErr = Object.assign(new Error('1 of 2 lines updated. Line 20: Blocked.'), { partial: true });
    const runSingleUpdate = vi.fn()
      .mockRejectedValueOnce(partialErr)
      .mockRejectedValueOnce(Object.assign(new Error('Line 10: Blocked.'), { partial: false }));
    const result = await runCorrectRows({
      candidates: [
        { dataAreaId: 'whsl', orderNumber: 'PO1', currentValue: undefined },
        { dataAreaId: 'whsl', orderNumber: 'PO2', currentValue: undefined },
      ],
      payload: { headerColumnKey: 'extValues', lineColumnId: 44, value: 'test' },
      runSingleUpdate,
      onSettled,
      mode: 'correctAll',
    });
    expect(result.updated).toBe(0);
    expect(result.partial).toBe(1);
    expect(result.failedRows).toEqual([
      expect.objectContaining({ key: 'whsl|PO1', partial: true, errorMessage: '1 of 2 lines updated. Line 20: Blocked.' }),
      expect.objectContaining({ key: 'whsl|PO2', partial: false }),
    ]);
    expect(onSettled).toHaveBeenNthCalledWith(1, expect.objectContaining({ outcome: 'partial' }));
    expect(onSettled).toHaveBeenNthCalledWith(2, expect.objectContaining({ outcome: 'failed' }));
  });
```

In `src/hooks/bulkWriteBackJobState.test.js`: import `countAttentionRows` toevoegen en de badge-test (regel ~95-100) vervangen + nieuwe tests:

```js
  it('toont aandacht-teller als er mislukte of partial rijen zijn', () => {
    expect(jobBadgeLabel({
      status: JOB_NEEDS_ATTENTION,
      failedRows: [{ key: 'a' }, { key: 'b', partial: true }],
    })).toBe('Write-back: 2 need attention');
    expect(jobBadgeLabel({
      status: JOB_NEEDS_ATTENTION,
      failedRows: [{ key: 'a', partial: true }],
    })).toBe('Write-back: 1 needs attention');
  });
```

```js
describe('partial-telling', () => {
  it('splitst failedRows in partial en failed', () => {
    expect(countAttentionRows([{ partial: true }, { partial: false }, {}]))
      .toEqual({ partialCount: 1, failedCount: 2 });
    expect(countAttentionRows(undefined)).toEqual({ partialCount: 0, failedCount: 0 });
  });

  it('toont "Partially updated" alleen als er partial rijen zijn', () => {
    expect(buildCorrectSummaryMessage({ updated: 0, skipped: 0, failedCount: 0, partialCount: 1 }))
      .toBe('Bulk edit finished. Updated: 0. Partially updated: 1. Skipped: 0. Failed: 0.');
    expect(buildCorrectSummaryMessage({ updated: 2, skipped: 0, failedCount: 1 }))
      .toBe('Bulk edit finished. Updated: 2. Skipped: 0. Failed: 1.');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/hooks/purchaseOrderBulkEditRun.test.js src/hooks/bulkWriteBackJobState.test.js`
Expected: FAIL — `result.partial` undefined, `countAttentionRows` is not a function, badge `Write-back: 2 failed`.

- [ ] **Step 3: Implementatie**

`src/hooks/purchaseOrderBulkEditRun.js` — in `runCorrectRows`: `let partial = 0;` naast `skipped`, en de `catch` wordt:

```js
    } catch (err) {
      const isPartial = Boolean(err?.partial);
      if (isPartial) partial += 1;
      failedRows.push({
        key,
        dataAreaId: candidate.dataAreaId,
        orderNumber: candidate.orderNumber,
        columnId: payload.columnId ?? payload.lineColumnId,
        columnKey: payload.columnKey,
        lineColumnId: payload.lineColumnId,
        lineColumnKey: payload.lineColumnKey,
        headerColumnKey: payload.headerColumnKey,
        mode,
        value: payload.value,
        basedOnValue: candidate.currentValue,
        partial: isPartial,
        errorMessage: err.message || 'Write-back failed',
      });
      onSettled?.({
        key,
        outcome: isPartial ? 'partial' : 'failed',
        failedRow: failedRows[failedRows.length - 1],
      });
    }
  }
  return { updated, skipped, partial, failedRows };
```

`src/hooks/bulkWriteBackJobState.js`:

```js
export function countAttentionRows(failedRows) {
  const list = Array.isArray(failedRows) ? failedRows : [];
  const partialCount = list.filter((row) => row?.partial).length;
  return { partialCount, failedCount: list.length - partialCount };
}

export function buildCorrectSummaryMessage({
  updated, skipped, failedCount, partialCount = 0,
}) {
  const partialPart = partialCount > 0 ? ` Partially updated: ${partialCount}.` : '';
  return `Bulk edit finished. Updated: ${updated}.${partialPart} Skipped: ${skipped}. Failed: ${failedCount}.`;
}
```

`jobBadgeLabel` — de `JOB_NEEDS_ATTENTION`-tak:

```js
  const attentionCount = job.failedRows?.length || 0;
  if (job.status === JOB_NEEDS_ATTENTION && attentionCount) {
    return attentionCount === 1
      ? 'Write-back: 1 needs attention'
      : `Write-back: ${attentionCount} need attention`;
  }
```

`src/context/BulkWriteBackJobContext.jsx`:
- import `countAttentionRows` uit `../hooks/bulkWriteBackJobState`.
- `onSettled`: `doneKeys: outcome === 'failed' || outcome === 'partial' ? prev.doneKeys : [...prev.doneKeys, key],`
- Na `runCorrectRows`:

```js
      const { updated, skipped, failedRows } = result;
      const summaryMessage = buildCorrectSummaryMessage({
        updated,
        skipped,
        ...countAttentionRows(failedRows),
      });
```

- `handleFailedRowsChange` — beide aanroepen:

```js
      showSuccess(prev, buildCorrectSummaryMessage({
        updated: prev.updated,
        skipped: prev.skipped,
        ...countAttentionRows([]),
      }));
```

```js
        summaryMessage: buildCorrectSummaryMessage({
          updated: current.updated,
          skipped: current.skipped,
          ...countAttentionRows(failedRows),
        }),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/hooks/purchaseOrderBulkEditRun.test.js src/hooks/bulkWriteBackJobState.test.js src/hooks/usePurchaseOrderBulkEdit.test.jsx src/hooks/usePurchaseOrderBulkEditRetry.test.js`
Expected: PASS. Als een bestaande test nog `'Write-back: N failed'` verwacht (bv. in `src/components/layout`), die verwachting aanpassen naar de nieuwe tekst.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/purchaseOrderBulkEditRun.js src/hooks/purchaseOrderBulkEditRun.test.js src/hooks/bulkWriteBackJobState.js src/hooks/bulkWriteBackJobState.test.js src/context/BulkWriteBackJobContext.jsx
git commit -m "feat: partial-uitkomst voor deels geslaagde header write-back #AB:404"
```

---

### Task 5: Mislukte-rijen-tabel: volledige reden + Partial-badge

**Files:**
- Modify: `src/components/supplier/PurchaseOrderBulkEditFailedRows.jsx`
- Test: `src/components/supplier/PurchaseOrderBulkEditFailedRows.test.jsx`

**Interfaces:**
- Consumes: failedRow `{ key, dataAreaId, orderNumber, errorMessage, partial }` (Task 4).

- [ ] **Step 1: Write the failing test**

In `PurchaseOrderBulkEditFailedRows.test.jsx`: verwachting `'1 row failed'` (regel 34) wijzigen naar `'1 row needs attention'`, en toevoegen:

```js
  it('toont een Partial-badge en de volledige reden voor een partial rij', () => {
    const message = "1 of 2 lines updated. Line 20: Item 'L-10780-02' is blocked for 'Purchase order'.";
    wrap(
      <PurchaseOrderBulkEditFailedRows
        rows={[
          { key: 'whsl|WSPO-0422062', dataAreaId: 'whsl', orderNumber: 'WSPO-0422062', errorMessage: message, partial: true },
          { key: 'whsl|WSPO-2', dataAreaId: 'whsl', orderNumber: 'WSPO-2', errorMessage: 'Line 10: Blocked.', partial: false },
        ]}
        retrying={false}
        onRetryRow={vi.fn()}
        onRetryAllFailed={vi.fn()}
      />,
    );
    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.getAllByText('Partial')).toHaveLength(1);
    expect(screen.getByText('2 rows need attention')).toBeTruthy();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/supplier/PurchaseOrderBulkEditFailedRows.test.jsx`
Expected: FAIL — geen `Partial`, tekst `1 row failed`.

- [ ] **Step 3: Implementatie**

- `Badge` toevoegen aan de Fluent-import.
- `errorCell`-stijl vervangen (tekst wrapt i.p.v. afkappen):

```js
  errorCell: {
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
    fontSize: tokens.fontSizeBase200,
    minWidth: '220px',
    maxWidth: '360px',
    color: tokens.colorNeutralForeground2,
  },
  orderLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    ...shorthands.gap(tokens.spacingHorizontalXS),
  },
```

- Kopregel:

```jsx
          {count} {count === 1 ? 'row needs attention' : 'rows need attention'}
```

- Ordercel:

```jsx
                  <TableCell className={styles.orderCell}>
                    <span className={styles.orderLabel}>
                      {orderLabel(row)}
                      {row.partial ? (
                        <Badge appearance="tint" color="warning" size="small">Partial</Badge>
                      ) : null}
                    </span>
                  </TableCell>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/supplier/PurchaseOrderBulkEditFailedRows.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/supplier/PurchaseOrderBulkEditFailedRows.jsx src/components/supplier/PurchaseOrderBulkEditFailedRows.test.jsx
git commit -m "feat: volledige D365-reden en Partial-badge in bulk-samenvatting #AB:404"
```

---

### Task 6: Bevestiging bij afwijkende regelwaarden

**Files:**
- Create: `src/utils/mixedLineValues.js` + `src/utils/mixedLineValues.test.js`
- Create: `src/hooks/useMixedLineValuesConfirm.js`
- Create: `src/components/supplier/MixedLineValuesConfirmDialog.jsx`
- Create: `src/hooks/purchaseOrderBulkEditHelpers.js` (verplaatste helpers, om `usePurchaseOrderBulkEdit.js` ≤300 regels te houden)
- Modify: `src/hooks/usePurchaseOrderBulkEdit.js`
- Modify: `src/components/supplier/PurchaseOrdersPageDialogs.jsx`
- Modify: `src/components/supplier/PurchaseOrderWriteBackCell.jsx:137-145` (`commit`)
- Test: `src/hooks/usePurchaseOrderBulkEdit.test.jsx`, `src/components/supplier/PurchaseOrderWriteBackCell.test.jsx`

**Interfaces:**
- Produces:
  - `distinctLineValues(values: unknown[]): string[]` — trim, skip `null`/`undefined`/`''`/`'-'`, dedupe (zelfde regels als server `collectLinkedLineValues`).
  - `findOrdersWithMixedValues(rows, headerColumnKey): rows[]` — orders met ≥2 unieke waarden.
  - `buildMixedValuesMessage({ rows, mixedRows, headerColumnKey, value }): string`
  - `useMixedLineValuesConfirm()` → `{ confirmMixedLineValues({ rows, headerColumnKey, value }): Promise<boolean>, mixedConfirmState: { open: boolean, message: string }, mixedConfirmActions: { onConfirm(), onCancel() } }`
  - `usePurchaseOrderBulkEdit(...)` return krijgt `mixedConfirm: { state, actions }`; `handleCorrectAllLines` resolvet `{ cancelled: true }` bij Cancel.
  - `PurchaseOrderWriteBackCell`: `onCorrect` dat `{ cancelled: true }` resolvet → lokale waarde terug naar `value`, status `idle`.

- [ ] **Step 1: Write the failing util-test**

`src/utils/mixedLineValues.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { buildMixedValuesMessage, distinctLineValues, findOrdersWithMixedValues } from './mixedLineValues';

const ROWS = [
  { dataAreaId: 'whsl', orderNumber: 'PO1', linkedLineValues: { ext: ['test', '', null, '-'] } },
  { dataAreaId: 'whsl', orderNumber: 'PO2', linkedLineValues: { ext: ['test', 'Reference : 26/08/24'] } },
  { dataAreaId: 'whsl', orderNumber: 'PO3', linkedLineValues: {} },
];

describe('distinctLineValues', () => {
  it('negeert lege waarden en dedupliceert op getrimde tekst', () => {
    expect(distinctLineValues(['a ', 'a', '', null, undefined, '-', 'b'])).toEqual(['a', 'b']);
    expect(distinctLineValues(undefined)).toEqual([]);
  });
});

describe('findOrdersWithMixedValues', () => {
  it('vindt alleen orders met ≥2 echte unieke waarden', () => {
    expect(findOrdersWithMixedValues(ROWS, 'ext').map((r) => r.orderNumber)).toEqual(['PO2']);
  });
});

describe('buildMixedValuesMessage', () => {
  it('enkele order: noemt de huidige waarden en de doelwaarde', () => {
    expect(buildMixedValuesMessage({ rows: [ROWS[1]], mixedRows: [ROWS[1]], headerColumnKey: 'ext', value: 'new' }))
      .toBe('Lines on order PO2 currently have 2 different values ("test", "Reference : 26/08/24"). All lines will be set to "new" in D365.');
  });

  it('enkele order: maximaal 3 waarden, lange waarden afgekapt, ISO-datum als datum', () => {
    const row = { orderNumber: 'PO9', linkedLineValues: { ext: ['2026-10-01T00:00:00Z', 'b', 'c', 'd', 'x'.repeat(50)] } };
    expect(buildMixedValuesMessage({ rows: [row], mixedRows: [row], headerColumnKey: 'ext', value: 'y' }))
      .toBe('Lines on order PO9 currently have 5 different values ("2026-10-01", "b", "c", …). All lines will be set to "y" in D365.');
  });

  it('bulk: telt orders met afwijkende waarden', () => {
    expect(buildMixedValuesMessage({ rows: ROWS, mixedRows: [ROWS[1]], headerColumnKey: 'ext', value: 'new' }))
      .toBe('1 of 3 selected orders have different line values. All their lines will be set to "new" in D365.');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/utils/mixedLineValues.test.js`
Expected: FAIL — module ontbreekt.

- [ ] **Step 3: Implementeer de util**

`src/utils/mixedLineValues.js`:

```js
const EMPTY_VALUES = new Set(['', '-']);
const MAX_SHOWN = 3;
const MAX_LENGTH = 40;

// Zelfde ontdubbeling als de server-rollup (collectLinkedLineValues): trim, lege waarden weg.
export function distinctLineValues(values) {
  const seen = new Set();
  const result = [];
  for (const raw of Array.isArray(values) ? values : []) {
    if (raw === null || raw === undefined) continue;
    const key = String(raw).trim();
    if (EMPTY_VALUES.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  return result;
}

export function findOrdersWithMixedValues(rows, headerColumnKey) {
  return (Array.isArray(rows) ? rows : []).filter(
    (row) => distinctLineValues(row?.linkedLineValues?.[headerColumnKey]).length > 1,
  );
}

function shortValue(value) {
  const text = String(value ?? '');
  const display = /^\d{4}-\d{2}-\d{2}T/.test(text) ? text.slice(0, 10) : text;
  return display.length > MAX_LENGTH ? `${display.slice(0, MAX_LENGTH - 1)}…` : display;
}

export function buildMixedValuesMessage({
  rows, mixedRows, headerColumnKey, value,
}) {
  const target = `"${shortValue(value)}"`;
  if (rows.length === 1) {
    const row = rows[0];
    const values = distinctLineValues(row?.linkedLineValues?.[headerColumnKey]);
    const shown = values.slice(0, MAX_SHOWN).map((v) => `"${shortValue(v)}"`).join(', ');
    const more = values.length > MAX_SHOWN ? ', …' : '';
    return `Lines on order ${row.orderNumber} currently have ${values.length} different values (${shown}${more}). All lines will be set to ${target} in D365.`;
  }
  return `${mixedRows.length} of ${rows.length} selected orders have different line values. All their lines will be set to ${target} in D365.`;
}
```

Run: `npx vitest run src/utils/mixedLineValues.test.js` → PASS.

- [ ] **Step 4: Hook + dialoog**

`src/hooks/useMixedLineValuesConfirm.js`:

```js
import { useCallback, useMemo, useRef, useState } from 'react';
import { buildMixedValuesMessage, findOrdersWithMixedValues } from '../utils/mixedLineValues';

const CLOSED = { open: false, message: '' };

/**
 * Bevestiging vóór een header-fan-out die afwijkende regelwaarden overschrijft.
 * Resolvet direct true als geen enkele order afwijkende waarden heeft.
 */
export function useMixedLineValuesConfirm() {
  const resolverRef = useRef(null);
  const [state, setState] = useState(CLOSED);

  const settle = useCallback((confirmed) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setState(CLOSED);
    resolve?.(confirmed);
  }, []);

  const confirmMixedLineValues = useCallback(({ rows, headerColumnKey, value }) => {
    const list = Array.isArray(rows) ? rows : [];
    const mixedRows = findOrdersWithMixedValues(list, headerColumnKey);
    if (!mixedRows.length) return Promise.resolve(true);
    return new Promise((resolve) => {
      resolverRef.current?.(false);
      resolverRef.current = resolve;
      setState({
        open: true,
        message: buildMixedValuesMessage({ rows: list, mixedRows, headerColumnKey, value }),
      });
    });
  }, []);

  const mixedConfirmActions = useMemo(() => ({
    onConfirm: () => settle(true),
    onCancel: () => settle(false),
  }), [settle]);

  return { confirmMixedLineValues, mixedConfirmState: state, mixedConfirmActions };
}
```

`src/components/supplier/MixedLineValuesConfirmDialog.jsx`:

```jsx
import React from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Text,
} from '@fluentui/react-components';

/** Pagina-niveau bevestiging: header-edit overschrijft afwijkende D365-regelwaarden. */
export default function MixedLineValuesConfirmDialog({ state, actions }) {
  const { open = false, message = '' } = state || {};
  return (
    <Dialog modalType="alert" open={open} onOpenChange={(_, data) => { if (!data.open) actions?.onCancel(); }}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Overwrite different line values?</DialogTitle>
          <DialogContent>
            <Text>{message}</Text>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={() => actions?.onCancel()}>Cancel</Button>
            <Button appearance="primary" onClick={() => actions?.onConfirm()}>Update all lines</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
```

`src/components/supplier/PurchaseOrdersPageDialogs.jsx` — import + render na `PurchaseOrderBulkEditDialog`:

```jsx
import MixedLineValuesConfirmDialog from './MixedLineValuesConfirmDialog';
```

```jsx
      <MixedLineValuesConfirmDialog state={bulkEdit.mixedConfirm?.state} actions={bulkEdit.mixedConfirm?.actions} />
```

- [ ] **Step 5: Write the failing bulk-edit tests**

In `src/hooks/usePurchaseOrderBulkEdit.test.jsx`, in het blok met `LINKED_ORDERS` (PO3 heeft `['Blue', 'Green']`):

Bestaande test `'"bulk" start een achtergrondjob voor elke geselecteerde order'` aanpassen — na `onChooseBulk` eerst bevestigen:

```js
    act(() => result.current.dialogActions.onChooseBulk());
    await waitFor(() => expect(result.current.mixedConfirm.state.open).toBe(true));
    expect(result.current.dialogState.open).toBe(false);
    expect(result.current.mixedConfirm.state.message)
      .toBe('1 of 3 selected orders have different line values. All their lines will be set to "Green" in D365.');
    act(() => result.current.mixedConfirm.actions.onConfirm());
    const returned = await act(async () => pending);
```

Nieuwe tests:

```js
  it('vraagt bevestiging bij één order met afwijkende regelwaarden; Cancel stuurt niets', async () => {
    const { result, correctAllLines } = setupLinked({ selectedKeys: ['USMF|PO3'] });
    const payload = { ...PUSHED_PAYLOAD, orderNumber: 'PO3', value: 'Red' };

    let pending;
    act(() => { pending = result.current.handleCorrectAllLines(payload); });
    await waitFor(() => expect(result.current.mixedConfirm.state.open).toBe(true));
    expect(result.current.mixedConfirm.state.message)
      .toBe('Lines on order PO3 currently have 2 different values ("Blue", "Green"). All lines will be set to "Red" in D365.');

    act(() => result.current.mixedConfirm.actions.onCancel());
    const returned = await act(async () => pending);

    expect(returned).toEqual({ cancelled: true });
    expect(result.current.mixedConfirm.state.open).toBe(false);
    expect(correctAllLines).not.toHaveBeenCalled();
    expect(result.current.job).toBeNull();
  });

  it('"Update all lines" start de achtergrondjob voor de order', async () => {
    const { result, correctAllLines } = setupLinked({ selectedKeys: ['USMF|PO3'] });
    const payload = { ...PUSHED_PAYLOAD, orderNumber: 'PO3', value: 'Red' };

    let pending;
    act(() => { pending = result.current.handleCorrectAllLines(payload); });
    await waitFor(() => expect(result.current.mixedConfirm.state.open).toBe(true));
    act(() => result.current.mixedConfirm.actions.onConfirm());
    const returned = await act(async () => pending);

    expect(returned).toEqual({ background: true });
    await waitFor(() => expect(correctAllLines).toHaveBeenCalledWith(expect.objectContaining({ orderNumber: 'PO3', value: 'Red' })));
  });

  it('geen bevestiging als de order één unieke regelwaarde heeft', async () => {
    const { result, correctAllLines } = setupLinked({ selectedKeys: ['USMF|PO1'] });

    const returned = await act(async () => result.current.handleCorrectAllLines(PUSHED_PAYLOAD));

    expect(returned).toEqual({ background: true });
    expect(result.current.mixedConfirm.state.open).toBe(false);
    await waitFor(() => expect(correctAllLines).toHaveBeenCalledTimes(1));
  });
```

Run: `npx vitest run src/hooks/usePurchaseOrderBulkEdit.test.jsx`
Expected: FAIL — `mixedConfirm` undefined.

- [ ] **Step 6: Helpers verplaatsen + wiring in `usePurchaseOrderBulkEdit.js`**

Maak `src/hooks/purchaseOrderBulkEditHelpers.js` en verplaats daarheen (ongewijzigd, nu met `export`): `EMPTY_DIALOG_STATE`, `isHeaderCellUpdate`, `linkedLineValuesEqual`, `shouldSkipBulkRow`, `createBulkErrorMessage`, `findVisibleOrder`, `startBackgroundCorrectJob`. Het bestand importeert `valuesEqual` uit `./purchaseOrderBulkEditRun`. In `usePurchaseOrderBulkEdit.js` de definities verwijderen en importeren:

```js
import {
  EMPTY_DIALOG_STATE,
  createBulkErrorMessage,
  findVisibleOrder,
  isHeaderCellUpdate,
  shouldSkipBulkRow,
  startBackgroundCorrectJob,
} from './purchaseOrderBulkEditHelpers';
import { useMixedLineValuesConfirm } from './useMixedLineValuesConfirm';
```

(`valuesEqual`-import in de hook vervalt als hij daar niet meer gebruikt wordt.)

In de hook, na `useBulkWriteBackJob()`:

```js
  const { confirmMixedLineValues, mixedConfirmState, mixedConfirmActions } = useMixedLineValuesConfirm();
```

`executeWithBulkOption` — vervang de body na `backgroundArgs` door:

```js
    // Header-fan-out: eerst bevestigen als regels afwijkende waarden hebben (nooit twee dialogen tegelijk).
    const startCorrectAll = async (rows) => {
      closeDialog();
      const confirmed = await confirmMixedLineValues({
        rows,
        headerColumnKey: payload.headerColumnKey || payload.columnKey,
        value: payload.value,
      });
      if (!confirmed) return { cancelled: true };
      return startBackgroundCorrectJob({ ...backgroundArgs, rows });
    };
    const activeOrderRows = () => [findVisibleOrder(visibleOrders, payload)];

    if (visibleSelectionCount <= 1 || !selectedVisibleKeys.has(activeOrderKey)) {
      if (mode === 'correctAll') return startCorrectAll(activeOrderRows());
      await runSingleUpdate(mode, payload);
      return undefined;
    }

    const columnKey = payload.columnKey || payload.headerColumnKey;
    const columnLabel = columnLabelByKey.get(columnKey) || columnKey || 'this column';
    const decision = await showDecisionDialog({ columnLabel, selectedCount: visibleSelectionCount });
    if (decision !== 'bulk') {
      if (mode === 'correctAll') return startCorrectAll(activeOrderRows());
      await runSingleUpdate(mode, payload);
      return undefined;
    }
    if (mode === 'correctAll') return startCorrectAll(selectedVisibleOrders);
    if (mode === 'correct') {
      return startBackgroundCorrectJob({ ...backgroundArgs, rows: selectedVisibleOrders });
    }
    await runBulkUpdate({ mode, payload, rows: selectedVisibleOrders });
    return undefined;
```

`confirmMixedLineValues` toevoegen aan de dependency-array van `executeWithBulkOption`. In de return-`useMemo`:

```js
    mixedConfirm: { state: mixedConfirmState, actions: mixedConfirmActions },
```

en `mixedConfirmState`, `mixedConfirmActions` aan de deps.

Controleer: `wc -l src/hooks/usePurchaseOrderBulkEdit.js` ≤ 300.

- [ ] **Step 7: Cel-revert bij Cancel — failing test**

Toevoegen aan `src/components/supplier/PurchaseOrderWriteBackCell.test.jsx`:

```js
  it('herstelt de oude waarde zonder fout als de bevestiging geannuleerd wordt', async () => {
    const onCorrect = vi.fn().mockResolvedValue({ cancelled: true });
    renderCell({ onCorrect });
    const input = screen.getByLabelText('Color (write back to D365)');
    fireEvent.change(input, { target: { value: 'Green' } });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(input.value).toBe('Red');
    });
    expect(onCorrect).toHaveBeenCalled();
    expect(screen.queryByText(/failed/i)).toBeNull();
  });
```

Run: `npx vitest run src/components/supplier/PurchaseOrderWriteBackCell.test.jsx` → FAIL (input blijft `Green`).

- [ ] **Step 8: Cel-implementatie**

In `PurchaseOrderWriteBackCell.jsx` `commit`, direct na `const result = await onCorrect(...)`:

```js
      if (result?.cancelled) {
        setLocal(toInputValue(value, column.dataType, isDateLikeColumn(column, value)));
        setStatus('idle');
        return;
      }
```

- [ ] **Step 9: Run alle betrokken tests**

Run: `npx vitest run src/utils/mixedLineValues.test.js src/hooks/usePurchaseOrderBulkEdit.test.jsx src/components/supplier/PurchaseOrderWriteBackCell.test.jsx src/components/supplier/PurchaseOrderLinkedHeaderValue`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/utils/mixedLineValues.js src/utils/mixedLineValues.test.js src/hooks/useMixedLineValuesConfirm.js src/components/supplier/MixedLineValuesConfirmDialog.jsx src/hooks/purchaseOrderBulkEditHelpers.js src/hooks/usePurchaseOrderBulkEdit.js src/hooks/usePurchaseOrderBulkEdit.test.jsx src/components/supplier/PurchaseOrdersPageDialogs.jsx src/components/supplier/PurchaseOrderWriteBackCell.jsx src/components/supplier/PurchaseOrderWriteBackCell.test.jsx
git commit -m "feat: bevestiging voordat header-edit afwijkende regelwaarden overschrijft #AB:404"
```

---

### Task 7: Versie, docs, volledige verificatie

**Files:**
- Modify: `src/config/version.js` (`v1.73.23` → `v1.73.24`)
- Create: `docs/devops/404-header-writeback-mixed-confirm.md`
- Modify: `docs/devops/302-header-push-line-writeback.md` (status: gebouwd en gemerged via PR #112/#116; verwijzing naar `404`)

- [ ] **Step 1: Versie + docs**

`src/config/version.js`: `export const APP_VERSION = 'v1.73.24';`

`docs/devops/404-header-writeback-mixed-confirm.md`: titel, link naar spec en plan, aanleiding (PROD-incident `whsl|WSPO-0422062`), acceptatiecriteria uit de BRD-*Succes*-lijst als checkboxes, testinstructies (localhost, zie Step 3).

In `docs/devops/302-header-push-line-writeback.md`: de regel "Nog geen applicatiecode" vervangen door "Gebouwd en gemerged (PR #112, #116). Vervolg: #404 (bevestiging bij afwijkende waarden + D365-redenen)." en de taken afvinken die in de commits `9136188`, `78a1bbc`, `e9220c8` zijn opgeleverd.

- [ ] **Step 2: Volledige tests + lint + build**

Run: `npm test` → alle tests PASS.
Run: `npx eslint src server --ext .js,.jsx` → geen nieuwe errors.
Run: `npm run build` → build slaagt.

- [ ] **Step 3: Live-check op localhost** (`npm run dev:all`, `http://localhost:5178`, staff-login, DEV-data)

1. Kies een order waarvan de gepushte write-back-header `+N` toont. Wijzig de waarde → dialoog *Overwrite different line values?* met de huidige waarden. *Cancel* → cel toont oude waarde, geen job-badge.
2. Opnieuw, nu *Update all lines* → job loopt; header toont één waarde.
3. Order zonder `+N` → geen dialoog.
4. Twee+ orders selecteren, waarvan één met `+N`, *Update all selected* → één bevestiging `1 of N selected orders …`.
5. Forceer een D365-weigering (order met geblokkeerd artikel op DEV, of tijdelijk een regel met `writable` maar een ongeldige waarde) → *Bulk edit finished* toont `Partially updated: 1`, Partial-badge, `Line <n>: <reden>` volledig leesbaar; badge rechtsboven `Write-back: 1 needs attention`.

Gebruik de `playwright-live-test`-skill voor stappen 1-4 met rapport in `test-reports/`.

- [ ] **Step 4: Commit**

```bash
git add src/config/version.js docs/devops/404-header-writeback-mixed-confirm.md docs/devops/302-header-push-line-writeback.md test-reports/
git commit -m "docs: devops-doc en versie v1.73.24 voor header write-back bevestiging #AB:404"
```

Geen push — wacht op expliciet verzoek (`push-feature-to-dev`).
