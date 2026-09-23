// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useElementHeight } from './useElementHeight';

// Eén observer-instantie per new ResizeObserver(), zodat een test de callback zelf kan vuren.
let observers = [];

function createNode(height) {
  const node = document.createElement('div');
  node.getBoundingClientRect = () => ({ height, width: 0, top: 0, left: 0, right: 0, bottom: height });
  return node;
}

beforeEach(() => {
  observers = [];
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback) {
      this.callback = callback;
      this.observed = [];
      this.disconnected = false;
      observers.push(this);
    }

    observe(node) { this.observed.push(node); }

    disconnect() { this.disconnected = true; }
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useElementHeight', () => {
  it('start op 0 zolang er geen element is aangehangen', () => {
    const { result } = renderHook(() => useElementHeight());
    expect(result.current.height).toBe(0);
    expect(observers).toHaveLength(0);
  });

  it('neemt de hoogte van het element over zodra de ref gezet wordt', () => {
    const { result } = renderHook(() => useElementHeight());
    act(() => { result.current.ref(createNode(240)); });
    expect(result.current.height).toBe(240);
    expect(observers[0].observed).toHaveLength(1);
  });

  it('volgt latere resizes via de ResizeObserver-callback', () => {
    const { result } = renderHook(() => useElementHeight());
    act(() => { result.current.ref(createNode(240)); });
    act(() => { observers[0].callback([{ contentRect: { height: 310 } }]); });
    expect(result.current.height).toBe(310);
  });

  it('negeert een callback zonder entries', () => {
    const { result } = renderHook(() => useElementHeight());
    act(() => { result.current.ref(createNode(240)); });
    act(() => { observers[0].callback([]); });
    expect(result.current.height).toBe(240);
  });

  it('koppelt de oude observer los wanneer de ref naar een ander element wijst', () => {
    const { result } = renderHook(() => useElementHeight());
    act(() => { result.current.ref(createNode(240)); });
    act(() => { result.current.ref(createNode(120)); });
    expect(observers[0].disconnected).toBe(true);
    expect(result.current.height).toBe(120);
  });

  it('koppelt los bij een null-ref en bij unmount', () => {
    const { result, unmount } = renderHook(() => useElementHeight());
    act(() => { result.current.ref(createNode(240)); });
    act(() => { result.current.ref(null); });
    expect(observers[0].disconnected).toBe(true);
    expect(observers).toHaveLength(1);
    unmount();
  });

  it('doet niets wanneer de browser geen ResizeObserver heeft', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const { result } = renderHook(() => useElementHeight());
    act(() => { result.current.ref(createNode(240)); });
    expect(result.current.height).toBe(0);
  });
});
