import { describe, expect, it } from 'vitest';
import { viewShowsAsTab, VIEW_NAME_MAX_LENGTH } from './savedViewDisplay';

describe('savedViewDisplay', () => {
  it('beperkt nieuwe viewnamen tot 25 tekens', () => {
    expect(VIEW_NAME_MAX_LENGTH).toBe(25);
  });

  it('toont een view als tab alleen met id en showAsTab', () => {
    expect(viewShowsAsTab({ id: 1, viewState: { showAsTab: true } })).toBe(true);
    expect(viewShowsAsTab({ id: 1, viewState: { showAsTab: false } })).toBe(false);
    expect(viewShowsAsTab({ id: null, viewState: { showAsTab: true } })).toBe(false);
    expect(viewShowsAsTab({ viewState: { showAsTab: true } })).toBe(false);
  });
});
