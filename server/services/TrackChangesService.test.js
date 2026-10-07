'use strict';

const { validateConfig, defaultConfig } = require('../services/TrackChangesService');

describe('TrackChangesService.validateConfig', () => {
  it('accepts a valid session config and normalizes it', () => {
    const res = validateConfig({
      mode: 'session',
      sessionRoles: ['admin', 'employee', 'admin'],
      columns: { 142: { activatedAt: '2026-07-14T20:00:00.000Z', extra: 'x' } },
    });
    expect(res.valid).toBe(true);
    expect(res.config.mode).toBe('session');
    expect(res.config.sessionRoles).toEqual(['admin', 'employee']);
    expect(res.config.columns['142']).toEqual({ activatedAt: '2026-07-14T20:00:00.000Z' });
  });

  it('accepts a valid week config', () => {
    const res = validateConfig({ mode: 'week', sessionRoles: [], columns: {} });
    expect(res.valid).toBe(true);
    expect(res.config.mode).toBe('week');
  });

  it('rejects an invalid mode', () => {
    const res = validateConfig({ mode: 'daily', sessionRoles: [], columns: {} });
    expect(res.valid).toBe(false);
  });

  it('rejects sessionRoles outside the allowed set', () => {
    const res = validateConfig({ mode: 'session', sessionRoles: ['ceo'], columns: {} });
    expect(res.valid).toBe(false);
  });

  it('rejects non-numeric column ids', () => {
    const res = validateConfig({
      mode: 'session',
      sessionRoles: ['admin'],
      columns: { abc: { activatedAt: '2026-07-14T20:00:00.000Z' } },
    });
    expect(res.valid).toBe(false);
  });

  it('rejects a column without a valid activatedAt date', () => {
    const res = validateConfig({
      mode: 'session',
      sessionRoles: ['admin'],
      columns: { 142: { activatedAt: 'not-a-date' } },
    });
    expect(res.valid).toBe(false);
  });

  it('rejects a non-object config', () => {
    expect(validateConfig(null).valid).toBe(false);
    expect(validateConfig([]).valid).toBe(false);
  });

  it('provides a sane default config', () => {
    const cfg = defaultConfig();
    expect(cfg.mode).toBe('session');
    expect(cfg.sessionRoles).toEqual(['admin', 'employee', 'supply_chain']);
    expect(cfg.columns).toEqual({});
  });
});
