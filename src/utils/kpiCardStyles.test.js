import { describe, expect, it } from 'vitest';
import {
  KPI_STYLE_KEYS,
  defaultKpiCardStyle,
  normalizeKpiCardStyles,
} from './kpiCardStyles';

describe('normalizeKpiCardStyles', () => {
  it('stores no color by default', () => {
    const styles = normalizeKpiCardStyles(null);
    KPI_STYLE_KEYS.forEach((key) => {
      expect(styles[key]).toEqual({ color: null, colorTarget: 'value' });
      expect(defaultKpiCardStyle(key)).toEqual({ color: null, colorTarget: 'value' });
    });
  });

  it('keeps a valid hex color and colorTarget, ignores old threshold field', () => {
    const styles = normalizeKpiCardStyles({
      delivered: { threshold: 95.5, color: '#00C875', colorTarget: 'other' },
    });
    expect(styles.delivered).toEqual({ color: '#00c875', colorTarget: 'other' });
  });

  it('drops an invalid color', () => {
    expect(normalizeKpiCardStyles({ delivered: { color: 'not-a-color' } }).delivered.color).toBeNull();
  });
});
