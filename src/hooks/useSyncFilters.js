import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../utils/api';

// Sync-filter-endpoints op de generieke tb_*-laag (po_* is verwijderd, #AB:177).
const syncBase = (tableKey) => `/data/${tableKey}`;

// Centrale registry van D365-enumvelden (single source of truth, frontend-zijde). Enum-velden zijn
// geen vrije tekst: OData vereist de notatie Microsoft.Dynamics.DataEntities.<enumType>'<Member>'.
// `enumType` bepaalt de OData-namespace, `members` vult de waarde-dropdown in de sync-filter-UI.
// Een nieuw enum-veld toevoegen = één entry hieronder. Backend-mirror: server/utils/d365EnumFields.js
// (veld → enumType). Houd beide in sync.
export const ENUM_FIELDS = {
  PurchaseOrderStatus: {
    enumType: 'PurchStatus',
    members: ['None', 'Backorder', 'Received', 'Invoiced', 'Canceled'],
  },
  ProductType: {
    enumType: 'EcoResProductType',
    members: ['Item', 'Service'],
  },
};

// Lichtgewicht client-preview van wat de server compileert (zie server/utils/odataSyncFilter.js).
// Geëxporteerd zodat useSyncFilterLayers.js (#325 — meerdere additieve filter-lagen) dezelfde
// preview-logica per laag kan hergebruiken zonder duplicatie.
export function previewRule(rule) {
  const { level, field, operator, value, valueType, enumType } = rule;
  if (!field || !operator || value === '' || value === null || value === undefined) return null;
  const fieldRef = level === 'line' ? `l/${field}` : field;
  if (valueType === 'enum') {
    const expr = `${fieldRef} ${operator} Microsoft.Dynamics.DataEntities.${enumType}'${value}'`;
    return level === 'line' ? `PurchaseOrderLines/any(l: ${expr})` : expr;
  }
  if (valueType === 'number') {
    const expr = `${fieldRef} ${operator} ${value}`;
    return level === 'line' ? `PurchaseOrderLines/any(l: ${expr})` : expr;
  }
  if (valueType === 'date') {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    const expr = `${fieldRef} ${operator} ${parsed.toISOString()}`;
    return level === 'line' ? `PurchaseOrderLines/any(l: ${expr})` : expr;
  }
  const escaped = String(value).replace(/'/g, "''");
  let expr;
  if (operator === 'contains') expr = `contains(${fieldRef},'${escaped}')`;
  else if (operator === 'notcontains') expr = `not contains(${fieldRef},'${escaped}')`;
  else if (operator === 'startswith') expr = `startswith(${fieldRef},'${escaped}')`;
  else if (operator === 'notstartswith') expr = `not startswith(${fieldRef},'${escaped}')`;
  else if (operator === 'oneof') {
    const parts = String(value).split(',').map((v) => v.trim()).filter(Boolean);
    if (!parts.length) return null;
    const serializePart = (v) => {
      if (valueType === 'enum') return `Microsoft.Dynamics.DataEntities.${enumType}'${v}'`;
      return `'${v.replace(/'/g, "''")}'`;
    };
    expr = `(${parts.map((v) => `${fieldRef} eq ${serializePart(v)}`).join(' or ')})`;
  } else expr = `${fieldRef} ${operator} '${escaped}'`;
  return level === 'line' ? `PurchaseOrderLines/any(l: ${expr})` : expr;
}

// Bepaalt het waardetype van een regel op basis van de gekozen kolom.
export function valueTypeForColumn(column) {
  if (column?.d365Field && ENUM_FIELDS[column.d365Field]) return 'enum';
  if (column?.dataType === 'date') return 'date';
  if (column?.dataType === 'number') return 'number';
  return 'text';
}

/**
 * Beheert de gestructureerde D365-syncfilterregels (admin): lokale bewerking,
 * live OData-preview en opslaan via PUT /purchase-orders/sync-filters.
 *
 * Input: initialRules (uit het datamodel-endpoint)
 * Output: { rules, preview, addRule, updateRule, removeRule, save, saving, error, savedAt }
 */
export function useSyncFilters(initialRules, tableKey = 'purchase-orders') {
  const [rules, setRules] = useState(() => (Array.isArray(initialRules) ? initialRules : []));
  const tableSyncBase = syncBase(tableKey);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState(null);
  const [queryCount, setQueryCount] = useState(null);
  const [countLoading, setCountLoading] = useState(false);
  const [countError, setCountError] = useState('');

  useEffect(() => {
    setRules(Array.isArray(initialRules) ? initialRules : []);
  }, [initialRules]);

  const addRule = useCallback((defaults) => {
    setRules((prev) => [...prev, { level: 'header', field: '', operator: 'eq', value: '', valueType: 'text', ...defaults }]);
    setSavedAt(null);
  }, []);

  const updateRule = useCallback((index, patch) => {
    setRules((prev) => prev.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
    setSavedAt(null);
  }, []);

  const removeRule = useCallback((index) => {
    setRules((prev) => prev.filter((_, i) => i !== index));
    setSavedAt(null);
  }, []);

  const applyRules = useCallback((nextRules) => {
    setRules(Array.isArray(nextRules) ? nextRules : []);
    setSavedAt(null);
  }, []);

  const resetRules = useCallback(() => {
    setRules([]);
    setSavedAt(null);
    setQueryCount(null);
    setCountError('');
  }, []);

  const countRows = useCallback(async (overrideRules) => {
    const rulesToCount = Array.isArray(overrideRules) ? overrideRules : rules;
    setCountLoading(true);
    setCountError('');
    try {
      const data = await apiRequest(`${tableSyncBase}/sync-filters/count`, {
        method: 'POST',
        body: { rules: rulesToCount },
      });
      setQueryCount(Number(data?.total) || 0);
      return Number(data?.total) || 0;
    } catch (err) {
      setCountError(err.message);
      return null;
    } finally {
      setCountLoading(false);
    }
  }, [rules, tableSyncBase]);

  const preview = useMemo(
    () => rules.map(previewRule).filter(Boolean).join(' and '),
    [rules]
  );

  const save = useCallback(async () => {
    setSaving(true);
    setError('');
    try {
      await apiRequest(`${tableSyncBase}/sync-filters`, { method: 'PUT', body: { rules } });
      setSavedAt(new Date());
      await countRows(rules);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }, [rules, tableSyncBase, countRows]);

  return useMemo(() => ({
    rules,
    preview,
    addRule,
    updateRule,
    removeRule,
    applyRules,
    resetRules,
    countRows,
    save,
    saving,
    error,
    savedAt,
    queryCount,
    countLoading,
    countError,
  }), [rules, preview, addRule, updateRule, removeRule, applyRules, resetRules, countRows, save, saving, error, savedAt, queryCount, countLoading, countError]);
}
