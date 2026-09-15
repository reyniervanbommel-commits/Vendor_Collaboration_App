// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('../utils/api', () => ({ apiRequest: vi.fn() }));

import { apiRequest } from '../utils/api';
import { useOnboardingState } from './useOnboardingState';

describe('useOnboardingState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not load without a user', () => {
    const { result } = renderHook(() => useOnboardingState(null));
    expect(apiRequest).not.toHaveBeenCalled();
    expect(result.current.loaded).toBe(false);
  });

  it('loads the stored state for the user', async () => {
    apiRequest.mockResolvedValueOnce({
      settings: { onboarding: { welcomeSeenAt: '2026-09-15T00:00:00.000Z', tours: { poBoard: { version: 1, status: 'completed' } } } },
    });
    const { result } = renderHook(() => useOnboardingState(7));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(apiRequest).toHaveBeenCalledWith('/supplier/board-settings/onboarding');
    expect(result.current.available).toBe(true);
    expect(result.current.state.tours.poBoard.status).toBe('completed');
  });

  it('marks the state unavailable when the endpoint fails', async () => {
    apiRequest.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useOnboardingState(7));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.available).toBe(false);
  });

  it('updates optimistically and PATCHes only the delta', async () => {
    apiRequest.mockResolvedValueOnce({ settings: { onboarding: null } });
    apiRequest.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useOnboardingState(7));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.markTour({ id: 'rccp', version: 2 }, 'skipped');
    });

    expect(result.current.state.tours.rccp).toMatchObject({ version: 2, status: 'skipped' });
    const [path, options] = apiRequest.mock.calls[1];
    expect(path).toBe('/supplier/board-settings/onboarding');
    expect(options.method).toBe('PATCH');
    expect(Object.keys(options.body.settings.onboarding.tours)).toEqual(['rccp']);
  });

  it('saves step progress debounced, and a finish supersedes a pending step save', async () => {
    apiRequest.mockResolvedValueOnce({ settings: { onboarding: null } });
    apiRequest.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useOnboardingState(7));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    vi.useFakeTimers();
    try {
      const tour = { id: 'guideFormula', version: 1, steps: new Array(9).fill({}) };
      act(() => {
        result.current.markTour(tour, 'in_progress', { step: 1, restart: true });
        result.current.trackTourStep(tour, 2);
        result.current.trackTourStep(tour, 3);
      });
      expect(result.current.state.tours.guideFormula).toMatchObject({ status: 'in_progress', step: 3, steps: 9 });
      expect(apiRequest).toHaveBeenCalledTimes(2); // load + start

      act(() => { vi.advanceTimersByTime(3000); });
      expect(apiRequest).toHaveBeenCalledTimes(3);
      expect(apiRequest.mock.calls[2][1].body.settings.onboarding.tours.guideFormula.step).toBe(3);

      act(() => {
        result.current.trackTourStep(tour, 4);
        result.current.markTour(tour, 'skipped', { step: 4 });
        vi.advanceTimersByTime(3000);
      });
      expect(apiRequest).toHaveBeenCalledTimes(4);
      expect(apiRequest.mock.calls[3][1].body.settings.onboarding.tours.guideFormula).toMatchObject({ status: 'skipped', step: 4 });
    } finally {
      vi.useRealTimers();
    }
  });
});
