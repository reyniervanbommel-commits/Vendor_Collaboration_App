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

  describe('replies', () => {
    const SC = { id: 4, role: 'supply_chain', displayName: 'Sam Chain' };
    const thread = {
      id: 1, parentId: null, body: 'Root remark', visibility: 'internal', author: { id: 7, displayName: 'Ann' },
      reactions: [], createdAt: '2026-10-07T09:00:00Z', lastActivityAt: '2026-10-07T09:00:00Z',
      replies: [{ id: 5, parentId: 1, body: 'First reply', visibility: 'internal', author: { id: 8, displayName: 'Bob' }, reactions: [], createdAt: '2026-10-07T09:30:00Z' }],
      replyCount: 1,
    };

    beforeEach(() => {
      apiRequest.mockImplementation(async (path, init) => {
        if (init?.method === 'POST') return { remark: { id: 6, parentId: 1, body: 'New reply', author: { id: 4, displayName: 'Sam Chain' }, reactions: [], createdAt: '2026-10-07T10:00:00Z' } };
        if (path.includes('/remarks?')) return { items: [thread], total: 2, nextCursor: null };
        return responseFor(path);
      });
    });

    it('toont het gesprek en plaatst een reply in stand All', async () => {
      renderPanel({ currentUser: SC });
      expect(await screen.findByText('First reply')).toBeTruthy();
      expect(screen.getByRole('radio', { name: 'All' }).checked).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Reply to Ann' }));
      expect(screen.getByText('Replying to Ann')).toBeTruthy();
      fireEvent.change(screen.getByRole('textbox', { name: 'Reply to Ann' }), { target: { value: 'New reply' } });
      fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
      expect(await screen.findByText('New reply')).toBeTruthy();
      const post = apiRequest.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(post[1].body).toMatchObject({ parentId: 1 });
      expect(post[1].body).not.toHaveProperty('visibility');
    });

    it('sluit het reply-venster bij wisselen van tab of filter', async () => {
      renderPanel({ currentUser: SC });
      await screen.findByText('First reply');
      fireEvent.click(screen.getByRole('button', { name: 'Reply to Ann' }));
      expect(screen.getByText('Replying to Ann')).toBeTruthy();
      fireEvent.click(screen.getByRole('radio', { name: 'Internal' }));
      expect(screen.queryByText('Replying to Ann')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Reply to Ann' }));
      fireEvent.click(screen.getByRole('tab', { name: /History/ }));
      fireEvent.click(screen.getByRole('tab', { name: /Remarks/ }));
      await screen.findByText('First reply');
      expect(screen.queryByText('Replying to Ann')).toBeNull();
    });

    it('opent maar één reply-venster tegelijk', async () => {
      apiRequest.mockImplementation(async (path) => (
        path.includes('/remarks?')
          ? { items: [thread, { ...thread, id: 2, body: 'Other', author: { id: 9, displayName: 'Cas' }, replies: [] }], total: 3, nextCursor: null }
          : responseFor(path)
      ));
      renderPanel({ currentUser: SC });
      await screen.findByText('Other');
      fireEvent.click(screen.getByRole('button', { name: 'Reply to Ann' }));
      fireEvent.click(screen.getByRole('button', { name: 'Reply to Cas' }));
      expect(screen.queryByText('Replying to Ann')).toBeNull();
      expect(screen.getByText('Replying to Cas')).toBeTruthy();
    });
  });

  describe('@mention-groepen en board-tellers', () => {
    const SC = { id: 4, role: 'supply_chain', displayName: 'Sam Chain' };
    const group = {
      id: 9, parentId: null, body: 'Late @A-1', visibility: 'internal', broadcastId: 'b1', broadcastCount: 3,
      mentions: [{ value: 'A-1', columnLabel: 'Artikel' }], author: { id: 4, displayName: 'Sam Chain' },
      reactions: [], replies: [], canDelete: true, createdAt: '2026-10-08T09:00:00Z', lastActivityAt: '2026-10-08T09:00:00Z',
    };
    const summaryState = () => ({ summaryByRow: new Map(), refresh: vi.fn(), updateRow: vi.fn() });

    it('ververst de board-tellers na plaatsen van een groepsopmerking', async () => {
      apiRequest.mockImplementation(async (path, init) => {
        if (init?.method === 'POST' && path.endsWith('/remarks')) return { remark: group };
        if (path.includes('/remarks?')) return { items: [], total: 0, nextCursor: null };
        return responseFor(path);
      });
      const summary = summaryState();
      renderPanel({ currentUser: SC, summaryState: summary });
      await screen.findByRole('tab', { name: /Remarks/ });
      fireEvent.click(screen.getByRole('radio', { name: 'Internal' }));
      fireEvent.change(screen.getByLabelText(/Add a remark/), { target: { value: 'Late' } });
      fireEvent.click(screen.getByRole('button', { name: 'Post internal note' }));
      await waitFor(() => expect(summary.refresh).toHaveBeenCalled());
    });

    it('ververst de board-tellers na verwijderen van een groepsopmerking', async () => {
      apiRequest.mockImplementation(async (path, init) => {
        if (init?.method === 'DELETE') return { remark: { ...group, isDeleted: true, body: null } };
        if (path.includes('/remarks?')) return { items: [group], total: 1, nextCursor: null };
        return responseFor(path);
      });
      const summary = summaryState();
      renderPanel({ currentUser: SC, summaryState: summary });
      await screen.findByText('@A-1');
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
      await waitFor(() => expect(summary.refresh).toHaveBeenCalled());
    });
  });

  describe('verwijderde opmerkingen', () => {
    const base = {
      parentId: null, author: { id: 7, displayName: 'Ann' }, reactions: [], replies: [],
      createdAt: '2026-10-08T09:00:00Z', lastActivityAt: '2026-10-08T09:00:00Z',
    };

    it('verbergt een verwijderde opmerking zonder replies, toont er één met replies als korte regel', async () => {
      apiRequest.mockImplementation(async (path) => (path.includes('/remarks?')
        ? {
          items: [
            { ...base, id: 1, body: null, isDeleted: true },
            { ...base, id: 2, body: null, isDeleted: true, replies: [{ ...base, id: 5, parentId: 2, body: 'Still here', author: { id: 8, displayName: 'Bob' } }] },
            { ...base, id: 3, body: 'Alive' },
          ],
          total: 2,
          nextCursor: null,
        }
        : responseFor(path)));
      renderPanel();
      expect(await screen.findByText('Alive')).toBeTruthy();
      expect(screen.getByText('Still here')).toBeTruthy();
      expect(screen.getAllByText('This remark was deleted.')).toHaveLength(1);
    });

    it('haalt een opmerking direct weg na verwijderen', async () => {
      apiRequest.mockImplementation(async (path, init) => {
        if (init?.method === 'DELETE') return { remark: { ...base, id: 3, body: null, isDeleted: true } };
        if (path.includes('/remarks?')) return { items: [{ ...base, id: 3, body: 'Bye', canDelete: true }], total: 1, nextCursor: null };
        return responseFor(path);
      });
      renderPanel();
      await screen.findByText('Bye');
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
      await waitFor(() => expect(screen.queryByText('This remark was deleted.')).toBeNull());
      expect(screen.queryByText('Bye')).toBeNull();
    });
  });
});
