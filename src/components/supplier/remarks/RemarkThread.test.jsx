import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import RemarkThread from './RemarkThread';

const reply = (id, body) => ({ id, parentId: 1, body, author: { id: 3, displayName: 'Bob' }, reactions: [], createdAt: `2026-10-07T10:0${id % 10}:00Z` });
const root = (replies = []) => ({ id: 1, parentId: null, body: 'Root', visibility: 'internal', author: { id: 2, displayName: 'Ann' }, reactions: [], createdAt: '2026-10-07T09:00:00Z', replies, replyCount: replies.length });
const actions = { onDelete: vi.fn(), onReaction: vi.fn() };

function renderThread(props = {}) {
  const defaults = {
    remark: root(), currentUser: { id: 9 }, remarkActions: actions, canReply: true, replyOpen: false,
    onOpenReply: vi.fn(), onCloseReply: vi.fn(), onSubmitReply: vi.fn().mockResolvedValue({}), showVisibility: true,
  };
  const all = { ...defaults, ...props };
  return { ...render(<FluentProvider theme={webLightTheme}><RemarkThread {...all} /></FluentProvider>), props: all };
}

describe('RemarkThread', () => {
  it('toont maximaal 2 replies met Show earlier-link', () => {
    renderThread({ remark: root([reply(11, 'a'), reply(12, 'b'), reply(13, 'c'), reply(14, 'd')]) });
    expect(screen.queryByText('a')).toBeNull();
    expect(screen.getByText('c')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 earlier replies' }));
    expect(screen.getByText('a')).toBeTruthy();
  });

  it('enkelvoud bij 1 verborgen reply', () => {
    renderThread({ remark: root([reply(11, 'a'), reply(12, 'b'), reply(13, 'c')]) });
    expect(screen.getByRole('button', { name: 'Show 1 earlier reply' })).toBeTruthy();
  });

  it('replies-lijst heeft toegankelijk label en replies hebben geen Reply-knop', () => {
    renderThread({ remark: root([reply(11, 'a')]) });
    expect(screen.getByRole('list', { name: "Replies to Ann's remark" })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Reply to/ })).toHaveLength(1);
  });

  it('opent composer via Reply en plaatst naar de root', async () => {
    const { props, rerender } = renderThread();
    fireEvent.click(screen.getByRole('button', { name: 'Reply to Ann' }));
    expect(props.onOpenReply).toHaveBeenCalledWith(1);
    rerender(<FluentProvider theme={webLightTheme}><RemarkThread {...props} replyOpen /></FluentProvider>);
    fireEvent.change(screen.getByRole('textbox', { name: 'Reply to Ann' }), { target: { value: 'Ok' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    await waitFor(() => expect(props.onSubmitReply).toHaveBeenCalledWith(1, 'Ok'));
    expect(props.onCloseReply).toHaveBeenCalled();
  });

  it('geen Reply-knop zonder canReply', () => {
    renderThread({ canReply: false });
    expect(screen.queryByRole('button', { name: 'Reply to Ann' })).toBeNull();
  });

  it('toont geen "Reply to"-regel binnen een gesprek (ook niet bij gepollde replies)', () => {
    renderThread({ remark: root([{ ...reply(11, 'a'), replyTo: { id: 1, authorName: 'Ann' } }]) });
    expect(screen.queryByText(/Reply to Ann$/)).toBeNull();
  });

  it('replies-lijst heeft expliciet role=list', () => {
    renderThread({ remark: root([reply(11, 'a')]) });
    expect(screen.getByRole('list', { name: "Replies to Ann's remark" }).getAttribute('role')).toBe('list');
  });

  it('toont verwijderde replies niet', () => {
    renderThread({ remark: root([reply(11, 'kept'), { ...reply(12, 'gone'), isDeleted: true, body: null }]) });
    expect(screen.getByText('kept')).toBeTruthy();
    expect(screen.queryByText('This remark was deleted.')).toBeNull();
  });
});
