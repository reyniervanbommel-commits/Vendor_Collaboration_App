import React from 'react';
import PurchaseOrderFormulaColumnDialog from './PurchaseOrderFormulaColumnDialog';
import PurchaseOrderDatePeriodColumnDialog from './PurchaseOrderDatePeriodColumnDialog';
import PurchaseOrderBulkEditDialog from './PurchaseOrderBulkEditDialog';
import MixedLineValuesConfirmDialog from './MixedLineValuesConfirmDialog';

export default function PurchaseOrdersPageDialogs({ formula, datePeriod, bulkEdit }) {
  return (
    <>
      <PurchaseOrderFormulaColumnDialog
        open={formula.state.open}
        onOpenChange={(open) => !open && formula.close()}
        onSubmit={formula.submit}
        sourceColumn={formula.state.sourceColumn}
        availableColumns={formula.availableColumns}
        initialValue={formula.state.editingColumn}
        initialFormatRuleSet={formula.state.editingColumn?.key ? formula.formatRules[formula.state.editingColumn.key] : null}
      />
      <PurchaseOrderDatePeriodColumnDialog
        open={datePeriod.state.open}
        onOpenChange={(open) => !open && datePeriod.close()}
        onSubmit={datePeriod.submit}
        sourceColumn={datePeriod.state.sourceColumn}
        dateSourceColumns={datePeriod.dateSourceColumns}
      />
      <PurchaseOrderBulkEditDialog dialogState={bulkEdit.dialogState} dialogActions={bulkEdit.dialogActions} />
      <MixedLineValuesConfirmDialog state={bulkEdit.mixedConfirm?.state} actions={bulkEdit.mixedConfirm?.actions} />
    </>
  );
}
