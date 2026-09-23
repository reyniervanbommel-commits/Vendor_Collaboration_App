import React from 'react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EditPermissionsDialog from './EditPermissionsDialog';

vi.mock('../../utils/api', () => ({
  apiRequest: vi.fn(async () => []),
}));

import { apiRequest } from '../../utils/api';

function renderDialog(user) {
  render(
    <FluentProvider theme={webLightTheme}>
      <EditPermissionsDialog user={user} open onOpenChange={vi.fn()} onSaved={vi.fn()} />
    </FluentProvider>
  );
}

describe('EditPermissionsDialog comments', () => {
  beforeEach(() => {
    apiRequest.mockClear();
  });
  it('toont comment-vinkjes aan een vendor en geen OData', async () => {
    renderDialog({ id: 4, email: 'vendor@x.nl', role: 'supplier' });
    expect(await screen.findByText('View comments')).toBeTruthy();
    expect(screen.getByText('Add comments')).toBeTruthy();
    expect(screen.getByText('Show comments column')).toBeTruthy();
    expect(screen.queryByText('OData')).toBeNull();
  });

  it('zet View aan wanneer Add wordt aangezet', async () => {
    renderDialog({ id: 4, email: 'vendor@x.nl', role: 'supplier' });
    const add = await screen.findByRole('checkbox', { name: 'Add comments' });
    fireEvent.click(add);
    expect(screen.getByRole('checkbox', { name: 'View comments' }).checked).toBe(true);
    expect(add.checked).toBe(true);
  });

  it('toont een admin geen comment-vinkjes', async () => {
    renderDialog({ id: 1, email: 'admin@x.nl', role: 'admin' });
    expect(screen.getByText(/Settings permissions can only be granted to employees/i)).toBeTruthy();
    expect(screen.queryByText('View comments')).toBeNull();
    expect(apiRequest).not.toHaveBeenCalled();
  });
});
