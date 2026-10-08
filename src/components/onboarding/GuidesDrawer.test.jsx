import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import GuidesDrawer from './GuidesDrawer';

const tours = [
  { id: 'guideA', kind: 'guide', group: 'views', version: 1, icon: 'view', title: 'Guide A', description: 'A', steps: [{ id: 's', title: 't', body: 'b' }] },
  { id: 'guideB', kind: 'guide', group: 'remarks', version: 1, icon: 'remarks', title: 'Guide B', description: 'B', steps: [{ id: 's', title: 't', body: 'b' }] },
];

describe('GuidesDrawer', () => {
  it('toont de guide-groepen standaard ingeklapt en klapt open bij klikken', () => {
    render(
      <FluentProvider theme={webLightTheme}>
        <GuidesDrawer open tours={tours} onboardingState={{ tours: {} }} onStart={vi.fn()} onClose={vi.fn()} />
      </FluentProvider>
    );
    const views = screen.getByRole('button', { name: /Views & tabs/ });
    expect(views.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Guide A')).toBeNull();
    fireEvent.click(views);
    expect(screen.getByText('Guide A')).toBeTruthy();
    expect(screen.queryByText('Guide B')).toBeNull();
  });
});
