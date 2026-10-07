import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import RemarkComposer from './RemarkComposer';

function renderComposer(props) {
  return render(
    <FluentProvider theme={webLightTheme}>
      <RemarkComposer onSubmit={vi.fn().mockResolvedValue({ id: 1 })} {...props} />
    </FluentProvider>
  );
}

const SUPPLY_CHAIN = { id: 4, role: 'supply_chain', display_name: 'Sam Chain' };

function type(value) {
  fireEvent.change(screen.getByLabelText(/Add a remark/), { target: { value } });
}

describe('RemarkComposer zichtbaarheid', () => {
  it('supply_chain in All: plaatsen staat uit met uitleg', () => {
    renderComposer({ currentUser: SUPPLY_CHAIN, visibility: null });
    expect(screen.getByText('Select Vendor or Internal to post a remark')).toBeTruthy();
    expect(screen.getByLabelText(/Add a remark/).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Add remark' }).hasAttribute('disabled')).toBe(true);
  });

  it('supply_chain in Vendor: knop Send to vendor', () => {
    renderComposer({ currentUser: SUPPLY_CHAIN, visibility: 'vendor' });
    type('Hello');
    expect(screen.getByRole('button', { name: 'Send to vendor' }).hasAttribute('disabled')).toBe(false);
  });

  it('supply_chain in Internal: onSubmit krijgt internal en de keuze blijft', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ id: 1 });
    renderComposer({ currentUser: SUPPLY_CHAIN, visibility: 'internal', onSubmit });
    type('Hello');
    fireEvent.click(screen.getByRole('button', { name: 'Post internal note' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Hello', null, 'internal'));
    expect(screen.getByRole('button', { name: 'Post internal note' })).toBeTruthy();
  });

  it('admin in All kan ook niet plaatsen', () => {
    renderComposer({ currentUser: { id: 1, role: 'admin' }, visibility: null });
    expect(screen.getByLabelText(/Add a remark/).disabled).toBe(true);
  });

  it('employee: altijd intern, ongeacht visibility-prop', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ id: 1 });
    renderComposer({ currentUser: { id: 2, role: 'employee' }, onSubmit });
    expect(screen.getByText('Internal — not visible to vendors')).toBeTruthy();
    type('Note');
    fireEvent.click(screen.getByRole('button', { name: 'Post internal note' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Note', null, null));
  });

  it('vendor: ongewijzigd', () => {
    renderComposer({ currentUser: { id: 3, role: 'supplier' } });
    expect(screen.queryByText(/not visible to vendors/)).toBeNull();
    expect(screen.getByLabelText(/Add a remark/).disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Add remark' })).toBeTruthy();
  });
});
