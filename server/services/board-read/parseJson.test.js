import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseJson } = require('./parseJson');

describe('parseJson', () => {
  it('geeft een object terug voor json, object of lege invoer', () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseJson({ a: 1 })).toEqual({ a: 1 });
    expect(parseJson('')).toEqual({});
    expect(parseJson('geen-json')).toEqual({});
  });
});
