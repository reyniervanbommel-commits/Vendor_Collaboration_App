// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { apiRequest } from '../../../utils/api';
import RemarksPanel from './RemarksPanel';

vi.mock('../../../utils/api', () => ({ apiRequest: vi.fn() }));

const ROW = { partitionKey: 'USMF', recordKey: 'PO-207' };

function responseFor(path) {
  if (path.endsWith('/remarks/summary')) return { rows: [] };
  if (path.includes('/remarks?')) return { items: [], total: 2, nextCursor: null };
  return {
    items: [],
    totals: { remarks: 0, history: 4, historyUpdated: 2 },
    nextCursor: null,
    newestCursor: 'cursor-1',
  };
}

function renderPanel(props) {
  return render(
    <FluentProvider theme={webLightTheme}>
      <RemarksPanel
        open
        row={ROW}
        currentUser={{ id: 1, displayName: 'Taylor Buyer' }}
        columns={[{ id: 10, label: 'Status' }]}
        onClose={vi.fn()}
        {...props}
      />
    </FluentProvider>
  );
}

describe('RemarksPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiRequest.mockImplementation(responseFor);
  });

  it('toont tabs, tellers, composer en tab-specifieke filterstate', async () => {
    renderPanel();

    expect(await screen.findByRole('tab', { name: 'Remarks (2)' })).toBeTruthy();
    expect(await screen.findByRole('tab', { name: /History \(\d+\)/ })).toBeTruthy();
    expect(screen.getByLabelText('Add a remark')).toBeTruthy();
    expect(screen.queryByLabelText('Filter by column')).toBeNull();

    const historyTab = screen.getByRole('tab', { name: /History \(\d+\)/ });
    fireEvent.click(historyTab);
    expect(await screen.findByLabelText('Filter by column')).toBeTruthy();
    expect(await screen.findByLabelText('Filter by action')).toBeTruthy();
    expect(await screen.findByLabelText('Filter by user')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('tab', { name: 'History (2)' })).toBeTruthy());
    expect(screen.getByText('No history has been recorded yet.')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'All' }));
    expect(await screen.findByLabelText('Add a remark')).toBeTruthy();
  });

  it('sluit via de knop en herstelt focus naar de opener', async () => {
    const onClose = vi.fn();
    const opener = document.createElement('button');
    opener.textContent = 'Open remarks';
    document.body.appendChild(opener);
    const openerRef = { current: opener };
    const view = renderPanel({ onClose, openerRef });

    await waitFor(() =>
      expect(screen.getByLabelText('Add a remark')).toBe(document.activeElement)
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close remarks panel' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    view.rerender(
      <FluentProvider theme={webLightTheme}>
        <RemarksPanel
          open={false}
          row={ROW}
          currentUser={{ id: 1, displayName: 'Taylor Buyer' }}
          columns={[]}
          onClose={onClose}
          openerRef={openerRef}
        />
      </FluentProvider>
    );
    await waitFor(() => expect(document.activeElement).toBe(opener));
    opener.remove();
  });

  it('roept onLocateRow aan wanneer op het PO-nummer wordt geklikt', async () => {
    const onLocateRow = vi.fn();
    renderPanel({ onLocateRow });

    fireEvent.click(await screen.findByRole('button', { name: 'Go to purchase order PO-207 in table' }));
    expect(onLocateRow).toHaveBeenCalledTimes(1);
  });

  describe('zichtbaarheidstoggle', () => {
    const SC = { id: 4, role: 'supply_chain', displayName: 'Sam Chain' };
    const remarks = [
      { id: 1, body: 'Message for vendor', visibility: 'vendor', author: { id: 7, displayName: 'Ann' }, reactions: [], createdAt: '2026-10-07T10:00:00Z' },
      { id: 2, body: 'Internal message', visibility: 'internal', author: { id: 8, displayName: 'Bob' }, reactions: [], createdAt: '2026-10-07T09:00:00Z' },
    ];

    beforeEach(() => {
      apiRequest.mockImplementation((path) => (
        path.includes('/remarks?') ? { items: remarks, total: 2, nextCursor: null } : responseFor(path)
      ));
    });

    it('staat standaard op All: alles zichtbaar, plaatsen uit', async () => {
      renderPanel({ currentUser: SC });
      expect(await screen.findByText('Message for vendor')).toBeTruthy();
      expect(screen.getByText('Internal message')).toBeTruthy();
      expect(screen.getByRole('radio', { name: 'All' }).checked).toBe(true);
      expect(screen.getByLabelText(/Add a remark/).disabled).toBe(true);
    });

    it('Vendor toont alleen vendor-remarks en zet plaatsen aan', async () => {
      renderPanel({ currentUser: SC });
      await screen.findByText('Message for vendor');
      fireEvent.click(screen.getByRole('radio', { name: 'Vendor' }));
      expect(screen.getByText('Message for vendor')).toBeTruthy();
      expect(screen.queryByText('Internal message')).toBeNull();
      expect(screen.getByLabelText(/Add a remark/).disabled).toBe(false);
    });

    it('Internal toont alleen interne remarks', async () => {
      renderPanel({ currentUser: SC });
      await screen.findByText('Message for vendor');
      fireEvent.click(screen.getByRole('radio', { name: 'Internal' }));
      expect(screen.getByText('Internal message')).toBeTruthy();
      expect(screen.queryByText('Message for vendor')).toBeNull();
    });

    it('employee krijgt geen toggle', async () => {
      renderPanel({ currentUser: { id: 2, role: 'employee', displayName: 'Emp' } });
      await screen.findByRole('tab', { name: 'Remarks (2)' });
      expect(screen.queryByRole('radiogroup')).toBeNull();
    });
  });
});
