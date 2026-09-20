// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runWhenIdleAndQuiet } from './idleWhenQuiet';

// jsdom heeft standaard geen requestIdleCallback — dat oefent meteen het setTimeout-fallbackpad
// uit, wat exact is wat we in de meeste browsers ook nog tegenkomen (Safari).
describe('runWhenIdleAndQuiet (fallback zonder requestIdleCallback)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('draait de callback pas na idle-timeout + quiet-periode', () => {
    const callback = vi.fn();
    runWhenIdleAndQuiet(callback, { idleTimeoutMs: 800, quietMs: 400 });

    vi.advanceTimersByTime(800);
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(400);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('reset de klok bij input vóór idle en start opnieuw', () => {
    const callback = vi.fn();
    runWhenIdleAndQuiet(callback, { idleTimeoutMs: 800, quietMs: 400 });

    vi.advanceTimersByTime(500);
    window.dispatchEvent(new Event('wheel'));
    vi.advanceTimersByTime(800);
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(400);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('reset de klok bij input tijdens de quiet-periode', () => {
    const callback = vi.fn();
    runWhenIdleAndQuiet(callback, { idleTimeoutMs: 800, quietMs: 400 });

    vi.advanceTimersByTime(800);
    window.dispatchEvent(new Event('keydown'));
    vi.advanceTimersByTime(400);
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(800 + 400);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('cancel() voorkomt een latere run', () => {
    const callback = vi.fn();
    const handle = runWhenIdleAndQuiet(callback, { idleTimeoutMs: 800, quietMs: 400 });

    handle.cancel();
    vi.advanceTimersByTime(800 + 400);
    expect(callback).not.toHaveBeenCalled();
  });

  it('luistert alleen naar keydown/wheel/pointerdown/touchstart, niet naar mousemove', () => {
    const callback = vi.fn();
    runWhenIdleAndQuiet(callback, { idleTimeoutMs: 800, quietMs: 400 });

    vi.advanceTimersByTime(500);
    window.dispatchEvent(new Event('mousemove'));
    vi.advanceTimersByTime(300);
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(400);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('verwijdert de event-listeners bij cancel()', () => {
    const callback = vi.fn();
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const handle = runWhenIdleAndQuiet(callback, { idleTimeoutMs: 800, quietMs: 400 });

    expect(addSpy).toHaveBeenCalledTimes(4);
    handle.cancel();
    expect(removeSpy).toHaveBeenCalledTimes(4);
  });
});

describe('runWhenIdleAndQuiet (met requestIdleCallback)', () => {
  let ricCallbacks;

  beforeEach(() => {
    vi.useFakeTimers();
    ricCallbacks = new Map();
    let nextId = 1;
    window.requestIdleCallback = vi.fn((cb) => {
      const id = nextId++;
      ricCallbacks.set(id, cb);
      return id;
    });
    window.cancelIdleCallback = vi.fn((id) => {
      ricCallbacks.delete(id);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete window.requestIdleCallback;
    delete window.cancelIdleCallback;
  });

  function fireIdle() {
    ricCallbacks.forEach((cb) => cb());
  }

  it('gebruikt requestIdleCallback in plaats van setTimeout wanneer beschikbaar', () => {
    const callback = vi.fn();
    runWhenIdleAndQuiet(callback, { idleTimeoutMs: 800, quietMs: 400 });

    expect(window.requestIdleCallback).toHaveBeenCalledTimes(1);
    fireIdle();
    vi.advanceTimersByTime(400);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('cancel() roept cancelIdleCallback aan wanneer de rIC-handle nog open staat', () => {
    const callback = vi.fn();
    const handle = runWhenIdleAndQuiet(callback, { idleTimeoutMs: 800, quietMs: 400 });

    handle.cancel();
    expect(window.cancelIdleCallback).toHaveBeenCalledTimes(1);
    fireIdle();
    vi.advanceTimersByTime(400);
    expect(callback).not.toHaveBeenCalled();
  });
});
