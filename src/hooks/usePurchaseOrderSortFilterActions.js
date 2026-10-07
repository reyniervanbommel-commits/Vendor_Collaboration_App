import { startTransition, useCallback } from 'react';
import { MAX_COLUMN_FILTER_RULES } from '../utils/columnFilterState';
import { isRemarksFilterOperatorReady } from '../utils/tableViewFilterUtils';

function persistDraftValues(columnKey, draft, onSetValue, onSetSecondaryValue) {
  onSetValue(columnKey, draft.value);
  if (draft.operator === 'between') {
    onSetSecondaryValue(columnKey, draft.secondaryValue);
  } else {
    onSetSecondaryValue(columnKey, '');
  }
}

export function usePurchaseOrderSortFilterActions({
  columnKey,
  draft,
  onSetSortDirection,
  onSetOperator,
  onSetValue,
  onSetSecondaryValue,
  onApplyFilter,
  onClearFilter,
  setDraft,
  drafts,
  setDrafts,
  emptyDraft,
  setOpen,
  columnDataType,
}) {
  const isMulti = Array.isArray(drafts) && typeof setDrafts === 'function';
  const setSortAsc = useCallback(() => {
    onSetSortDirection(columnKey, 'asc');
    setOpen(false);
  }, [columnKey, onSetSortDirection, setOpen]);

  const setSortDesc = useCallback(() => {
    onSetSortDirection(columnKey, 'desc');
    setOpen(false);
  }, [columnKey, onSetSortDirection, setOpen]);

  const clearSort = useCallback(() => {
    onSetSortDirection('', 'none');
    setOpen(false);
  }, [onSetSortDirection, setOpen]);

  const handleOperatorSelect = useCallback((_, data) => {
    if (!data.optionValue) return;
    const nextOperator = data.optionValue;
    setDraft((prev) => ({ ...prev, operator: nextOperator }));
  }, [setDraft]);

  const handleValueChange = useCallback((event) => {
    const nextValue = event.target.value;
    setDraft((prev) => ({ ...prev, value: nextValue }));
  }, [setDraft]);

  const handleDraftValueChange = useCallback((nextValue) => {
    setDraft((prev) => ({ ...prev, value: nextValue }));
  }, [setDraft]);

  const handleSecondaryValueChange = useCallback((event) => {
    const nextValue = event.target.value;
    setDraft((prev) => ({ ...prev, secondaryValue: nextValue }));
  }, [setDraft]);

  const handleApplyFilter = useCallback(() => {
    if (!draft) return;
    if (columnDataType === 'remarks' && !isRemarksFilterOperatorReady(draft.operator, draft.value)) return;
    const isHasComment = columnDataType === 'remarks' && draft.operator === 'hasComment';
    const patch = {
      operator: draft.operator,
      value: isHasComment ? '' : draft.value,
      secondaryValue: isHasComment ? '' : draft.secondaryValue,
    };
    startTransition(() => {
      if (typeof onApplyFilter === 'function') {
        onApplyFilter(columnKey, patch);
      } else {
        onSetOperator(columnKey, draft.operator);
        persistDraftValues(
          columnKey,
          isHasComment ? { ...draft, value: '', secondaryValue: '' } : draft,
          onSetValue,
          onSetSecondaryValue
        );
      }
    });
  }, [columnDataType, columnKey, draft, onApplyFilter, onSetOperator, onSetSecondaryValue, onSetValue]);

  // Gebruikt voor auto-apply vanuit de value picker na een suggestie-klik.
  // Neemt de nieuwe waarde direct mee zodat de draft-closure niet stale is.
  // Sluit de popover NIET — de gebruiker moet het menu kunnen blijven gebruiken.
  const handleApplyFilterWithValue = useCallback((explicitValue) => {
    if (!draft) return;
    const patch = {
      operator: draft.operator,
      value: explicitValue,
      secondaryValue: draft.secondaryValue,
    };
    startTransition(() => {
      if (typeof onApplyFilter === 'function') {
        onApplyFilter(columnKey, patch);
      } else {
        onSetOperator(columnKey, draft.operator);
        onSetValue(columnKey, explicitValue);
        onSetSecondaryValue(columnKey, '');
      }
    });
  }, [columnKey, draft?.operator, draft?.secondaryValue, onApplyFilter, onSetOperator, onSetSecondaryValue, onSetValue]);

  // Sluit de popover NIET na clear — de gebruiker blijft in het menu.
  const handleClearFilter = useCallback(() => {
    onClearFilter(columnKey);
    if (isMulti) setDrafts([emptyDraft || { operator: 'contains', value: '', secondaryValue: '' }]);
  }, [columnKey, emptyDraft, isMulti, onClearFilter, setDrafts]);

  const updateDraftAt = useCallback((index, patch) => {
    setDrafts((prev) => prev.map((entry, entryIndex) => (
      entryIndex === index ? { ...entry, ...patch } : entry
    )));
  }, [setDrafts]);

  const handleRuleOperatorSelect = useCallback((index, _, data) => {
    if (!data.optionValue) return;
    updateDraftAt(index, { operator: data.optionValue });
  }, [updateDraftAt]);

  const handleRuleValueChange = useCallback((index, event) => {
    updateDraftAt(index, { value: event.target.value });
  }, [updateDraftAt]);

  const handleRuleDraftValueChange = useCallback((index, nextValue) => {
    updateDraftAt(index, { value: nextValue });
  }, [updateDraftAt]);

  const handleRuleSecondaryValueChange = useCallback((index, event) => {
    updateDraftAt(index, { secondaryValue: event.target.value });
  }, [updateDraftAt]);

  const applyDraftList = useCallback((list) => {
    const rules = list.map((entry) => {
      const isHasComment = columnDataType === 'remarks' && entry.operator === 'hasComment';
      return {
        operator: entry.operator,
        value: isHasComment ? '' : entry.value,
        secondaryValue: isHasComment ? '' : entry.secondaryValue,
      };
    });
    if (columnDataType === 'remarks' && rules.some((rule) => !isRemarksFilterOperatorReady(rule.operator, rule.value))) {
      return false;
    }
    startTransition(() => {
      onApplyFilter(columnKey, rules.length === 1 ? rules[0] : { rules });
    });
    return true;
  }, [columnDataType, columnKey, onApplyFilter]);

  const handleApplyAllFilters = useCallback(() => {
    if (!isMulti) return;
    applyDraftList(drafts);
  }, [applyDraftList, drafts, isMulti]);

  const handleApplyFilterWithValueAt = useCallback((index, explicitValue) => {
    if (!isMulti) return;
    const nextDrafts = drafts.map((entry, entryIndex) => (
      entryIndex === index ? { ...entry, value: explicitValue } : entry
    ));
    setDrafts(nextDrafts);
    applyDraftList(nextDrafts);
  }, [applyDraftList, drafts, isMulti, setDrafts]);

  const handleAddCondition = useCallback(() => {
    if (!isMulti || drafts.length >= MAX_COLUMN_FILTER_RULES) return;
    setDrafts((prev) => [...prev, emptyDraft || { operator: 'contains', value: '', secondaryValue: '' }]);
  }, [drafts, emptyDraft, isMulti, setDrafts]);

  const handleRemoveCondition = useCallback((index) => {
    if (!isMulti) return;
    setDrafts((prev) => {
      const next = prev.filter((_, entryIndex) => entryIndex !== index);
      return next.length ? next : [emptyDraft || { operator: 'contains', value: '', secondaryValue: '' }];
    });
  }, [emptyDraft, isMulti, setDrafts]);

  return {
    setSortAsc,
    setSortDesc,
    clearSort,
    handleOperatorSelect,
    handleValueChange,
    handleDraftValueChange,
    handleSecondaryValueChange,
    handleApplyFilter,
    handleApplyFilterWithValue,
    handleClearFilter,
    handleRuleOperatorSelect,
    handleRuleValueChange,
    handleRuleDraftValueChange,
    handleRuleSecondaryValueChange,
    handleApplyAllFilters,
    handleApplyFilterWithValueAt,
    handleAddCondition,
    handleRemoveCondition,
  };
}
