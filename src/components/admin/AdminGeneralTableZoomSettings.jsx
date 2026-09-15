import React, { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Field,
  Spinner,
  Text,
  makeStyles,
  tokens,
  shorthands,
} from '@fluentui/react-components';
import { Save24Regular } from '@fluentui/react-icons';
import { apiRequest } from '../../utils/api';
import {
  PO_TABLE_ZOOM_DEFAULT,
  parsePoTableZoom,
  setPoTableZoom,
} from '../../utils/poTableZoom';
import PurchaseOrderTableZoomControl from '../supplier/PurchaseOrderTableZoomControl';

const useStyles = makeStyles({
  panel: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('16px'),
    paddingBottom: tokens.spacingVerticalS,
  },
  hint: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  feedback: { color: tokens.colorPaletteGreenForeground1 },
  error: { color: tokens.colorPaletteRedForeground1 },
  actions: { display: 'flex', ...shorthands.gap('12px'), alignItems: 'center', flexWrap: 'wrap' },
});

export default function AdminGeneralTableZoomSettings() {
  const styles = useStyles();
  const [zoom, setZoom] = useState(PO_TABLE_ZOOM_DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    apiRequest('/auth/po-table-zoom')
      .then((data) => {
        if (!active) return;
        setZoom(parsePoTableZoom(data?.poTableZoom));
      })
      .catch((err) => {
        if (!active) return;
        setError(err?.message || 'Failed to load settings');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const handleZoomChange = useCallback((next) => {
    setZoom(parsePoTableZoom(next));
    setFeedback('');
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setFeedback('');
    setError('');
    try {
      const data = await apiRequest('/auth/po-table-zoom', {
        method: 'PATCH',
        body: { poTableZoom: zoom },
      });
      const saved = parsePoTableZoom(data?.poTableZoom ?? zoom);
      setZoom(saved);
      setPoTableZoom(saved);
      setFeedback('Settings saved. This scale applies only to your account.');
    } catch (err) {
      setError(err?.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }, [zoom]);

  if (loading) return <Spinner size="tiny" label="Loading settings…" />;

  return (
    <div className={styles.panel}>
      <Field
        label="Scale"
        hint="75% to 110%, in steps of 5%. Default 85%. Applies to the purchase orders table, charts, Performance & Planning and KPIs for your account only."
      >
        <PurchaseOrderTableZoomControl
          value={zoom}
          onChange={handleZoomChange}
        />
      </Field>
      <Text className={styles.hint}>
        Save to apply this scale for you. Other users keep their own setting.
      </Text>
      <div className={styles.actions}>
        <Button
          appearance="primary"
          icon={<Save24Regular />}
          onClick={handleSave}
          disabled={saving}
        >
          Save
        </Button>
        {saving ? <Spinner size="tiny" /> : null}
      </div>
      {feedback ? <Text className={styles.feedback}>{feedback}</Text> : null}
      {error ? <Text className={styles.error}>{error}</Text> : null}
    </div>
  );
}
