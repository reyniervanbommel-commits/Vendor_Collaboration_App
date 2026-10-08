// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import RemarkComposer from './RemarkComposer';
import RemarkMessageCard from './RemarkMessageCard';
import RemarkReactionBar from './RemarkReactionBar';
import RemarksLatestCell from './RemarksLatestCell';
import RowHistoryEntry from './RowHistoryEntry';
import RowRemarksBadge from './RowRemarksBadge';

function renderWithFluent(component) {
  return render(<FluentProvider theme={webLightTheme}>{component}</FluentProvider>);
}

const REMARK = {
  id: 7,
  body: '<strong>Plain text only</strong>',
  author: { id: 2, displayName: 'Alex Buyer' },
  createdAt: '2026-07-13T10:00:00.000Z',
  canDelete: true,
  reactions: [],
};

describe('remarks components', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('formatteert ISO-datums in history als dd/mm/jjjj', () => {
    renderWithFluent(
      <RowHistoryEntry
        entry={{
          action: 'UPDATE',
          columnLabel: 'Leverdatum',
          oldValue: '2026-04-09T00:00:00.000Z',
          newValue: '2026-04-09T12:00:00.000Z',
          createdAt: '2026-07-14T08:06:00.000Z',
        }}
      />
    );

    expect(screen.getAllByText('09/04/2026')).toHaveLength(2);
    expect(screen.queryByText(/2026-04-09T/)).toBeNull();
  });

  it('gebruikt display_name uit de sessie voor de composer-avatar', () => {
    renderWithFluent(
      <RemarkComposer currentUser={{ display_name: 'Reynier van Bommel', email: 'reynier@example.com' }} onSubmit={vi.fn()} />
    );

    expect(screen.getByText('RB')).toBeTruthy();
    expect(screen.queryByText('CU')).toBeNull();
  });

  it('behoudt de draft bij een mislukte submit en wist hem na succes', async () => {
    const onSubmit = vi.fn().mockRejectedValueOnce(new Error('Save failed')).mockResolvedValueOnce({ id: 1 });
    renderWithFluent(<RemarkComposer currentUser={{ displayName: 'Taylor' }} onSubmit={onSubmit} />);

    const composer = screen.getByLabelText('Add a remark');
    fireEvent.change(composer, { target: { value: 'Needs follow-up' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add remark' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Save failed');
    expect(composer.value).toBe('Needs follow-up');

    fireEvent.click(screen.getByRole('button', { name: 'Add remark' }));
    await waitFor(() => expect(composer.value).toBe(''));
  });

  it('toont uitsluitend whitelist-reacties achter een Like-knop', async () => {
    const onToggle = vi.fn();
    renderWithFluent(
      <RemarkReactionBar
        remarkId={7}
        reactions={[{ emoji: '😊', count: 1, reactedByCurrentUser: false }]}
        onToggle={onToggle}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Like (1)' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Add 😊 reaction/ }));
    await waitFor(() => expect(onToggle).toHaveBeenCalledWith(7, '😊', true));
  });

  it('schakelt reacties op een eigen remark toegankelijk uit', () => {
    renderWithFluent(<RemarkReactionBar remarkId={7} ownRemark reactions={[]} onToggle={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Reactions are unavailable on your own remark' }).disabled).toBe(true);
  });

  it('toont een inline fout wanneer een reactie niet kan worden opgeslagen', async () => {
    renderWithFluent(
      <RemarkReactionBar
        remarkId={7}
        reactions={[]}
        onToggle={vi.fn().mockRejectedValue(new Error('Reaction failed'))}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Like' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Add 😊 reaction/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('Reaction failed');
  });

  it('rendert remarktekst letterlijk en bevestigt delete inline', async () => {
    const onDelete = vi.fn().mockResolvedValue({});
    renderWithFluent(
      <RemarkMessageCard remark={REMARK} currentUser={{ id: 2 }} onDelete={onDelete} onReaction={vi.fn()} />
    );

    expect(screen.getByText('<strong>Plain text only</strong>')).toBeTruthy();
    expect(document.querySelector('strong')?.textContent).not.toBe('Plain text only');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('group', { name: 'Confirm remark deletion' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(7));
  });

  it('geeft de opener terug vanuit badge en latest-cel', () => {
    const onOpen = vi.fn();
    renderWithFluent(
      <>
        <RowRemarksBadge count={3} orderNumber="PO-1" onOpen={onOpen} />
        <RemarksLatestCell
          orderNumber="PO-1"
          summary={{ count: 3, latest: { bodyPreview: 'Latest', authorName: 'Alex' } }}
          onOpen={onOpen}
        />
      </>
    );

    const badge = screen.getByRole('button', { name: /Open 3 remarks/ });
    fireEvent.click(badge);
    expect(onOpen).toHaveBeenLastCalledWith(badge);
    const cell = screen.getByRole('button', { name: /Open remarks/ });
    fireEvent.click(cell);
    expect(onOpen).toHaveBeenLastCalledWith(cell);
  });

  it('toont een plus-wolkje zonder remarks', () => {
    const { container } = renderWithFluent(
      <RowRemarksBadge count={0} orderNumber="PO-2" onOpen={vi.fn()} />
    );

    expect(screen.getByRole('button', { name: /Add a remark for purchase order PO-2/ })).toBeTruthy();
    expect(container.querySelector('.remarks-badge-count')).toBeNull();
    expect(container.querySelector('.remarks-badge-plus')).toBeTruthy();
  });

  it('toont No remarks cursief en grijs zonder latest remark', () => {
    const { container } = renderWithFluent(
      <RemarksLatestCell orderNumber="PO-3" summary={{ count: 0 }} onOpen={vi.fn()} />
    );

    expect(screen.getByRole('button', { name: /Open remarks for purchase order PO-3/ }).textContent).toBe('No remarks');
    expect(container.querySelector('.remarks-latest-preview--empty')).toBeTruthy();
  });

  describe('zichtbaarheid', () => {
    const base = { id: 1, body: 'x', author: { id: 2, displayName: 'Ann' }, reactions: [], createdAt: '2026-10-07T10:00:00Z' };
    const renderCard = (remark) => renderWithFluent(
      <RemarkMessageCard remark={remark} currentUser={{ id: 9 }} onDelete={vi.fn()} onReaction={vi.fn()} />
    );

    it('toont alleen de term Internal', () => {
      renderCard({ ...base, visibility: 'internal' });
      expect(screen.getByText('Internal')).toBeTruthy();
      expect(screen.queryByText('Vendor')).toBeNull();
    });

    it('toont alleen de term Vendor', () => {
      renderCard({ ...base, visibility: 'vendor' });
      expect(screen.getByText('Vendor')).toBeTruthy();
      expect(screen.queryByText(/Shared with/)).toBeNull();
      expect(screen.queryByText('Internal')).toBeNull();
    });

    it('toont geen badges zonder visibility (employee/vendor)', () => {
      renderCard(base);
      expect(screen.queryByText('Internal')).toBeNull();
      expect(screen.queryByText('Vendor')).toBeNull();
    });

    it('toont Reply-knop alleen met onReply en niet op tombstone', () => {
      const onReply = vi.fn();
      const { unmount } = renderWithFluent(<RemarkMessageCard remark={{ ...base }} currentUser={{ id: 9 }} onDelete={vi.fn()} onReaction={vi.fn()} onReply={onReply} />);
      fireEvent.click(screen.getByRole('button', { name: 'Reply to Ann' }));
      expect(onReply).toHaveBeenCalled();
      unmount();
      renderWithFluent(<RemarkMessageCard remark={{ ...base, isDeleted: true }} currentUser={{ id: 9 }} onDelete={vi.fn()} onReaction={vi.fn()} onReply={onReply} />);
      expect(screen.queryByRole('button', { name: 'Reply to Ann' })).toBeNull();
    });

    it('toont Reply to-regel bij replyTo', () => {
      renderWithFluent(<RemarkMessageCard remark={{ ...base, replyTo: { id: 1, authorName: 'Bob' } }} currentUser={{ id: 9 }} onDelete={vi.fn()} onReaction={vi.fn()} />);
      expect(screen.getByText('↳ Reply to Bob')).toBeTruthy();
    });

    it('toont @mentions als chip', () => {
      renderCard({ ...base, body: 'Late @A-1 again', mentions: [{ value: 'A-1', columnLabel: 'Artikel' }] });
      const chip = screen.getByText('@A-1');
      expect(chip.className).toContain('remark-mention-chip');
      expect(chip.getAttribute('title')).toBe('Artikel');
    });

    it("toont op hoeveel PO's een groep staat (alleen met broadcastCount)", () => {
      const { unmount } = renderCard({ ...base, broadcastId: 'b1', broadcastCount: 14 });
      expect(screen.getByText('Posted on 14 purchase orders')).toBeTruthy();
      unmount();
      renderCard({ ...base, broadcastId: 'b1' });
      expect(screen.queryByText(/Posted on/)).toBeNull();
    });

    it("verwijderbevestiging noemt alle PO's van de groep", () => {
      renderCard({ ...base, canDelete: true, broadcastId: 'b1', broadcastCount: 14 });
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      expect(screen.getByText('Delete this remark on all 14 purchase orders?')).toBeTruthy();
    });

    it('markeert de kaart met een accent per zichtbaarheid', () => {
      renderCard({ ...base, visibility: 'internal' });
      expect(screen.getByRole('article').classList.contains('remark-card--internal')).toBe(true);
    });

    it('zet datum en tijd op een eigen regel onder de naam', () => {
      renderCard(base);
      const name = screen.getByText('Ann');
      const date = screen.getByText((_, el) => el?.classList?.contains('remark-card-date'));
      expect(date.textContent).not.toContain('·');
      expect(name.parentElement).toBe(date.parentElement);
      expect(name.parentElement.classList.contains('remark-author-text')).toBe(true);
    });

    it('latest-cel toont slot bij interne laatste remark', () => {
      renderWithFluent(
        <RemarksLatestCell summary={{ latest: { bodyPreview: 'x', visibility: 'internal', createdAt: '2026-10-07T10:00:00Z' } }} onOpen={vi.fn()} />
      );
      expect(screen.getByRole('img', { name: 'Internal remark' })).toBeTruthy();
      expect(screen.getByRole('button').getAttribute('title')).toMatch(/^Internal · /);
    });

    it('latest-cel zonder slot bij vendor-remark', () => {
      renderWithFluent(
        <RemarksLatestCell summary={{ latest: { bodyPreview: 'x', visibility: 'vendor', createdAt: '2026-10-07T10:00:00Z' } }} onOpen={vi.fn()} />
      );
      expect(screen.queryByRole('img', { name: 'Internal remark' })).toBeNull();
    });
  });

  it('zet de zichtbaarheidsbadge rechtsboven bij de acties', () => {
    renderWithFluent(
      <RemarkMessageCard
        remark={{ id: 1, body: 'x', author: { id: 2, displayName: 'Ann' }, reactions: [], visibility: 'vendor', canDelete: true }}
        currentUser={{ id: 9 }}
        onDelete={vi.fn()}
        onReaction={vi.fn()}
      />
    );
    const actions = document.querySelector('.remark-card-actions');
    expect(actions.textContent).toContain('Vendor');
    expect(actions.textContent).toContain('Delete');
    expect(document.querySelector('.remark-author').textContent).not.toContain('Vendor');
  });
});
