// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';

vi.mock('../../utils/api', () => ({ apiRequest: vi.fn() }));

import { apiRequest } from '../../utils/api';
import OnboardingProgressAnalytics from './OnboardingProgressAnalytics';

const USERS = [
  {
    id: 1,
    email: 'anna@vanbommel.nl',
    displayName: 'Anna Admin',
    role: 'admin',
    welcomeSeenAt: '2026-09-10T08:00:00.000Z',
    tours: {
      poBoard: { version: 1, status: 'completed', step: 11, steps: 11, at: '2026-09-10T08:10:00.000Z', completedAt: '2026-09-10T08:10:00.000Z' },
      guideFormula: { version: 1, status: 'skipped', step: 6, steps: 9, at: '2026-09-11T09:00:00.000Z' },
    },
  },
  { id: 2, email: 'vendor@supplier.com', displayName: '', role: 'supplier', vendorAccount: 'V001', welcomeSeenAt: null, tours: {} },
];

function renderSection() {
  return render(
    <FluentProvider theme={webLightTheme}>
      <OnboardingProgressAnalytics />
    </FluentProvider>,
  );
}

describe('OnboardingProgressAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiRequest.mockResolvedValue({ users: USERS });
  });

  it('lists users with their completion and expands per-guide steps', async () => {
    renderSection();
    const table = await screen.findByRole('table', { name: 'Guide progress per user' });
    expect(within(table).getByText('Anna Admin')).toBeTruthy();
    expect(within(table).getByText('vendor@supplier.com')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Show guide details for Anna Admin' }));
    expect(await screen.findByText('Step 6 of 9 · Write the formula')).toBeTruthy();
  });

  it('shows the furthest step per user for a selected guide', async () => {
    renderSection();
    await screen.findByRole('table', { name: 'Guide progress per user' });
    fireEvent.change(screen.getByRole('combobox', { name: /Guide or tour/ }), { target: { value: 'guideFormula' } });

    const table = await screen.findByRole('table', { name: 'Progress per user for the selected guide' });
    expect(within(table).getByText('Stopped')).toBeTruthy();
    // Suppliers don't get the formula guide, so they are not listed for it.
    expect(within(table).queryByText('vendor@supplier.com')).toBeNull();
  });

  it('filters users by search', async () => {
    renderSection();
    await screen.findByRole('table', { name: 'Guide progress per user' });
    fireEvent.change(screen.getByPlaceholderText('Search name, email or vendor'), { target: { value: 'v001' } });
    await waitFor(() => expect(screen.queryByText('Anna Admin')).toBeNull());
    expect(screen.getByText('vendor@supplier.com')).toBeTruthy();
  });
});
