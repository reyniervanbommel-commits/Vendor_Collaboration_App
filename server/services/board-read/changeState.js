'use strict';

function createOrderChangeState() {
  return { isNew: false, isChanged: false, isRemoved: false, changedFieldKeys: new Set() };
}

function createLineChangeState() {
  return { isNew: false, isChanged: false, isRemoved: false, changedFieldKeys: new Set() };
}

const MASTER_DETAIL_KEY = -1;

function buildD365ChangeState(ledgerRows) {
  const orderChanges = new Map();
  const lineChanges = new Map();
  // Samenvatting per order van wat er met de régels gebeurde. De geaggregeerde detail-read leest de
  // losse regels niet meer, maar heeft deze vlaggen wel nodig voor de activiteitsbalk.
  const lineChangesByOrder = new Map();
  if (!Array.isArray(ledgerRows) || !ledgerRows.length) {
    return { orderChanges, lineChanges, lineChangesByOrder };
  }

  for (const row of ledgerRows) {
    const orderKey = `${row.partition_key}|${row.record_key}`;
    if (!orderChanges.has(orderKey)) orderChanges.set(orderKey, createOrderChangeState());
    const orderState = orderChanges.get(orderKey);
    const detailKey = Number(row.detail_key);
    const fieldKey = String(row.field_key || '').trim();
    const action = String(row.action || '').toUpperCase();

    if (detailKey === MASTER_DETAIL_KEY) {
      // Zelfde last-action-wint als bij regels: DELETE+INSERT (retained restore) mag
      // de order niet als verwijderd laten staan.
      if (action === 'INSERT') {
        orderState.isNew = true;
        orderState.isRemoved = false;
      } else if (action === 'UPDATE') {
        orderState.isChanged = true;
        orderState.isRemoved = false;
      } else if (action === 'DELETE') {
        orderState.isRemoved = true;
        orderState.isNew = false;
        orderState.isChanged = false;
        orderState.changedFieldKeys.clear();
      }
      if (fieldKey) orderState.changedFieldKeys.add(fieldKey);
      continue;
    }

    const lineKey = `${orderKey}|${detailKey}`;
    if (!lineChanges.has(lineKey)) lineChanges.set(lineKey, createLineChangeState());
    const lineState = lineChanges.get(lineKey);
    // Een refresh die een regel opnieuw ophaalt schrijft eerst DELETE en daarna INSERT. Zonder de
    // reset hieronder bleef isRemoved staan en gold een bestaande regel de rest van het
    // ledger-venster als verwijderd — hij verdween dan uit de RCCP-belasting (die filtert op
    // !isRemoved) en werd op het bord als vervallen getoond. De laatste actie wint: INSERT en
    // UPDATE bewijzen dat de regel er weer is.
    if (action === 'INSERT') {
      lineState.isNew = true;
      lineState.isRemoved = false;
    } else if (action === 'UPDATE') {
      lineState.isChanged = true;
      lineState.isRemoved = false;
    } else if (action === 'DELETE') {
      lineState.isRemoved = true;
      lineState.isNew = false;
      lineState.isChanged = false;
      lineState.changedFieldKeys.clear();
    }
    if (fieldKey) lineState.changedFieldKeys.add(fieldKey);
  }

  // Zelfde afleiding als buildDetailRollup(): een regel die nieuw én gewijzigd is telt als nieuw,
  // maar losse gewijzigde velden maken de order altijd "changed".
  for (const [lineKey, lineState] of lineChanges) {
    const orderKey = lineKey.slice(0, lineKey.lastIndexOf('|'));
    if (!lineChangesByOrder.has(orderKey)) {
      lineChangesByOrder.set(orderKey, { hasNewLine: false, hasChangedLine: false, hasRemovedLine: false });
    }
    const summary = lineChangesByOrder.get(orderKey);
    if (lineState.isNew) summary.hasNewLine = true;
    if ((!lineState.isNew && lineState.isChanged) || lineState.changedFieldKeys.size > 0) {
      summary.hasChangedLine = true;
    }
    if (lineState.isRemoved) summary.hasRemovedLine = true;
  }

  return { orderChanges, lineChanges, lineChangesByOrder };
}

module.exports = { buildD365ChangeState, MASTER_DETAIL_KEY };
