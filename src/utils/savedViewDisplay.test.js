import { describe, expect, it } from 'vitest';
import { truncateViewName, viewShowsAsTab, VIEW_NAME_MAX_LENGTH } from './savedViewDisplay';

describe('savedViewDisplay', () => {
  it('kapt viewnamen af op 25 tekens', () => {
    expect(VIEW_NAME_MAX_LENGTH).toBe(25);
    expect(truncateViewName('testrccp')).toBe('testrccp');
    expect(truncateViewName('  abc  ')).toBe('abc');
    expect(truncateViewName('abcdefghijklmnopqrstuvwxyz')).toBe('abcdefghijklmnopqrstuvwxy');
    expect(truncateViewName('')).toBe('');
  });

  it('toont een view als tab alleen met id en showAsTab', () => {
    expect(viewShowsAsTab({ id: 1, viewState: { showAsTab: true } })).toBe(true);
    expect(viewShowsAsTab({ id: 1, viewState: { showAsTab: false } })).toBe(false);
    expect(viewShowsAsTab({ id: null, viewState: { showAsTab: true } })).toBe(false);
    expect(viewShowsAsTab({ viewState: { showAsTab: true } })).toBe(false);
  });
});
