import React from 'react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import EditRoleDialog from './EditRoleDialog';

function renderDialog(user, onSave = vi.fn()) {
  render(
    <FluentProvider theme={webLightTheme}>
      <EditRoleDialog user={user} open onOpenChange={vi.fn()} onSave={onSave} />
    </FluentProvider>
  );
  return onSave;
}

function selectRole(value) {
  fireEvent.change(screen.getByRole('combobox'), { target: { value } });
}

const EMPLOYEE = { id: 9, email: 'employee@vanbommel.nl', role: 'employee' };

describe('EditRoleDialog', () => {
  it('disables Save until the role actually changes', async () => {
    renderDialog(EMPLOYEE);

    const save = screen.getByRole('button', { name: /Save/i });
    expect(save.hasAttribute('disabled')).toBe(true);

    selectRole('admin');

    await waitFor(() => expect(save.hasAttribute('disabled')).toBe(false));
  });

  it('warns that granted settings permissions are cleared when an employee changes role', async () => {
    renderDialog(EMPLOYEE);

    expect(screen.queryByText(/permissions of this user will be cleared/i)).toBeNull();

    selectRole('admin');

    expect(await screen.findByText(/permissions of this user will be cleared/i)).toBeTruthy();
  });

  it('does not warn for a vendor, who has no settings permissions', async () => {
    renderDialog({ id: 4, email: 'vendor@x.nl', role: 'supplier' });

    selectRole('employee');

    await waitFor(() => expect(screen.getByRole('combobox').value).toBe('employee'));
    expect(screen.queryByText(/permissions of this user will be cleared/i)).toBeNull();
  });

  it('saves the selected role for the given user', async () => {
    const onSave = renderDialog(EMPLOYEE, vi.fn().mockResolvedValue(undefined));

    selectRole('admin');
    fireEvent.click(screen.getByRole('button', { name: /Save/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(9, 'admin'));
  });

  it('shows the error from the backend when saving fails', async () => {
    renderDialog(EMPLOYEE, vi.fn().mockRejectedValue(new Error('You cannot change your own role')));

    selectRole('admin');
    fireEvent.click(screen.getByRole('button', { name: /Save/i }));

    expect(await screen.findByText('You cannot change your own role')).toBeTruthy();
  });
});
