import React, { useCallback } from 'react';
import { Button, Text } from '@fluentui/react-components';

function stringifyChipValue(value) {
  if (Array.isArray(value)) return value.join(', ');
  return String(value ?? '').trim();
}

function FilterConditionChip({
  styles,
  draft,
  index,
  selected,
  operatorLabels,
  onSelect,
}) {
  const handleSelect = useCallback(() => {
    onSelect(index);
  }, [index, onSelect]);
  const operator = operatorLabels[draft.operator] || draft.operator;
  const value = stringifyChipValue(draft.value);
  const secondary = stringifyChipValue(draft.secondaryValue);
  const label = secondary ? `${operator} ${value} – ${secondary}` : (value ? `${operator} ${value}` : operator);

  return (
    <Button
      className={selected ? styles.filterChipSelected : styles.filterChip}
      appearance="transparent"
      size="small"
      aria-pressed={selected}
      aria-label={`Edit condition ${index + 1}: ${label}`}
      onClick={handleSelect}
    >
      <span className={styles.filterChipOperator}>{operator}</span>
      {value ? <span className={styles.filterChipValue}>{value}</span> : null}
      {secondary ? <span className={styles.filterChipValue}>{secondary}</span> : null}
    </Button>
  );
}

export function draftLooksCommitted(draft) {
  if (!draft) return false;
  if (draft.operator === 'hasComment' || draft.operator === 'nextWeek') return true;
  if (Array.isArray(draft.value)) return draft.value.length > 0;
  if (draft.operator === 'between') {
    return Boolean(String(draft.value ?? '').trim() && String(draft.secondaryValue ?? '').trim());
  }
  return Boolean(String(draft.value ?? '').trim());
}

export default function PurchaseOrderColumnFilterConditionChips({
  styles,
  drafts,
  editingIndex,
  operatorLabels,
  onSelect,
  visible = false,
}) {
  if (!visible || !Array.isArray(drafts) || !drafts.some(draftLooksCommitted)) return null;
  return (
    <div className={styles.filterChipRow} role="list" aria-label="Active conditions">
      {drafts
        .map((draft, index) => ({ draft, index }))
        .filter((entry) => draftLooksCommitted(entry.draft))
        .map((entry, displayIndex) => (
          <span key={`chip-${entry.index}`} className={styles.filterChipWrap} role="listitem">
            {displayIndex > 0 ? <Text className={styles.filterAndLabel}>and</Text> : null}
            <FilterConditionChip
              styles={styles}
              draft={entry.draft}
              index={entry.index}
              selected={entry.index === editingIndex}
              operatorLabels={operatorLabels}
              onSelect={onSelect}
            />
          </span>
        ))}
    </div>
  );
}
