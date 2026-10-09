import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import RemarkMessageCard from './RemarkMessageCard';
import { remarkAccent } from './remarkAccent';

const remark = { id: 1, body: 'Check', author: { id: 2, displayName: 'Ann' }, createdAt: '2026-10-08T10:00:00Z' };

function renderCard(role, props = {}) {
  render(
    <FluentProvider theme={webLightTheme}>
      <RemarkMessageCard remark={{ ...remark, ...props }} currentUser={{ id: 9, role }} onDelete={vi.fn()} onReaction={vi.fn()} />
    </FluentProvider>
  );
  return screen.getByRole('article', { name: 'Remark by Ann' });
}

describe('remarkAccent', () => {
  it('geeft employees de interne (gele) accentkleur', () => {
    expect(remarkAccent(undefined, 'employee')).toBe('internal');
    expect(remarkAccent(undefined, 'supplier')).toBeNull();
    expect(remarkAccent('vendor', 'admin')).toBe('vendor');
  });

  it('toont een employee de opmerking met de interne rand', () => {
    expect(renderCard('employee').className).toContain('remark-card--internal');
  });

  it('geeft een vendor geen accentrand', () => {
    expect(renderCard('supplier').className).not.toContain('remark-card--');
  });
});
