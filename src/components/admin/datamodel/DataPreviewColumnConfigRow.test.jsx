// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { Table, TableBody } from '@fluentui/react-components';
import { renderWithFluent } from '../../../test-utils/render';
import DataPreviewColumnConfigRow from './DataPreviewColumnConfigRow';

const NOOP = vi.fn();

function renderRow(column, extra = {}) {
  return renderWithFluent(
    <Table>
      <TableBody>
        <DataPreviewColumnConfigRow
          column={column}
          typeLabel="Number"
          sampleValue="—"
          isRelationField={false}
          togglingKey={null}
          onToggleVisibility={NOOP}
          onToggleVisibleAtDelete={NOOP}
          onToggleWriteback={NOOP}
          onDeleteColumn={NOOP}
          {...extra}
        />
      </TableBody>
    </Table>
  );
}

describe('DataPreviewColumnConfigRow', () => {
  it('toont Linked line total naast Custom column', () => {
    renderRow({
      id: 2,
      key: 'qty_total',
      label: 'Remaining qty Total',
      source: 'custom',
      dataType: 'number',
      isActive: true,
      hideAllowed: true,
      visibleAtDelete: false,
      writeBackAllowed: false,
      linkedFromLine: 'total',
    });
    expect(screen.getByText('Custom column')).toBeTruthy();
    expect(screen.getByText('Linked line total')).toBeTruthy();
  });

  it('waarschuwt bij delete dat de kolom uit een line-link komt', () => {
    renderRow({
      id: 3,
      key: 'item_values',
      label: 'Item Values',
      source: 'custom',
      dataType: 'text',
      isActive: true,
      hideAllowed: true,
      visibleAtDelete: false,
      writeBackAllowed: false,
      linkedFromLine: 'values',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText(/Push values to header column/)).toBeTruthy();
  });

  it('toont een Mentionable-schakelaar voor tekstbronkolommen', () => {
    const onToggleMentionable = vi.fn();
    const column = {
      id: 9, key: 'itemNumber', label: 'Artikel', source: 'd365', dataType: 'text', isActive: true,
      hideAllowed: true, visibleAtDelete: false, writeBackAllowed: false, mentionableAllowed: true, mentionable: false,
    };
    renderRow(column, { onToggleMentionable });
    fireEvent.click(screen.getByRole('switch', { name: 'Mentionable for Artikel' }));
    expect(onToggleMentionable).toHaveBeenCalledWith(column);
  });

  it('toont Not available voor niet-mentionable kolommen', () => {
    renderRow({
      id: 10, key: 'qty', label: 'Qty', source: 'd365', dataType: 'number', isActive: true,
      hideAllowed: true, visibleAtDelete: false, writeBackAllowed: false, mentionableAllowed: false,
    });
    expect(screen.queryByRole('switch', { name: 'Mentionable for Qty' })).toBeNull();
  });
});
