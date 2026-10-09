import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import RemarkComposer from './RemarkComposer';
import { useMentionPreview, useMentionSuggestions } from './useMentionSuggestions';

vi.mock('./useMentionSuggestions', () => ({
  useMentionSuggestions: vi.fn(),
  useMentionPreview: vi.fn(),
}));

const SC = { id: 4, role: 'supply_chain', display_name: 'Sam' };
const VENDOR = { id: 3, role: 'supplier', display_name: 'Vic' };
const ROW = { partitionKey: 'whsl', recordKey: 'PO-1' };
const SUGGESTIONS = [
  { columnId: 11, columnLabel: 'Artikel', value: 'SFM-12542-00-01', orderCount: 3 },
  { columnId: 11, columnLabel: 'Artikel', value: 'SFM-12542-00-02', orderCount: 1 },
];

function renderComposer(props = {}) {
  const onSubmit = props.onSubmit || vi.fn().mockResolvedValue({ id: 1 });
  render(
    <FluentProvider theme={webLightTheme}>
      <RemarkComposer currentUser={SC} visibility="vendor" tableKey="purchase-orders" row={ROW} {...props} onSubmit={onSubmit} />
    </FluentProvider>
  );
  return { onSubmit, box: screen.getByLabelText(/Add a remark/) };
}

function typeAt(box, value) {
  fireEvent.change(box, { target: { value, selectionStart: value.length, selectionEnd: value.length } });
}

describe('RemarkComposer @mentions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMentionSuggestions.mockImplementation(({ query }) => ({
      suggestions: query && query.length >= 2 ? SUGGESTIONS : [],
      loading: false,
    }));
    useMentionPreview.mockReturnValue({ orderCount: null, vendorCount: null, error: '', loading: false });
  });

  it('toont suggesties na @ en kiest met pijl + Enter zonder te plaatsen', () => {
    const { box, onSubmit } = renderComposer();
    typeAt(box, 'Late @SF');
    const list = screen.getByRole('listbox', { name: 'Mention suggestions' });
    expect(list).toBeTruthy();
    expect(screen.getAllByRole('option')[0].textContent).toContain('SFM-12542-00-01');
    expect(screen.getAllByRole('option')[0].textContent).toContain('3 POs');
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(box.value).toBe('Late @SFM-12542-00-02 ');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('klik op een suggestie voegt die in', () => {
    const { box } = renderComposer();
    typeAt(box, '@SF');
    fireEvent.mouseDown(screen.getAllByRole('option')[0]);
    expect(box.value).toBe('@SFM-12542-00-01 ');
  });

  it('Esc sluit alleen de lijst en propageert niet', () => {
    const outer = vi.fn();
    render(
      <div onKeyDown={outer}>
        <FluentProvider theme={webLightTheme}>
          <RemarkComposer currentUser={SC} visibility="vendor" tableKey="purchase-orders" row={ROW} onSubmit={vi.fn()} />
        </FluentProvider>
      </div>
    );
    const box = screen.getByLabelText(/Add a remark/);
    typeAt(box, '@SF');
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(outer).not.toHaveBeenCalled();
  });

  it('toont bereik voor staff met waarschuwing bij meerdere vendors', () => {
    useMentionPreview.mockReturnValue({ orderCount: 14, vendorCount: 3, error: '', loading: false });
    const { box } = renderComposer();
    typeAt(box, '@SF');
    fireEvent.keyDown(box, { key: 'Enter' });
    const reach = screen.getByText('Will be posted on 14 purchase orders from 3 vendors');
    expect(reach.className).toContain('remarks-mention-reach--warning');
  });

  it('enkelvoud en geen waarschuwing bij Internal', () => {
    useMentionPreview.mockReturnValue({ orderCount: 1, vendorCount: 1, error: '', loading: false });
    const { box } = renderComposer({ visibility: 'internal' });
    typeAt(box, '@SF');
    fireEvent.keyDown(box, { key: 'Enter' });
    const reach = screen.getByText('Will be posted on 1 purchase order from 1 vendor');
    expect(reach.className).not.toContain('warning');
  });

  it('vendor ziet alleen eigen bereik', () => {
    useMentionPreview.mockReturnValue({ orderCount: 4, vendorCount: 1, error: '', loading: false });
    const { box } = renderComposer({ currentUser: VENDOR, visibility: null });
    typeAt(box, '@SF');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(screen.getByText('Will be posted on 4 of your purchase orders')).toBeTruthy();
  });

  it('preview-fout blokkeert plaatsen', () => {
    useMentionPreview.mockReturnValue({ orderCount: null, vendorCount: null, error: 'Too many purchase orders (max 200)', loading: false });
    const { box } = renderComposer();
    typeAt(box, '@SF');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(screen.getByText('Too many purchase orders (max 200)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send to vendor' }).hasAttribute('disabled')).toBe(true);
  });

  it('stuurt alleen mentions mee die nog in de tekst staan', async () => {
    useMentionPreview.mockReturnValue({ orderCount: 3, vendorCount: 1, error: '', loading: false });
    const { box, onSubmit } = renderComposer();
    typeAt(box, '@SF');
    fireEvent.keyDown(box, { key: 'Enter' });
    typeAt(box, `${box.value}is late`);
    fireEvent.click(screen.getByRole('button', { name: 'Send to vendor' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(
      '@SFM-12542-00-01 is late', null, 'vendor', [{ columnId: 11, value: 'SFM-12542-00-01' }],
    ));
  });

  it('weggehaalde mention wordt niet meegestuurd', async () => {
    const { box, onSubmit } = renderComposer();
    typeAt(box, '@SF');
    fireEvent.keyDown(box, { key: 'Enter' });
    typeAt(box, 'never mind');
    fireEvent.click(screen.getByRole('button', { name: 'Send to vendor' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('never mind', null, 'vendor', []));
  });

  it('markeert een gekozen @mention al tijdens het typen', () => {
    const { box } = renderComposer();
    typeAt(box, 'Check @SF');
    fireEvent.keyDown(box, { key: 'Enter' });
    typeAt(box, `${box.value}today @XYZ`);
    const marks = document.querySelectorAll('.remarks-composer-highlight .remark-mention-chip');
    expect([...marks].map((m) => m.textContent)).toEqual(['@SFM-12542-00-01']);
    expect(document.querySelector('.remarks-composer-highlight').getAttribute('aria-hidden')).toBe('true');
  });
});
