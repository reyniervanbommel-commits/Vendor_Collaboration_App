import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildD365ChangeState, MASTER_DETAIL_KEY } = require('./changeState');

describe('buildD365ChangeState', () => {
  it('laat de laatste actie winnen op een regel', () => {
    const { lineChanges } = buildD365ChangeState([
      { partition_key: 'whsl', record_key: 'PO-1', detail_key: 20, field_key: 'qty', action: 'DELETE' },
      { partition_key: 'whsl', record_key: 'PO-1', detail_key: 20, field_key: 'qty', action: 'INSERT' },
    ]);
    const state = lineChanges.get('whsl|PO-1|20');
    expect(state.isNew).toBe(true);
    expect(state.isRemoved).toBe(false);
    expect(MASTER_DETAIL_KEY).toBe(-1);
  });
});
