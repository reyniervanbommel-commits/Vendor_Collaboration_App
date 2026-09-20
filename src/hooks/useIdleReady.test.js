// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useIdleReady } from './useIdleReady';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete window.requestIdleCallback;
  delete window.cancelIdleCallback;
});

describe('useIdleReady (setTimeout-fallback)', () => {
  it('is eerst false en wordt true na de timeout', () => {
    const { result } = renderHook(() => useIdleReady(300));
    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(300); });
    expect(result.current).toBe(true);
  });

  it('wacht de volledige timeout af', () => {
    const { result } = renderHook(() => useIdleReady(1000));
    act(() => { vi.advanceTimersByTime(999); });
    expect(result.current).toBe(false);
  });

  it('zet geen state meer na unmount', () => {
    const { result, unmount } = renderHook(() => useIdleReady(300));
    unmount();
    act(() => { vi.advanceTimersByTime(600); });
    expect(result.current).toBe(false);
  });
});

describe('useIdleReady (requestIdleCallback)', () => {
  let ricCallbacks;

  beforeEach(() => {
    ricCallbacks = new Map();
    let nextId = 1;
    window.requestIdleCallback = vi.fn((cb) => {
      const id = nextId++;
      ricCallbacks.set(id, cb);
      return id;
    });
    window.cancelIdleCallback = vi.fn((id) => ricCallbacks.delete(id));
  });

  it('gebruikt requestIdleCallback met de timeout als bovengrens', () => {
    const { result } = renderHook(() => useIdleReady(250));
    expect(window.requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 250 });
    act(() => { ricCallbacks.forEach((cb) => cb()); });
    expect(result.current).toBe(true);
  });

  it('annuleert de openstaande idle-callback bij unmount', () => {
    const { unmount } = renderHook(() => useIdleReady(250));
    unmount();
    expect(window.cancelIdleCallback).toHaveBeenCalledTimes(1);
  });
});
