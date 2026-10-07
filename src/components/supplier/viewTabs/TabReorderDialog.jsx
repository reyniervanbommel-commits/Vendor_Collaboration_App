import React, { useCallback, useMemo, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowDown16Regular,
  ArrowUp16Regular,
  ReOrderDotsVertical16Regular,
  TextSortAscending16Regular,
  TextSortDescending16Regular,
} from '@fluentui/react-icons';
import { useColumnReorderDrag } from '../../../hooks/useColumnReorderDrag';
import { moveId, moveIdRelative, orderItemsByIds, sortItemsByName } from '../../../utils/tabOrder';

const useStyles = makeStyles({
  surface: {
    maxWidth: '440px',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: tokens.spacingHorizontalS,
    marginBottom: tokens.spacingVerticalS,
  },
  hint: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  sortButtons: {
    display: 'flex',
    columnGap: tokens.spacingHorizontalXS,
  },
  list: {
    listStyleType: 'none',
    ...shorthands.margin(0),
    ...shorthands.padding(0),
    maxHeight: '50vh',
    overflowY: 'auto',
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    ...shorthands.borderRadius(tokens.borderRadiusMedium),
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '16px 16px minmax(0, 1fr) auto',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalS,
    minHeight: '34px',
    ...shorthands.padding('0', tokens.spacingHorizontalXS, '0', tokens.spacingHorizontalS),
    backgroundColor: tokens.colorNeutralBackground1,
    cursor: 'grab',
    ':not(:last-child)': {
      ...shorthands.borderBottom('1px', 'solid', tokens.colorNeutralStroke3),
    },
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  rowDragging: {
    opacity: 0.4,
  },
  dropBefore: {
    boxShadow: `inset 0 2px 0 ${tokens.colorBrandStroke1}`,
  },
  dropAfter: {
    boxShadow: `inset 0 -2px 0 ${tokens.colorBrandStroke1}`,
  },
  grip: {
    color: tokens.colorNeutralForeground3,
  },
  marker: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: tokens.colorNeutralForeground3,
  },
  dot: {
    width: '10px',
    height: '10px',
    ...shorthands.borderRadius(tokens.borderRadiusCircular),
    backgroundColor: tokens.colorBrandStroke1,
  },
  name: {
    minWidth: 0,
    overflowWrap: 'anywhere',
  },
  stepButtons: {
    display: 'flex',
  },
});

/**
 * Drag list to reorder tabs, with step buttons (keyboard) and A-Z / Z-A sort.
 * Items: { id, name, color?, icon? }. Nothing changes until "Apply".
 */
export default function TabReorderDialog({
  open,
  title = 'Reorder tabs',
  items,
  hint = '',
  getGroupKey,
  onOpenChange,
  onApply,
}) {
  const styles = useStyles();
  const initialIds = useMemo(() => items.map((item) => String(item.id)), [items]);
  const [ids, setIds] = useState(initialIds);
  const [wasOpen, setWasOpen] = useState(open);
  // Start from the live order each time the dialog opens (not on every parent render).
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setIds(initialIds);
  }

  const ordered = useMemo(
    () => orderItemsByIds(items, ids, (item) => String(item.id)),
    [ids, items],
  );
  const changed = ids.join('|') !== initialIds.join('|');

  const handleDrop = useCallback((sourceId, targetId, position) => {
    setIds((prev) => moveIdRelative(prev, sourceId, targetId, position));
  }, []);
  const drag = useColumnReorderDrag({ onReorder: handleDrop, axis: 'y' });

  const handleSort = useCallback((direction) => {
    const groupKeyOf = getGroupKey
      ? (item) => getGroupKey(item)
      : undefined;
    setIds(sortItemsByName(ordered, direction, { getGroupKey: groupKeyOf }).map((item) => String(item.id)));
  }, [getGroupKey, ordered]);

  const handleApply = useCallback(() => {
    onApply(ids);
    onOpenChange(false);
  }, [ids, onApply, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={(_, data) => onOpenChange(data.open)}>
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent>
            <div className={styles.toolbar}>
              <span className={styles.hint}>{hint || 'Drag to reorder.'}</span>
              <span className={styles.sortButtons}>
                <Button size="small" appearance="subtle" icon={<TextSortAscending16Regular />} onClick={() => handleSort('asc')}>
                  A to Z
                </Button>
                <Button size="small" appearance="subtle" icon={<TextSortDescending16Regular />} onClick={() => handleSort('desc')}>
                  Z to A
                </Button>
              </span>
            </div>
            <ul className={styles.list} aria-label="Tab order">
              {ordered.map((item, index) => {
                const id = String(item.id);
                const isDropTarget = drag.dropTargetKey === id && drag.draggingKey !== id;
                return (
                  <li
                    key={id}
                    className={mergeClasses(
                      styles.row,
                      drag.draggingKey === id && styles.rowDragging,
                      isDropTarget && (drag.dropTargetPosition === 'after' ? styles.dropAfter : styles.dropBefore),
                    )}
                    {...drag.getCellDragProps(id)}
                  >
                    <ReOrderDotsVertical16Regular className={styles.grip} aria-hidden />
                    <span className={styles.marker}>
                      {item.icon || <span className={styles.dot} style={item.color ? { backgroundColor: item.color } : undefined} />}
                    </span>
                    <span className={styles.name}>{item.name}</span>
                    <span className={styles.stepButtons}>
                      <Button
                        size="small"
                        appearance="subtle"
                        icon={<ArrowUp16Regular />}
                        aria-label={`Move ${item.name} up`}
                        disabled={index === 0}
                        onClick={() => setIds((prev) => moveId(prev, id, 'left'))}
                      />
                      <Button
                        size="small"
                        appearance="subtle"
                        icon={<ArrowDown16Regular />}
                        aria-label={`Move ${item.name} down`}
                        disabled={index === ordered.length - 1}
                        onClick={() => setIds((prev) => moveId(prev, id, 'right'))}
                      />
                    </span>
                  </li>
                );
              })}
            </ul>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button appearance="primary" disabled={!changed} onClick={handleApply}>Apply</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
