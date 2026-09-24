import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createBoardReadService } = require('./createBoardReadService');

describe('createBoardReadService', () => {
  it('delegeert readRowDetails en getRevision en dedupliceert read', async () => {
    const service = createBoardReadService({
      readExecute: async (opts) => ({ tableKey: opts.tableKey }),
      readRowDetails: async () => ({ details: [1] }),
      getRevision: async () => ({ revision: 'r' }),
    });
    await expect(service.readRowDetails({})).resolves.toEqual({ details: [1] });
    await expect(service.getRevision({})).resolves.toEqual({ revision: 'r' });
    const [a, b] = await Promise.all([
      service.read({ tableKey: 'purchase-orders' }),
      service.read({ tableKey: 'purchase-orders', includeDetails: true }),
    ]);
    expect(a).toBe(b);
  });
});
