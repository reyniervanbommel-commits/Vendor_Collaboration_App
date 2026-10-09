import { useEffect, useMemo, useState } from 'react';
import { getDraftFromFilter, getDraftsFromFilter } from '../components/supplier/purchaseOrderColumnFilterMenuConstants';

/**
 * Drafts voor meerdere AND-voorwaarden in het kolomfiltermenu.
 * @returns {{ drafts: object[], setDrafts: Function, emptyDraft: object }}
 */
export function useColumnFilterMenuDrafts(column, filter, datePeriodFilterModes, open) {
  const [drafts, setDrafts] = useState(() => getDraftsFromFilter(column, filter, datePeriodFilterModes));
  const emptyDraft = useMemo(
    () => getDraftFromFilter(column, null, datePeriodFilterModes),
    [column, datePeriodFilterModes]
  );

  useEffect(() => {
    if (open) setDrafts(getDraftsFromFilter(column, filter, datePeriodFilterModes));
  }, [open, column, filter, datePeriodFilterModes]);

  return { drafts, setDrafts, emptyDraft };
}
