// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { findVisibleElement, isElementVisible, useTourAnchor } from './useTourAnchor';

function addElement({ tour, rect = { left: 10, top: 20, width: 100, height: 30 }, parent = document.body }) {
  const el = document.createElement('div');
  el.setAttribute('data-tour', tour);
  el.getBoundingClientRect = () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height });
  el.scrollIntoView = vi.fn();
  parent.appendChild(el);
  return el;
}

function advance(ms) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('isElementVisible / findVisibleElement', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('ignores zero-size and inert elements', () => {
    const hidden = addElement({ tour: 'x', rect: { left: 0, top: 0, width: 0, height: 0 } });
    const inertParent = document.createElement('div');
    inertParent.setAttribute('inert', '');
    document.body.appendChild(inertParent);
    const inert = addElement({ tour: 'x', parent: inertParent });
    const visible = addElement({ tour: 'x' });

    expect(isElementVisible(hidden)).toBe(false);
    expect(isElementVisible(inert)).toBe(false);
    expect(findVisibleElement('[data-tour="x"]')).toBe(visible);
  });

  it('returns null for an invalid selector', () => {
    expect(findVisibleElement('[[nope')).toBeNull();
  });
});

describe('useTourAnchor', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('is idle without a selector', () => {
    const { result } = renderHook(() => useTourAnchor(null));
    expect(result.current.status).toBe('idle');
  });

  it('finds an element that appears later and tracks its rect', () => {
    const { result } = renderHook(() => useTourAnchor('[data-tour="late"]'));
    advance(100);
    expect(result.current.status).toBe('searching');

    addElement({ tour: 'late' });
    advance(400);
    expect(result.current.status).toBe('found');
    expect(result.current.rect).toEqual({ left: 10, top: 20, width: 100, height: 30 });
  });

  it('reports missing after the timeout', () => {
    const { result } = renderHook(() => useTourAnchor('[data-tour="never"]', { timeoutMs: 1000 }));
    advance(1200);
    expect(result.current.status).toBe('missing');
  });

  it('never returns the previous step status after the reset key changes', () => {
    const { result, rerender } = renderHook(
      ({ key }) => useTourAnchor('[data-tour="never"]', { timeoutMs: 500, resetKey: key }),
      { initialProps: { key: 'step-1' } },
    );
    advance(700);
    expect(result.current.status).toBe('missing');

    rerender({ key: 'step-2' });
    expect(result.current.status).toBe('searching');
  });

  it('reports lost when a found element disappears', () => {
    const el = addElement({ tour: 'gone' });
    const { result } = renderHook(() => useTourAnchor('[data-tour="gone"]', { lostMs: 300 }));
    advance(100);
    expect(result.current.status).toBe('found');

    el.remove();
    advance(600);
    expect(result.current.status).toBe('lost');
  });
});
