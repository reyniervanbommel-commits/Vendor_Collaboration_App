// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  canConsumeHorizontalWheel,
  isHorizontallyScrollable,
  shouldPreventTrackpadNavigation,
} from './trackpadNavigation';

function createScrollContainer({ scrollWidth = 200, clientWidth = 100, scrollLeft = 0 } = {}) {
  const element = document.createElement('div');
  Object.defineProperty(element, 'scrollWidth', { value: scrollWidth, configurable: true });
  Object.defineProperty(element, 'clientWidth', { value: clientWidth, configurable: true });
  Object.defineProperty(element, 'scrollLeft', {
    value: scrollLeft,
    writable: true,
    configurable: true,
  });
  element.style.overflowX = 'auto';
  return element;
}

describe('trackpadNavigation', () => {
  it('detecteert horizontaal scrollbare containers', () => {
    const scrollable = createScrollContainer();
    const fixed = document.createElement('div');

    expect(isHorizontallyScrollable(scrollable)).toBe(true);
    expect(isHorizontallyScrollable(fixed)).toBe(false);
  });

  it('laat horizontale wheel toe wanneer er scrollruimte is', () => {
    const container = createScrollContainer({ scrollLeft: 0 });
    const child = document.createElement('span');
    container.appendChild(child);

    expect(canConsumeHorizontalWheel(child, 10)).toBe(true);
    expect(canConsumeHorizontalWheel(child, -10)).toBe(false);
  });

  it('blokkeert horizontale wheel buiten scrollcontainers', () => {
    const target = document.createElement('div');
    const event = { deltaX: 12, ctrlKey: false, target };

    expect(shouldPreventTrackpadNavigation(event)).toBe(true);
  });

  it('negeert verticale wheel en zoom-gestures', () => {
    const target = document.createElement('div');

    expect(shouldPreventTrackpadNavigation({ deltaX: 0, ctrlKey: false, target })).toBe(false);
    expect(shouldPreventTrackpadNavigation({ deltaX: 12, ctrlKey: true, target })).toBe(false);
  });
});
