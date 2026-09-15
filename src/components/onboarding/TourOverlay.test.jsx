// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import TourOverlay from './TourOverlay';

function addAnchor(name) {
  const el = document.createElement('button');
  el.setAttribute('data-tour', name);
  el.getBoundingClientRect = () => ({ left: 100, top: 100, width: 80, height: 30, right: 180, bottom: 130 });
  el.scrollIntoView = vi.fn();
  document.body.appendChild(el);
  return el;
}

const tour = {
  id: 'poBoard',
  kind: 'tour',
  title: 'Test tour',
  steps: [
    { id: 'one', anchor: '[data-tour="one"]', title: 'First step', body: 'Hello' },
    {
      id: 'two',
      anchor: '[data-tour="two"]',
      title: 'Click it',
      body: 'Do the thing',
      action: true,
      hint: 'Click the button',
      advanceOn: { click: '[data-tour="two"]' },
    },
  ],
};

function renderOverlay(props) {
  const handlers = { onGoTo: vi.fn(), onFinish: vi.fn(), onExit: vi.fn() };
  const utils = render(
    <FluentProvider theme={webLightTheme}>
      <TourOverlay tour={tour} stepIndex={0} direction={1} {...handlers} {...props} />
    </FluentProvider>,
  );
  return { ...utils, ...handlers };
}

function flushFrames(ms = 300) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('TourOverlay', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('shows the step card once the anchor is found and navigates with Next', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    addAnchor('one');
    const { onGoTo, onExit } = renderOverlay();
    flushFrames();

    expect(screen.getByText('First step')).toBeTruthy();
    expect(screen.getByText('1 of 2')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(onGoTo).toHaveBeenCalledWith(1, 1);

    fireEvent.click(screen.getByRole('button', { name: 'Close tour' }));
    expect(onExit).toHaveBeenCalled();
  });

  it('waits for the user on action steps and finishes after the click', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    const target = addAnchor('two');
    const { onFinish } = renderOverlay({ stepIndex: 1 });
    flushFrames();

    expect(screen.getByText('Click the button')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Done/ })).toBeNull();

    fireEvent.click(target);
    flushFrames(100);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('explains when a required anchor never appears', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    renderOverlay();
    flushFrames(4500);
    expect(screen.getByText(/isn’t available right now/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Skip step' })).toBeTruthy();
  });
});
