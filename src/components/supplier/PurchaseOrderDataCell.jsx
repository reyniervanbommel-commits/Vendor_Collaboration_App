import React, { memo, useCallback, useMemo } from 'react';
import { brandColor, interaction } from '../../styles/brandTokens';
import { tokens } from '@fluentui/react-components';
import { isColumnFilterActive } from './purchaseOrderColumnFilterMenuConstants';
import { isCellContextMenuDisabled } from '../../utils/tableViewFilterUtils';
import TrackChangeMarks from './TrackChangeMarks';
import { useTrackChangesMeta } from './trackChangesContext';

function isWhiteCellBackground(backgroundColor) {
  const value = String(backgroundColor || '').trim().toLowerCase();
  return !value || value === '#fff' || value === '#ffffff' || value.startsWith('var(');
}

function PurchaseOrderDataCell({
  cell,
  layout,
  contextMenu,
  children,
}) {
  const { column, rawValue, order, trackMarks } = cell;
  const { className, contentClassName, contentStyle, style } = layout;
  const trackMeta = useTrackChangesMeta();
  const marksByColumnId = trackMarks ?? order?.trackMarksByColumnId;
  const trackPattern = useMemo(() => {
    if (!trackMeta) return null;
    const colId = column?.id;
    if (colId == null) return null;
    const active = Object.prototype.hasOwnProperty.call(trackMeta.activeOffsetByColumnId || {}, String(colId));
    if (!active) return null;
    return marksByColumnId?.[colId] ?? trackMeta.defaultPattern?.[colId] ?? null;
  }, [trackMeta, column?.id, marksByColumnId]);
  const disabled = isCellContextMenuDisabled(column);
  const stickyLeft = Number(column?.stickyLeft);
  const isLocated = Boolean(layout?.isLocated);
  const resolvedCellStyle = useMemo(() => {
    const isSticky = Number.isFinite(stickyLeft);
    const hasBackground = Boolean(style?.backgroundColor);
    return {
      ...style,
      '--po-cell-bg': style?.backgroundColor || brandColor.surfaceCard,
      '--po-fold-divider': isWhiteCellBackground(style?.backgroundColor)
        ? interaction.cellHistoryFoldDivider
        : 'transparent',
      position: isSticky ? 'sticky' : 'relative',
      ...(isSticky ? {
        left: `${stickyLeft}px`,
        zIndex: isLocated ? 4 : 2,
        ...(hasBackground ? {} : { backgroundColor: tokens.colorNeutralBackground1 }),
      } : {}),
    };
  }, [isLocated, stickyLeft, style]);

  // De actieve filter pas uitlezen bij het openen van het menu (ref), zodat een filterwijziging
  // niet elke cel op het bord opnieuw laat renderen.
  const handleContextMenu = useCallback((event) => {
    if (disabled) return;
    event.preventDefault();
    const activeFilter = contextMenu?.filterByColumnRef?.current?.[column.key];
    contextMenu?.open?.(event.currentTarget, {
      column,
      rawValue,
      filterActive: isColumnFilterActive(column, activeFilter),
      order,
    });
  }, [column, contextMenu, disabled, order, rawValue]);

  return (
    <td
      className={className}
      style={resolvedCellStyle}
      onContextMenu={handleContextMenu}
      data-tour={disabled ? undefined : 'po-cell'}
    >
      <div className={contentClassName || undefined} style={contentStyle}>{children}</div>
      {trackPattern ? <TrackChangeMarks pattern={trackPattern} mode={trackMeta?.mode} /> : null}
    </td>
  );
}

export default memo(PurchaseOrderDataCell);
