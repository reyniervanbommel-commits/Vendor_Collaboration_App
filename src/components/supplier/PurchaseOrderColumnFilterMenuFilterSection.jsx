import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Text } from '@fluentui/react-components';
import { AddRegular } from '@fluentui/react-icons';
import { MAX_COLUMN_FILTER_RULES } from '../../utils/columnFilterState';
import PurchaseOrderColumnFilterMenuButton from './PurchaseOrderColumnFilterMenuButton';
import PurchaseOrderColumnFilterRuleRow from './PurchaseOrderColumnFilterRuleRow';
import PurchaseOrderColumnFilterConditionChips, {
  draftLooksCommitted,
} from './PurchaseOrderColumnFilterConditionChips';

export default function PurchaseOrderColumnFilterMenuFilterSection({
  styles,
  column,
  columnLabel,
  closeSubmenu,
  isDate,
  isNumber,
  drafts,
  draft,
  operatorLabels,
  operatorEntries,
  handleRuleOperatorSelect,
  handleRuleValueChange,
  handleRuleDraftValueChange,
  handleApplyFilterWithValueAt,
  uniqueColumnValues = [],
  handleRuleSecondaryValueChange,
  handleApplyAllFilters,
  handleApplyFilter,
  handleClearFilter,
  handleAddCondition,
  handleRemoveCondition,
  onMouseEnter,
  searchHint = '',
}) {
  const rules = Array.isArray(drafts) && drafts.length ? drafts : (draft ? [draft] : []);
  const canAdd = Boolean(handleAddCondition) && rules.length < MAX_COLUMN_FILTER_RULES;
  const applyHandler = handleApplyAllFilters || handleApplyFilter;
  const [editingIndex, setEditingIndex] = useState(0);
  const [chipsVisible, setChipsVisible] = useState(() => rules.some(draftLooksCommitted));
  const previousCount = useRef(rules.length);

  useEffect(() => {
    if (rules.length > previousCount.current) {
      setEditingIndex(rules.length - 1);
    } else if (editingIndex >= rules.length) {
      setEditingIndex(Math.max(0, rules.length - 1));
    }
    previousCount.current = rules.length;
  }, [editingIndex, rules.length]);

  const handleFilterRowMouseEnter = useCallback(() => {
    onMouseEnter?.();
  }, [onMouseEnter]);

  const handleApplyClick = useCallback(() => {
    applyHandler?.();
    setChipsVisible(true);
    setEditingIndex(0);
  }, [applyHandler]);

  const handleClearClick = useCallback(() => {
    handleClearFilter?.();
    setChipsVisible(false);
    setEditingIndex(0);
  }, [handleClearFilter]);

  const activeDraft = rules[editingIndex] || rules[0];
  const showRemove = rules.length > 1;

  return (
    <div className={styles.filterBlock} onMouseEnter={handleFilterRowMouseEnter}>
      <Text className={styles.filterSectionLabel}>Filter</Text>
      <PurchaseOrderColumnFilterConditionChips
        styles={styles}
        drafts={rules}
        editingIndex={editingIndex}
        operatorLabels={operatorLabels}
        onSelect={setEditingIndex}
        visible={chipsVisible}
      />
      {activeDraft ? (
        <PurchaseOrderColumnFilterRuleRow
          styles={styles}
          column={column}
          columnLabel={columnLabel}
          isDate={isDate}
          isNumber={isNumber}
          draft={activeDraft}
          ruleIndex={editingIndex}
          canRemove={showRemove}
          operatorLabels={operatorLabels}
          operatorEntries={operatorEntries}
          onOperatorSelect={handleRuleOperatorSelect}
          onValueChange={handleRuleValueChange}
          onDraftValueChange={handleRuleDraftValueChange}
          onApplyFilterWithValue={handleApplyFilterWithValueAt}
          uniqueColumnValues={uniqueColumnValues}
          onSecondaryValueChange={handleRuleSecondaryValueChange}
          onRemove={handleRemoveCondition}
        />
      ) : null}
      {searchHint ? (
        <Text className={styles.filterHint}>{searchHint}</Text>
      ) : null}
      <div className={styles.filterActionRow}>
        <PurchaseOrderColumnFilterMenuButton
          className={styles.filterApplyButton}
          size="extra-small"
          appearance="primary"
          closeSubmenu={closeSubmenu}
          onClick={handleApplyClick}
        >
          Apply
        </PurchaseOrderColumnFilterMenuButton>
        <PurchaseOrderColumnFilterMenuButton
          className={styles.filterClearButton}
          size="extra-small"
          appearance="outline"
          closeSubmenu={closeSubmenu}
          onClick={handleClearClick}
        >
          Clear
        </PurchaseOrderColumnFilterMenuButton>
      </div>
      {canAdd ? (
        <Button
          className={styles.filterAddConditionButton}
          appearance="transparent"
          size="small"
          icon={<AddRegular className={styles.filterAddConditionIcon} />}
          onClick={handleAddCondition}
        >
          Add condition
        </Button>
      ) : null}
    </div>
  );
}
