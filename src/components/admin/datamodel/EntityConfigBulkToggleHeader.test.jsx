// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { Table, TableHeader, TableRow } from '@fluentui/react-components';
import { renderWithFluent } from '../../../test-utils/render';
import EntityConfigBulkToggleHeader from './EntityConfigBulkToggleHeader';

function renderHeader(action) {
  return renderWithFluent(
    <Table>
      <TableHeader>
        <TableRow>
          <EntityConfigBulkToggleHeader label="Vendor edit" fullLabel="Editable by vendor" info="Info" action={action} />
        </TableRow>
      </TableHeader>
    </Table>
  );
}

describe('EntityConfigBulkToggleHeader', () => {
  it('toont een kort label met de volledige naam als tooltip en compacte aan/uit-knoppen', () => {
    const action = { onEnable: vi.fn(), onDisable: vi.fn(), affectedCount: 4, disableEnable: false, disableDisable: false };
    renderHeader(action);
    expect(screen.getByText('Vendor edit').closest('[title]').getAttribute('title')).toBe('Editable by vendor');
    expect(screen.queryByText('All on')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Turn Editable by vendor on for 4 filtered columns' }));
    fireEvent.click(screen.getByRole('button', { name: 'Turn Editable by vendor off for 4 filtered columns' }));
    expect(action.onEnable).toHaveBeenCalled();
    expect(action.onDisable).toHaveBeenCalled();
  });
});
