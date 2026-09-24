import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { normalizeReadOptions, readInflightKey, createInflightRead } = require('./read');

describe('read inflight-key', () => {
  it('laat null en een lege supplierAccount niet samenvallen', () => {
    const staff = readInflightKey({ tableKey: 'purchase-orders', supplierAccount: null });
    const empty = readInflightKey({ tableKey: 'purchase-orders', supplierAccount: '' });
    expect(staff).not.toBe(empty);
  });

  it('behandelt een weggelaten default hetzelfde als de expliciete default', () => {
    const omitted = readInflightKey({ tableKey: 'purchase-orders' });
    const explicit = readInflightKey({
      tableKey: 'purchase-orders',
      includeRemoved: false,
      includeDetails: true,
      supplierFilterColumn: 'vendorAccount',
      supplierAccount: null,
    });
    expect(omitted).toBe(explicit);
    expect(normalizeReadOptions({ tableKey: 'purchase-orders' }).includeDetails).toBe(true);
  });

  it('dedupliceert alleen dezelfde genormaliseerde read', async () => {
    let calls = 0;
    const read = createInflightRead(async () => {
      calls += 1;
      return { ok: true };
    });
    const [left, right] = await Promise.all([
      read({ tableKey: 'purchase-orders', includeRemoved: false }),
      read({ tableKey: 'purchase-orders' }),
    ]);
    expect(left).toBe(right);
    expect(calls).toBe(1);
    const removed = await read({ tableKey: 'purchase-orders', includeRemoved: true });
    expect(removed).toEqual({ ok: true });
    expect(calls).toBe(2);
  });
});
