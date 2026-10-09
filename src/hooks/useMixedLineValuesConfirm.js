import { useCallback, useMemo, useRef, useState } from 'react';
import { buildMixedValuesMessage, findOrdersWithMixedValues } from '../utils/mixedLineValues';

const CLOSED = { open: false, message: '' };

/**
 * Bevestiging vóór een header-fan-out die afwijkende regelwaarden overschrijft.
 * Resolvet direct true als geen enkele order afwijkende waarden heeft.
 */
export function useMixedLineValuesConfirm() {
  const resolverRef = useRef(null);
  const [state, setState] = useState(CLOSED);

  const settle = useCallback((confirmed) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setState(CLOSED);
    resolve?.(confirmed);
  }, []);

  const confirmMixedLineValues = useCallback(({ rows, headerColumnKey, value }) => {
    const list = Array.isArray(rows) ? rows : [];
    const mixedRows = findOrdersWithMixedValues(list, headerColumnKey);
    if (!mixedRows.length) return Promise.resolve(true);
    return new Promise((resolve) => {
      resolverRef.current?.(false);
      resolverRef.current = resolve;
      setState({
        open: true,
        message: buildMixedValuesMessage({ rows: list, mixedRows, headerColumnKey, value }),
      });
    });
  }, []);

  const mixedConfirmActions = useMemo(() => ({
    onConfirm: () => settle(true),
    onCancel: () => settle(false),
  }), [settle]);

  return { confirmMixedLineValues, mixedConfirmState: state, mixedConfirmActions };
}
