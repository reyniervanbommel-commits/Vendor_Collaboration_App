'use strict';

const { getTableByKey } = require('../TableRegistryService');
const { parseDefaultFilterRules } = require('./detailReadPlan');

async function resolveItemsLineFilter({ table, enrichment, loadPresentItemFilterKeys }) {
  let itemsFilterKeys = null;
  let itemsFilterField = 'itemNumber';
  if (table.key === 'purchase-orders') {
    try {
      const itemsTable = await getTableByKey('items');
      const itemsFilterRules = parseDefaultFilterRules(itemsTable.defaultFilter);
      if (itemsFilterRules.length) {
        const itemsLookup = (enrichment.lookups || []).find(
          (lk) => String(lk.targetTableKey || '').trim().toLowerCase() === 'items' && lk.sourceScope === 'detail'
        );
        const derivedField = String(itemsLookup?.sourceFieldKey || '').trim();
        if (derivedField) itemsFilterField = derivedField;
        itemsFilterKeys = await loadPresentItemFilterKeys(itemsTable.id);
      }
    } catch {
      itemsFilterKeys = null;
    }
  }
  const itemsLineFilterActive = table.key === 'purchase-orders' && itemsFilterKeys !== null;
  return { itemsFilterKeys, itemsFilterField, itemsLineFilterActive };
}

module.exports = { resolveItemsLineFilter };
