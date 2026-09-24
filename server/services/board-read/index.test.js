import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const boardRead = require('./index');

describe('board-read index', () => {
  it('exporteert de interne read-onderdelen', () => {
    expect(typeof boardRead.readCacheRows).toBe('function');
    expect(typeof boardRead.assembleBoardRows).toBe('function');
    expect(typeof boardRead.buildBoardReadResponse).toBe('function');
    expect(typeof boardRead.loadD365ChangeLedger).toBe('function');
  });
});
