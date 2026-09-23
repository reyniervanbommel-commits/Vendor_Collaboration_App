import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../utils/api';
import { BOARD_TB_SOURCE } from '../config/featureFlags';
import { mergeDiscoverySamples } from '../components/admin/datamodel/entityConfigTableUtils';

// Board-cutover Fase 5/6 (#AB:174/#175): de admin-datamodel-pagina draait onder BOARD_TB_SOURCE op de
// generieke tb_*-laag (/api/data/purchase-orders/...). De tb_-kolomrespons wordt naar de admin-vorm
// (level/d365) gemapt zoals de po_-endpoints die leverden; het /datamodel-endpoint levert dat al gemapt.
const adminBase = (tableKey) => (BOARD_TB_SOURCE ? `/data/${tableKey}` : '/purchase-orders');
const NON_WRITABLE_KEYS = {
  header: new Set(['orderNumber', 'status', 'createdDateTime']),
  line: new Set(['lineNumber']),
};
const NON_HIDEABLE_KEYS = {
  header: new Set(['orderNumber']),
  line: new Set(['lineNumber']),
};

function normalizeLevel(col) {
  if (col.level === 'line' || col.level === 'header') return col.level;
  return col.scope === 'detail' ? 'line' : 'header';
}

function resolveWriteBackAllowed(column) {
  if (typeof column.writeBackAllowed === 'boolean') return column.writeBackAllowed;
  if (column.source !== 'd365' || !column.d365Field) return false;
  return !(NON_WRITABLE_KEYS[column.level] || new Set()).has(column.key);
}

function resolveHideAllowed(column) {
  if (typeof column.hideAllowed === 'boolean') return column.hideAllowed;
  return !(NON_HIDEABLE_KEYS[column.level] || new Set()).has(column.key);
}

// Kolommen die nooit door een vendor bewerkt mogen worden, ongeacht de instelling: sleutel- en
// systeemvelden (los van D365 write-back — dit geldt óók voor custom kolommen).
const NON_VENDOR_EDITABLE_KEYS = {
  header: new Set(['orderNumber', 'status', 'createdDateTime']),
  line: new Set(['lineNumber']),
};

function resolveVendorEditableAllowed(column) {
  if (typeof column.vendorEditableAllowed === 'boolean') return column.vendorEditableAllowed;
  if (['remarks', 'image', 'date_period'].includes(column.dataType)) return false;
  if (column.formulaExpr) return false;
  return !(NON_VENDOR_EDITABLE_KEYS[column.level] || new Set()).has(column.key);
}

function mapAdminColumn(col) {
  if (!col || !BOARD_TB_SOURCE) return col;
  const source = col.source === 'source' ? 'd365' : col.source;
  const level = normalizeLevel(col);
  const mappedColumn = {
    ...col,
    level,
    source,
    d365Field: col.sourceField ?? col.d365Field ?? null,
    writableToD365: Boolean(col.writable ?? col.writableToD365),
    vendorEditable: Boolean(col.vendorEditable),
  };
  return {
    ...mappedColumn,
    writeBackAllowed: resolveWriteBackAllowed(mappedColumn),
    hideAllowed: resolveHideAllowed(mappedColumn),
    vendorEditableAllowed: resolveVendorEditableAllowed(mappedColumn),
  };
}

function mapDataModelPayload(payload) {
  if (!payload || !BOARD_TB_SOURCE) return payload;
  const mapped = {
    ...payload,
    columns: {
      header: Array.isArray(payload.columns?.header) ? payload.columns.header.map(mapAdminColumn) : [],
      line: Array.isArray(payload.columns?.line) ? payload.columns.line.map(mapAdminColumn) : [],
    },
  };
  if (payload.discovery?.sampleByField && payload.previewTables) {
    mapped.previewTables = mergeDiscoverySamples(payload.previewTables, payload.discovery.sampleByField);
  }
  return mapped;
}

/**
 * Admin-datamodel voor het PO-scherm: laadt entiteiten, relatie, kolommen
 * (inclusief verborgen) en cache-statistieken; levert toggles voor
 * kolom-zichtbaarheid, write-back en vendor-editrechten.
 *
 * Output: { entities, relation, connection, columns, cache, loading, error,
 *           togglingKey, reload, toggleVisibility, toggleWriteback,
 *           toggleVendorEditable, setColumnToggleState, deleteColumn }
 */
export function useDataModelAdmin(tableKey = 'purchase-orders') {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Kolom-id waarvan een toggle bezig is (voorkomt dubbelklikken en toont spinner).
  const [togglingKey, setTogglingKey] = useState(null);
  const adminBasePath = adminBase(tableKey);

  const reload = useCallback(async () => {
    setError('');
    try {
      const result = await apiRequest(`${adminBasePath}/datamodel`);
      setData(mapDataModelPayload(result));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [adminBasePath]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Vervangt één kolom in de state na een geslaagde PATCH (geen volledige reload nodig).
  const applyColumnUpdate = useCallback((column) => {
    setData((prev) => {
      if (!prev) return prev;
      const level = column.level;
      const list = (prev.columns?.[level] || []).map((c) => (c.id === column.id ? column : c));
      return { ...prev, columns: { ...prev.columns, [level]: list } };
    });
  }, []);

  const applyColumnUpdates = useCallback((updatedColumns) => {
    if (!Array.isArray(updatedColumns) || !updatedColumns.length) return;
    setData((prev) => {
      if (!prev) return prev;
      const updatesByLevel = updatedColumns.reduce((acc, column) => {
        if (!column?.id || !column?.level) return acc;
        const levelUpdates = acc.get(column.level) || new Map();
        levelUpdates.set(column.id, column);
        acc.set(column.level, levelUpdates);
        return acc;
      }, new Map());
      if (!updatesByLevel.size) return prev;

      const nextColumns = { ...prev.columns };
      updatesByLevel.forEach((levelUpdates, level) => {
        nextColumns[level] = (prev.columns?.[level] || []).map((column) => (
          levelUpdates.get(column.id) || column
        ));
      });

      return { ...prev, columns: nextColumns };
    });
  }, []);

  const removeColumnFromState = useCallback((column) => {
    setData((prev) => {
      if (!prev) return prev;
      const level = column.level;
      const list = (prev.columns?.[level] || []).filter((c) => c.id !== column.id);
      return { ...prev, columns: { ...prev.columns, [level]: list } };
    });
  }, []);

  const toggleVisibility = useCallback(async (column) => {
    setTogglingKey(`vis-${column.id}`);
    setError('');
    try {
      const result = await apiRequest(`${adminBasePath}/columns/${column.id}/visibility`, {
        method: 'PATCH',
        body: { visible: !column.isActive },
      });
      applyColumnUpdate(mapAdminColumn(result.column));
    } catch (err) {
      setError(err.message);
    } finally {
      setTogglingKey(null);
    }
  }, [adminBasePath, applyColumnUpdate]);

  const toggleVisibleAtDelete = useCallback(async (column) => {
    setTogglingKey(`vad-${column.id}`);
    setError('');
    try {
      const result = await apiRequest(`${adminBasePath}/columns/${column.id}/visible-at-delete`, {
        method: 'PATCH',
        body: { visible: !column.visibleAtDelete },
      });
      applyColumnUpdate(mapAdminColumn(result.column));
    } catch (err) {
      setError(err.message);
    } finally {
      setTogglingKey(null);
    }
  }, [adminBasePath, applyColumnUpdate]);

  const toggleWriteback = useCallback(async (column) => {
    setTogglingKey(`wb-${column.id}`);
    setError('');
    try {
      const result = await apiRequest(`${adminBasePath}/columns/${column.id}/writeback`, {
        method: 'PATCH',
        body: { writable: !column.writableToD365, mechanism: 'patch' },
      });
      applyColumnUpdate(mapAdminColumn(result.column));
    } catch (err) {
      setError(err.message);
    } finally {
      setTogglingKey(null);
    }
  }, [adminBasePath, applyColumnUpdate]);

  const toggleVendorEditable = useCallback(async (column) => {
    setTogglingKey(`ve-${column.id}`);
    setError('');
    try {
      const result = await apiRequest(`${adminBasePath}/columns/${column.id}/vendor-editable`, {
        method: 'PATCH',
        body: { editable: !column.vendorEditable },
      });
      applyColumnUpdate(mapAdminColumn(result.column));
    } catch (err) {
      setError(err.message);
    } finally {
      setTogglingKey(null);
    }
  }, [adminBasePath, applyColumnUpdate]);

  const setColumnToggleState = useCallback(async ({ columns: scopedColumns = [], toggleType, enabled }) => {
    if (!Array.isArray(scopedColumns) || !toggleType) return;
    const shouldEnable = Boolean(enabled);

    const eligibleColumns = scopedColumns.filter((column) => {
      if (toggleType === 'visibility') return column.hideAllowed && column.isActive !== shouldEnable;
      if (toggleType === 'visibleAtDelete') return column.visibleAtDelete !== shouldEnable;
      if (toggleType === 'writeback') return column.writeBackAllowed && column.writableToD365 !== shouldEnable;
      if (toggleType === 'vendorEditable') return column.vendorEditableAllowed && column.vendorEditable !== shouldEnable;
      return false;
    });

    if (!eligibleColumns.length) return;

    setTogglingKey(`bulk-${toggleType}-${shouldEnable ? 'on' : 'off'}`);
    setError('');
    try {
      const updates = await Promise.allSettled(eligibleColumns.map(async (column) => {
        if (toggleType === 'visibility') {
          const result = await apiRequest(`${adminBasePath}/columns/${column.id}/visibility`, {
            method: 'PATCH',
            body: { visible: shouldEnable },
          });
          return mapAdminColumn(result.column);
        }
        if (toggleType === 'visibleAtDelete') {
          const result = await apiRequest(`${adminBasePath}/columns/${column.id}/visible-at-delete`, {
            method: 'PATCH',
            body: { visible: shouldEnable },
          });
          return mapAdminColumn(result.column);
        }
        if (toggleType === 'vendorEditable') {
          const result = await apiRequest(`${adminBasePath}/columns/${column.id}/vendor-editable`, {
            method: 'PATCH',
            body: { editable: shouldEnable },
          });
          return mapAdminColumn(result.column);
        }
        const result = await apiRequest(`${adminBasePath}/columns/${column.id}/writeback`, {
          method: 'PATCH',
          body: { writable: shouldEnable, mechanism: 'patch' },
        });
        return mapAdminColumn(result.column);
      }));

      const successfulUpdates = [];
      let failedCount = 0;
      let firstErrorMessage = '';
      updates.forEach((entry) => {
        if (entry.status === 'fulfilled' && entry.value) {
          successfulUpdates.push(entry.value);
          return;
        }
        failedCount += 1;
        if (!firstErrorMessage) firstErrorMessage = entry.reason?.message || 'Unknown error';
      });

      if (successfulUpdates.length) {
        applyColumnUpdates(successfulUpdates);
      }
      if (failedCount) {
        const label = failedCount === 1 ? 'column' : 'columns';
        setError(`Bulk update failed for ${failedCount} ${label}. ${firstErrorMessage}`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setTogglingKey(null);
    }
  }, [adminBasePath, applyColumnUpdates]);

  const deleteColumn = useCallback(async (column) => {
    if (!column?.id || column.source !== 'custom') return;
    setTogglingKey(`del-${column.id}`);
    setError('');
    try {
      await apiRequest(`${adminBasePath}/columns/${column.id}`, {
        method: 'DELETE',
      });
      removeColumnFromState(column);
    } catch (err) {
      setError(err.message);
    } finally {
      setTogglingKey(null);
    }
  }, [adminBasePath, removeColumnFromState]);

  const syncNow = useCallback(async () => {
    setTogglingKey('sync-now');
    setError('');
    try {
      await apiRequest(`${adminBasePath}/refresh/start`, { method: 'POST' });
      // Poll voortgang tot de sync klaar is (max. 3 minuten, elke 2 seconden).
      const maxAttempts = 90;
      let lookupWarnings = null;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const { running, progress } = await apiRequest(`${adminBasePath}/refresh/progress`);
        if (!running) {
          lookupWarnings = progress?.lookupWarnings?.length ? progress.lookupWarnings : null;
          break;
        }
      }
      // reload() begint zelf met setError('') — de lookup-waarschuwing pas ná de reload zetten,
      // anders wordt hij door die reset meteen weer overschreven en ziet de gebruiker 'm nooit.
      await reload();
      if (lookupWarnings) {
        setError(`Sync voltooid, maar sommige gekoppelde tabellen konden niet ververst worden: ${lookupWarnings.join('; ')}`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setTogglingKey(null);
    }
  }, [adminBasePath, reload]);

  // Nulmeting: alles opnieuw ophalen zonder het als wijzigingen te loggen. Bedoeld na een
  // datamodel-wijziging; anders zou het bord elke rij als "nieuw" markeren.
  const reimportBaseline = useCallback(async () => {
    setTogglingKey('baseline-import');
    setError('');
    try {
      await apiRequest(`${adminBasePath}/refresh`, { method: 'POST', body: { baseline: true } });
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setTogglingKey(null);
    }
  }, [adminBasePath, reload]);

  const discoverFields = useCallback(async () => {
    setTogglingKey('discover-fields');
    setError('');
    try {
      const discovery = await apiRequest(`${adminBasePath}/discover-fields`, { method: 'POST' });
      const result = await apiRequest(`${adminBasePath}/datamodel`);
      setData(mapDataModelPayload({ ...result, discovery }));
    } catch (err) {
      setError(err.message);
    } finally {
      setTogglingKey(null);
    }
  }, [adminBasePath]);

  return useMemo(() => ({
    entities: data?.entities || [],
    relation: data?.relation || null,
    connection: data?.connection || null,
    columns: data?.columns || { header: [], line: [] },
    cache: data?.cache || null,
    syncFilter: data?.syncFilter || null,
    filterCatalog: data?.filterCatalog || { header: [], line: [] },
    previewTables: data?.previewTables || null,
    lookups: data?.lookups || [],
    discovery: data?.discovery || null,
    loading,
    error,
    togglingKey,
    reload,
    syncNow,
    reimportBaseline,
    discoverFields,
    toggleVisibility,
    toggleVisibleAtDelete,
    toggleWriteback,
    toggleVendorEditable,
    setColumnToggleState,
    deleteColumn,
  }), [data, loading, error, togglingKey, reload, syncNow, reimportBaseline, discoverFields, toggleVisibility, toggleVisibleAtDelete, toggleWriteback, toggleVendorEditable, setColumnToggleState, deleteColumn]);
}
