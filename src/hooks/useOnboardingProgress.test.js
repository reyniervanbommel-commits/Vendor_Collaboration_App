// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('../utils/api', () => ({ apiRequest: vi.fn() }));

import { apiRequest } from '../utils/api';
import { useOnboardingProgress } from './useOnboardingProgress';

describe('useOnboardingProgress', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads users from the analytics endpoint', async () => {
    apiRequest.mockResolvedValueOnce({ users: [{ id: 1, email: 'a@b.nl', tours: {} }] });
    const { result } = renderHook(() => useOnboardingProgress());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(apiRequest).toHaveBeenCalledWith('/admin/analytics/onboarding');
    expect(result.current.users).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it('exposes an error and can refresh', async () => {
    apiRequest.mockRejectedValueOnce(new Error('Forbidden'));
    const { result } = renderHook(() => useOnboardingProgress());
    await waitFor(() => expect(result.current.error).toBe('Forbidden'));

    apiRequest.mockResolvedValueOnce({ users: [] });
    await act(async () => { await result.current.refresh(); });
    expect(result.current.error).toBeNull();
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });
});
