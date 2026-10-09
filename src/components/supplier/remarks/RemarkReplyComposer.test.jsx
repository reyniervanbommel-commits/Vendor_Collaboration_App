import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import RemarkReplyComposer from './RemarkReplyComposer';

const renderIt = (props = {}) => render(
  <FluentProvider theme={webLightTheme}>
    <RemarkReplyComposer authorName="Ann" onSubmit={vi.fn().mockResolvedValue({})} onCancel={vi.fn()} showVisibility={false} {...props} />
  </FluentProvider>
);

describe('RemarkReplyComposer', () => {
  it('focust het tekstvak en toont Replying to', () => {
    renderIt();
    expect(screen.getByText('Replying to Ann')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Reply to Ann' })).toBe(document.activeElement);
  });

  it('Ctrl+Enter plaatst, lege tekst niet', async () => {
    const onSubmit = vi.fn().mockResolvedValue({});
    renderIt({ onSubmit });
    const box = screen.getByRole('textbox', { name: 'Reply to Ann' });
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: 'Thanks' } });
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Thanks'));
  });

  it('Esc annuleert en propageert niet', () => {
    const onCancel = vi.fn();
    const outer = vi.fn();
    render(
      <div onKeyDown={outer}>
        <FluentProvider theme={webLightTheme}>
          <RemarkReplyComposer authorName="Ann" onSubmit={vi.fn()} onCancel={onCancel} showVisibility={false} />
        </FluentProvider>
      </div>
    );
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Reply to Ann' }), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
    expect(outer).not.toHaveBeenCalled();
  });

  it('houdt tekst bij fout en toont melding', async () => {
    renderIt({ onSubmit: vi.fn().mockRejectedValue(new Error('Save failed')) });
    const box = screen.getByRole('textbox', { name: 'Reply to Ann' });
    fireEvent.change(box, { target: { value: 'Thanks' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Save failed');
    expect(box.value).toBe('Thanks');
  });

  it('toont visibility-chip alleen als showVisibility', () => {
    const { unmount } = renderIt({ showVisibility: true, visibility: 'internal' });
    expect(screen.getByText('Internal')).toBeTruthy();
    unmount();
    renderIt({ showVisibility: false, visibility: 'internal' });
    expect(screen.queryByText('Internal')).toBeNull();
  });

  it('Esc annuleert ook met focus op een knop', () => {
    const onCancel = vi.fn();
    renderIt({ onCancel });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Cancel' }), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });
});
