'use strict';

const { runWithRequestTiming, time, mark, buildServerTimingHeader } = require('./timing');

describe('timing', () => {
  it('neemt een gemeten blok op in de header', async () => {
    await runWithRequestTiming(async () => {
      await time('db_read', async () => 'resultaat');
      expect(buildServerTimingHeader(10)).toMatch(/db_read;dur=/);
    });
  });

  it('geeft de waarde van het gemeten blok terug', async () => {
    const value = await runWithRequestTiming(() => time('x', async () => 42));
    expect(value).toBe(42);
  });

  it('meet ook wanneer het blok gooit', async () => {
    await runWithRequestTiming(async () => {
      await expect(time('faalt', async () => { throw new Error('stuk'); })).rejects.toThrow('stuk');
      expect(buildServerTimingHeader(1)).toMatch(/faalt;dur=/);
    });
  });

  it('mark() zet een label zonder gemeten blok', () => {
    runWithRequestTiming(() => {
      mark('tb_detail_plan_aggregate');
      expect(buildServerTimingHeader(5)).toContain('tb_detail_plan_aggregate;dur=0.0');
    });
  });

  it('mark() accepteert een eigen duur', () => {
    runWithRequestTiming(() => {
      mark('cache_hit', 12.5);
      expect(buildServerTimingHeader(5)).toContain('cache_hit;dur=12.5');
    });
  });

  it('mark() is een no-op buiten een request-context', () => {
    expect(() => mark('los')).not.toThrow();
    expect(buildServerTimingHeader(1)).toBe('app;dur=1.0');
  });

  it('saneert labels tot een geldig Server-Timing-token', () => {
    runWithRequestTiming(() => {
      mark('tb detail-plan/none');
      expect(buildServerTimingHeader(1)).toContain('tb_detail_plan_none;dur=0.0');
    });
  });
});
