import React, { useCallback } from 'react';
import {
  Button, Drawer, DrawerBody, DrawerFooter, DrawerHeader, DrawerHeaderTitle,
  Spinner, Text, makeStyles, shorthands, tokens,
} from '@fluentui/react-components';
import { Dismiss24Regular, Save24Regular } from '@fluentui/react-icons';
import { useRccpSettings } from '../../hooks/useRccpSettings';
import RccpSettingsForm from './RccpSettingsForm';

const useStyles = makeStyles({
  drawer: {
    width: '360px',
    maxWidth: '100vw',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap(tokens.spacingHorizontalM),
    flexWrap: 'wrap',
  },
  hint: { color: tokens.colorNeutralForeground3 },
  error: { color: tokens.colorPaletteRedForeground1 },
});

export default function RccpSettingsFlyout({ open, onClose, onSaved }) {
  const styles = useStyles();
  const settings = useRccpSettings();
  const handleClose = useCallback(() => onClose?.(), [onClose]);
  const handleOpenChange = useCallback((_, data) => {
    if (!data.open) handleClose();
  }, [handleClose]);
  const handleSave = useCallback(async () => {
    const ok = await settings.save();
    if (ok) onSaved?.();
  }, [onSaved, settings]);

  return (
    <Drawer
      className={styles.drawer}
      open={open}
      position="end"
      size="small"
      onOpenChange={handleOpenChange}
    >
      <DrawerHeader>
        <DrawerHeaderTitle
          action={(
            <Button
              appearance="subtle"
              icon={<Dismiss24Regular />}
              aria-label="Close settings"
              onClick={handleClose}
            />
          )}
        >
          Settings
        </DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody>
        {settings.loading ? <Spinner label="Loading settings..." /> : (
          <RccpSettingsForm
            variant="flyout"
            config={settings.config}
            columns={settings.columns}
            itemColumns={settings.itemColumns}
            statusOptions={settings.statusOptions}
            onUpdateField={settings.updateField}
          />
        )}
      </DrawerBody>
      {!settings.loading && settings.config && (
        <DrawerFooter>
          <div className={styles.footer}>
            <Button
              appearance="primary"
              icon={<Save24Regular />}
              onClick={handleSave}
              disabled={settings.saving}
            >
              Save settings
            </Button>
            {settings.saving && <Spinner size="tiny" />}
            {settings.saved && <Text className={styles.hint}>Saved</Text>}
            {settings.error && <Text className={styles.error}>{settings.error}</Text>}
          </div>
        </DrawerFooter>
      )}
    </Drawer>
  );
}
