'use strict';

const { recordMatchesAnyLayer } = require('../../utils/odataSyncFilter');
const { parseJson } = require('./parseJson');

function narrowMastersToNativeSupplier({ masterRows, detailsByRecord, masterJsonByRecKey, supplierAccount, supplierFilterColumn, recordFilter }) {
  if (supplierAccount === null || recordFilter) {
    return { masterRows, detailsByRecord };
  }
  const { selectRecKeysMatchingNativeSupplierColumn } = require('../../utils/supplierRowAccess');
  const nativeKeys = selectRecKeysMatchingNativeSupplierColumn(
    masterJsonByRecKey,
    supplierAccount,
    supplierFilterColumn || 'vendorAccount',
  );
  if (!nativeKeys) return { masterRows, detailsByRecord };
  const nextMasters = masterRows.filter((m) => nativeKeys.has(`${m.partition_key}|${m.record_key}`));
  for (const recKey of [...detailsByRecord.keys()]) {
    if (!nativeKeys.has(recKey)) detailsByRecord.delete(recKey);
  }
  return { masterRows: nextMasters, detailsByRecord };
}

function applyBoardRowVisibility(input) {
  const {
    rows, tableKey, activeSyncLayers, itemsLineFilterActive, ordersHiddenByItemsFilter,
    masterJsonByRecKey, detailsByRecord, supplierAccount, supplierFilterColumn,
  } = input;
  let newCount = input.newCount;
  let changedCount = input.changedCount;
  let visibleRows = rows;
  let scopedRows;
  if (tableKey === 'purchase-orders' && (activeSyncLayers.length || itemsLineFilterActive)) {
    visibleRows = rows.filter((row) => {
      const recKey = `${row.partitionKey}|${row.recordKey}`;
      // Items-filter: verberg orders zonder enkele matchende regel (ook retained orders — de
      // gebruiker wil een schoon, op de items-filter gefilterd bord).
      if (itemsLineFilterActive && ordersHiddenByItemsFilter.has(recKey)) return false;
      if (activeSyncLayers.length) {
        if (row.syncRetained) return true;
        const masterJson = masterJsonByRecKey.get(recKey) || {};
        const lineRecords = (detailsByRecord.get(recKey) || []).map((d) => parseJson(d.data_json));
        return recordMatchesAnyLayer(activeSyncLayers, masterJson, lineRecords);
      }
      return true;
    });
    newCount = visibleRows.filter((row) => row.isNew).length;
    changedCount = visibleRows.filter((row) => row.isChanged).length;
  }

  // Supplier-scoping: beperk de rijen tot de eigen leverancier. De admin kiest via een
  // instelling op welke kolom gefilterd wordt (supplierFilterColumn); we vergelijken de
  // afgeleide rijwaarde met het leveranciersaccount van de gebruiker (case-insensitief).
  // Wanneer supplierAccount is meegegeven (ook een lege string) filteren we altijd — een
  // supplier ziet dus nooit onbedoeld alle orders. Staff geeft null door en ziet alles.
  scopedRows = visibleRows;
  if (supplierAccount !== null) {
    const wantedAccount = String(supplierAccount).trim().toLowerCase();
    const filterKey = supplierFilterColumn || 'vendorAccount';
    scopedRows = visibleRows.filter((row) => (
      String(row.values?.[filterKey] ?? '').trim().toLowerCase() === wantedAccount
    ));
    newCount = scopedRows.filter((row) => row.isNew).length;
    changedCount = scopedRows.filter((row) => row.isChanged).length;
  }
  return { scopedRows, newCount, changedCount };
}

module.exports = { narrowMastersToNativeSupplier, applyBoardRowVisibility };
