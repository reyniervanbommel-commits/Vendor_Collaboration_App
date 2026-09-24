import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createProductionBoardReadService } = require('./defaultDependencies');

describe('createProductionBoardReadService', () => {
  it('koppelt de productie-executors uit TableDataService', () => {
    const service = createProductionBoardReadService();
    expect(typeof service.read).toBe('function');
    expect(typeof service.readRowDetails).toBe('function');
    expect(typeof service.getRevision).toBe('function');
  });
});
