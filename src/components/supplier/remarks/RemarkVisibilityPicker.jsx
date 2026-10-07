import React, { memo, useCallback } from 'react';
import { Radio, RadioGroup } from '@fluentui/react-components';
import { EyeRegular, LockClosedRegular } from '@fluentui/react-icons';

const OPTIONS = [
  { value: 'all', label: 'All', Icon: null },
  { value: 'vendor', label: 'Vendor', Icon: EyeRegular },
  { value: 'internal', label: 'Internal', Icon: LockClosedRegular },
];

/**
 * Weergave- én schrijfkeuze voor admin/supply_chain: Vendor/Internal filteren de remarks en
 * bepalen de zichtbaarheid van een nieuwe remark; All toont alles en laat geen post toe.
 */
function RemarkVisibilityPicker({ value, onChange, disabled = false }) {
  const handleChange = useCallback((_, data) => onChange(data.value), [onChange]);

  return (
    <RadioGroup
      className="remark-visibility-picker"
      layout="horizontal"
      aria-label="Show remarks"
      value={value}
      disabled={disabled}
      onChange={handleChange}
    >
      {OPTIONS.map(({ value: optionValue, label, Icon }) => (
        <Radio
          key={optionValue}
          value={optionValue}
          label={(
            <span className="remark-visibility-option">
              {Icon ? <Icon aria-hidden="true" /> : null}
              {label}
            </span>
          )}
        />
      ))}
    </RadioGroup>
  );
}

export default memo(RemarkVisibilityPicker);
