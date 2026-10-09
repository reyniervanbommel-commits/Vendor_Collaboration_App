import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Radio,
  RadioGroup,
  Spinner,
  Text,
  makeStyles,
  tokens,
  shorthands,
} from '@fluentui/react-components';
import { Save24Regular, Warning24Regular } from '@fluentui/react-icons';
import { useTrackChanges } from '../../hooks/useTrackChanges';
import { apiRequest } from '../../utils/api';
import AdminTrackChangesColumns from './AdminTrackChangesColumns';

const useStyles = makeStyles({
  root: { maxWidth: '760px', display: 'flex', flexDirection: 'column', ...shorthands.gap('20px') },
  section: {
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.borderRadius('8px'),
    ...shorthands.padding('20px'),
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('16px'),
  },
  hint: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  feedback: { color: tokens.colorPaletteGreenForeground1 },
  error: { color: tokens.colorPaletteRedForeground1 },
  actions: { display: 'flex', ...shorthands.gap('12px'), alignItems: 'center', flexWrap: 'wrap' },
  legendRow: { display: 'flex', alignItems: 'center', ...shorthands.gap('10px') },
  swatch: { width: '12px', height: '12px', ...shorthands.borderRadius('50%'), flexShrink: 0 },
  swatchRed: { backgroundColor: tokens.colorPaletteRedBackground3 },
  swatchYellow: { backgroundColor: tokens.colorPaletteYellowBackground3 },
  swatchGrey: { backgroundColor: tokens.colorNeutralBackground5 },
  dialogWarn: { display: 'flex', alignItems: 'flex-start', ...shorthands.gap('10px') },
  warnIcon: { color: tokens.colorPaletteRedForeground1, flexShrink: 0 },
});

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'employee', label: 'Employee' },
  { value: 'supply_chain', label: 'Supply Chain' },
  { value: 'supplier', label: 'Supplier' },
];

const TABLE_KEY = 'purchase-orders';

function formatDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-GB');
}

export default function AdminTrackChangesSettings() {
  const styles = useStyles();
  const { config, loading, error, save } = useTrackChanges({ autoLoad: true });

  const [mode, setMode] = useState('session');
  const [sessionRoles, setSessionRoles] = useState(['admin', 'employee', 'supply_chain']);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [columns, setColumns] = useState([]);
  const [columnsLoading, setColumnsLoading] = useState(true);
  const [columnsError, setColumnsError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    setMode(config.mode);
    setSessionRoles(Array.isArray(config.sessionRoles) ? config.sessionRoles : []);
    setSelectedIds(new Set(Object.keys(config.columns || {})));
  }, [config]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setColumnsLoading(true);
      setColumnsError('');
      try {
        const data = await apiRequest(`/data/${TABLE_KEY}/columns`);
        // Alle echte kolommen zijn trackbaar; alleen afgeleide lookup-kolommen uitsluiten.
        const list = (data.columns || [])
          .filter((c) => c.id != null && c.source !== 'lookup')
          .map((c) => ({ id: c.id, label: c.label, source: c.source, scope: c.scope }));
        if (!cancelled) setColumns(list);
      } catch (err) {
        if (!cancelled) setColumnsError(err.message || 'Could not load columns');
      } finally {
        if (!cancelled) setColumnsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const trackedSince = useMemo(() => {
    const map = {};
    for (const [id, entry] of Object.entries(config.columns || {})) map[id] = entry.activatedAt;
    return map;
  }, [config.columns]);

  const handleModeChange = useCallback((_e, data) => {
    setMode(data.value);
    setFeedback('');
  }, []);

  const handleRoleToggle = useCallback((role) => (_e, data) => {
    setFeedback('');
    setSessionRoles((prev) => (data.checked ? [...new Set([...prev, role])] : prev.filter((r) => r !== role)));
  }, []);

  const handleColumnToggle = useCallback((id, checked) => {
    setFeedback('');
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  const doSave = useCallback(async (reset) => {
    setSaving(true);
    setFeedback('');
    setSaveError('');
    setConfirmOpen(false);
    try {
      const nowIso = new Date().toISOString();
      const columnsMap = {};
      for (const id of selectedIds) {
        columnsMap[id] = { activatedAt: reset ? nowIso : (config.columns?.[id]?.activatedAt || nowIso) };
      }
      await save({ mode, sessionRoles, columns: columnsMap });
      setFeedback(reset
        ? 'Saved. All track changes were reset to 0; tracking restarted.'
        : 'Settings saved to SQL (dbo.app_settings).');
    } catch (err) {
      setSaveError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [selectedIds, config.columns, save, mode, sessionRoles]);

  const handleSaveClick = useCallback(() => {
    const prevIds = Object.keys(config.columns || {});
    const hasAdditions = [...selectedIds].some((id) => !prevIds.includes(id));
    const modeChanged = mode !== config.mode;
    if (hasAdditions || modeChanged) setConfirmOpen(true);
    else doSave(false);
  }, [config.columns, config.mode, selectedIds, mode, doSave]);

  if (loading) return <Spinner label="Loading settings..." />;

  const rolesDisabled = mode !== 'session';

  return (
    <div className={styles.root}>
      <Text size={600} weight="semibold">Track changes</Text>
      <Text className={styles.hint} block>
        Centrally choose which columns are tracked and the granularity. Each cell shows up to eight dots with
        recent changes. Turning a column on or changing the granularity resets all track changes to 0 and
        restarts tracking; turning a column off does not reset the others.
      </Text>

      <div className={styles.section}>
        <Field label="Granularity">
          <RadioGroup value={mode} onChange={handleModeChange} layout="horizontal">
            <Radio value="session" label="Per session" />
            <Radio value="week" label="Per week (Mon–Sun)" />
          </RadioGroup>
        </Field>
        <Text className={styles.hint} block>
          Per session: a new window starts at a login of a selected role. Per week: every ISO week
          (Monday–Sunday) is a window; no session registration is needed then.
        </Text>
      </div>

      <div className={styles.section}>
        <Field label="Which roles start a session?">
          <div>
            {ROLE_OPTIONS.map((role) => (
              <Checkbox
                key={role.value}
                label={role.label}
                disabled={rolesDisabled}
                checked={sessionRoles.includes(role.value)}
                onChange={handleRoleToggle(role.value)}
              />
            ))}
          </div>
        </Field>
        <Text className={styles.hint} block>
          {rolesDisabled
            ? 'Only used in "Per session" mode. In week mode sessions are not registered, so this has no effect.'
            : 'Only a login of a selected role creates a new session. Limit this to internal staff so a session stays a meaningful window.'}
        </Text>
      </div>

      <div className={styles.section}>
        <Text weight="semibold">Tracked columns ({selectedIds.size})</Text>
        <AdminTrackChangesColumns
          columns={columns}
          selectedIds={selectedIds}
          trackedSince={trackedSince}
          loading={columnsLoading}
          onToggle={handleColumnToggle}
          formatDate={formatDate}
        />
        {columnsError && <Text className={styles.error}>{columnsError}</Text>}
      </div>

      <div className={styles.section}>
        <Text weight="semibold">Legend</Text>
        <div className={styles.legendRow}>
          <span className={`${styles.swatch} ${styles.swatchRed}`} aria-hidden />
          <Text>Red — changed in that session/week</Text>
        </div>
        <div className={styles.legendRow}>
          <span className={`${styles.swatch} ${styles.swatchYellow}`} aria-hidden />
          <Text>Yellow — completed session/week without change</Text>
        </div>
        <div className={styles.legendRow}>
          <span className={`${styles.swatch} ${styles.swatchGrey}`} aria-hidden />
          <Text>Grey — running/future session/week or before activation</Text>
        </div>
      </div>

      <div className={styles.actions}>
        <Button appearance="primary" icon={<Save24Regular />} onClick={handleSaveClick} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
        {feedback && <Text className={styles.feedback}>{feedback}</Text>}
        {(saveError || error) && <Text className={styles.error}>{saveError || error}</Text>}
      </div>

      <Dialog open={confirmOpen} onOpenChange={(_e, data) => setConfirmOpen(data.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Restart track changes?</DialogTitle>
            <DialogContent>
              <div className={styles.dialogWarn}>
                <Warning24Regular className={styles.warnIcon} />
                <Text>
                  You are turning a column on or changing the granularity. This resets <b>all</b> track-change
                  dots to 0 and restarts tracking for every column. Continue?
                </Text>
              </div>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setConfirmOpen(false)}>Cancel</Button>
              <Button appearance="primary" onClick={() => doSave(true)}>Yes, restart</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
