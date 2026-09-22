import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button, Input,
  Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, makeStyles, shorthands, tokens,
} from '@fluentui/react-components';
import PurchaseOrderColumnHeaderDialogs from './PurchaseOrderColumnHeaderDialogs';
import D365LogoIcon from './D365LogoIcon';
import { MoreVerticalRegular } from '@fluentui/react-icons';

const useStyles = makeStyles({
  header: { width: '100%', minWidth: 0, maxWidth: '100%', minHeight: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', ...shorthands.gap('4px') },
  labelWrap: { display: 'inline-flex', alignItems: 'center', minWidth: 0, maxWidth: '100%', flex: 1, ...shorthands.gap('4px') },
  labelText: { minWidth: 0, maxWidth: '100%', display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  menuButton: { minWidth: '20px', width: '20px', height: '20px', ...shorthands.padding('0') },
  error: { color: tokens.colorPaletteRedForeground1, marginTop: '8px' },
});

export default function PurchaseOrderColumnHeader({
  column,
  onRename,
  onRemove,
  isAdmin,
  onToggleWriteback,
  showActionsMenu = true,
  autoEdit = false,
  onEditingDone,
  showWriteBackIcon = false,
}) {
  const styles = useStyles();
  const isCustom = column.source === 'custom';
  const writable = !!column.writableToD365;
  const showD365WriteBackIcon = showWriteBackIcon || (!isCustom && writable);
  const [renameOpen, setRenameOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [label, setLabel] = useState(column.label);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [inlineValue, setInlineValue] = useState(column.label);
  const inlineInputRef = useRef(null);
  useEffect(() => {
    if (autoEdit) setInlineValue(column.label);
  }, [autoEdit, column.label]);

  useEffect(() => {
    if (autoEdit && inlineInputRef.current) {
      inlineInputRef.current.focus({ preventScroll: true });
      inlineInputRef.current.select();
    }
  }, [autoEdit]);

  const commitInline = useCallback(async () => {
    const trimmed = inlineValue.trim();
    if (trimmed && trimmed !== column.label) {
      try { await onRename(column.id, trimmed); } catch { /* naam blijft ongewijzigd */ }
    }
    if (onEditingDone) onEditingDone();
  }, [inlineValue, column.label, column.id, onRename, onEditingDone]);

  const handleInlineKey = useCallback((event) => {
    if (event.key === 'Enter') { event.preventDefault(); commitInline(); }
    else if (event.key === 'Escape') { if (onEditingDone) onEditingDone(); }
  }, [commitInline, onEditingDone]);

  const openRename = useCallback(() => { setLabel(column.label); setError(''); setRenameOpen(true); }, [column.label]);
  const submitRename = useCallback(async () => {
    const trimmed = label.trim();
    if (!trimmed) return setError('Enter a column name.');
    setBusy(true); setError('');
    try { await onRename(column.id, trimmed); setRenameOpen(false); } catch (err) { setError(err.message || 'Rename failed.'); } finally { setBusy(false); }
  }, [label, onRename, column.id]);
  const submitRemove = useCallback(async () => {
    setBusy(true); setError('');
    try { await onRemove(column.id); setConfirmOpen(false); } catch (err) { setError(err.message || 'Delete failed.'); } finally { setBusy(false); }
  }, [onRemove, column.id]);

  const columnLabel = (
    <span className={styles.labelWrap}>
      {showD365WriteBackIcon ? (
        <span aria-label="Write-back to D365 enabled">
          <D365LogoIcon alt="" />
        </span>
      ) : null}
      <span className={styles.labelText}>{column.label}</span>
    </span>
  );

  if (autoEdit) {
    return (
      <div className={styles.header}>
        <Input
          size="small"
          value={inlineValue}
          onChange={(_, data) => setInlineValue(data.value)}
          input={{ ref: inlineInputRef }}
          onBlur={commitInline}
          onKeyDown={handleInlineKey}
          onMouseDown={(event) => event.stopPropagation()}
          draggable={false}
          aria-label="Column name"
        />
      </div>
    );
  }

  const columnOptionsMenu = (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <Button size="small" appearance="subtle" className={styles.menuButton} icon={<MoreVerticalRegular />} aria-label={`Column options for ${column.label}`} />
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          <MenuItem onClick={openRename}>Rename</MenuItem>
          <MenuItem onClick={() => { setError(''); setConfirmOpen(true); }}>Delete</MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );

  if (!isCustom) {
    // Write-back naar D365 is uitsluitend instelbaar via Admin > Data model.
    // Deze header toont hier alleen het (read-only) D365-icoon, geen toggle-menu.
    return <div className={styles.header}>{columnLabel}</div>;
  }

  return (
    <div className={styles.header}>
      {columnLabel}
      {showActionsMenu ? columnOptionsMenu : null}

      <PurchaseOrderColumnHeaderDialogs
        columnLabel={column.label}
        errorClassName={styles.error}
        renameOpen={renameOpen}
        setRenameOpen={setRenameOpen}
        label={label}
        setLabel={setLabel}
        submitRename={submitRename}
        confirmOpen={confirmOpen}
        setConfirmOpen={setConfirmOpen}
        submitRemove={submitRemove}
        busy={busy}
        error={error}
      />
    </div>
  );
}
