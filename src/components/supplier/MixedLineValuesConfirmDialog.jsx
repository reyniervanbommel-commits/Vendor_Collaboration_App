import React from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Text,
} from '@fluentui/react-components';

/** Pagina-niveau bevestiging: header-edit overschrijft afwijkende D365-regelwaarden. */
export default function MixedLineValuesConfirmDialog({ state, actions }) {
  const { open = false, message = '' } = state || {};
  return (
    <Dialog modalType="alert" open={open} onOpenChange={(_, data) => { if (!data.open) actions?.onCancel(); }}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Overwrite different line values?</DialogTitle>
          <DialogContent>
            <Text>{message}</Text>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={() => actions?.onCancel()}>Cancel</Button>
            <Button appearance="primary" onClick={() => actions?.onConfirm()}>Update all lines</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
