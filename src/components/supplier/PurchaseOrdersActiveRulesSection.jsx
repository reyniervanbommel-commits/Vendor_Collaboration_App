import React, { memo, useCallback } from 'react';
import {
  Button,
  Text,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import {
  ChevronDown20Regular,
  ChevronRight20Regular,
} from '@fluentui/react-icons';

const EMPTY_ITEMS = [];

function FilterSummaryPart({ part, styles }) {
  const className = part.type === 'value'
    ? styles.summaryValue
    : part.type === 'and'
      ? styles.summaryAnd
      : styles.summaryOperator;
  return <span className={className}>{part.text}</span>;
}

const useStyles = makeStyles({
  section: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap(tokens.spacingVerticalS),
  },
  group: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap(tokens.spacingVerticalXS),
  },
  table: {
    width: '100%',
    borderCollapse: 'separate',
    borderSpacing: `0 ${tokens.spacingVerticalXS}`,
  },
  cell: {
    verticalAlign: 'middle',
    backgroundColor: tokens.colorNeutralBackground1,
    ...shorthands.borderTop('1px', 'solid', tokens.colorNeutralStroke2),
    ...shorthands.borderBottom('1px', 'solid', tokens.colorNeutralStroke2),
    ...shorthands.padding(tokens.spacingVerticalS, tokens.spacingHorizontalXS),
  },
  cellFirst: {
    ...shorthands.borderLeft('1px', 'solid', tokens.colorNeutralStroke2),
    borderTopLeftRadius: tokens.borderRadiusMedium,
    borderBottomLeftRadius: tokens.borderRadiusMedium,
    ...shorthands.padding(tokens.spacingVerticalS, tokens.spacingHorizontalS),
    width: '1%',
  },
  cellLast: {
    ...shorthands.borderRight('1px', 'solid', tokens.colorNeutralStroke2),
    borderTopRightRadius: tokens.borderRadiusMedium,
    borderBottomRightRadius: tokens.borderRadiusMedium,
    ...shorthands.padding(tokens.spacingVerticalS, tokens.spacingHorizontalS),
    width: '1%',
    textAlign: 'right',
  },
  cellName: {
    width: '42%',
  },
  cellOperator: {
    width: '8.75rem',
    whiteSpace: 'nowrap',
    ...shorthands.padding(tokens.spacingVerticalS, tokens.spacingHorizontalM),
  },
  cellValue: {
    width: 'auto',
    ...shorthands.padding(tokens.spacingVerticalS, tokens.spacingHorizontalS),
  },
  cellEditor: {
    ...shorthands.borderLeft('1px', 'solid', tokens.colorNeutralStroke2),
    ...shorthands.borderRight('1px', 'solid', tokens.colorNeutralStroke2),
    borderBottomLeftRadius: tokens.borderRadiusMedium,
    borderBottomRightRadius: tokens.borderRadiusMedium,
  },
  summaryOperators: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    ...shorthands.gap('4px'),
  },
  summaryValues: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    ...shorthands.gap('4px'),
  },
  summaryOperator: {
    color: tokens.colorNeutralForeground3,
  },
  summaryValue: {
    color: tokens.colorBrandForeground1,
    fontWeight: tokens.fontWeightBold,
    fontSize: tokens.fontSizeBase400,
    lineHeight: tokens.lineHeightBase400,
  },
  summaryAnd: {
    color: tokens.colorNeutralForeground3,
  },
});

const ActiveRuleRow = memo(function ActiveRuleRow({
  item,
  itemKey,
  expanded,
  onToggleExpanded,
  onClear,
  children,
  styles,
}) {
  const handleToggle = useCallback(() => {
    onToggleExpanded(itemKey);
  }, [itemKey, onToggleExpanded]);
  const handleClear = useCallback(() => {
    onClear(item);
  }, [item, onClear]);
  const expandLabel = expanded ? `Collapse ${item.columnLabel}` : `Expand ${item.columnLabel}`;
  const operatorParts = Array.isArray(item.summaryParts)
    ? item.summaryParts.filter((part) => part.type !== 'value')
    : [];
  const valueParts = Array.isArray(item.summaryParts)
    ? item.summaryParts.filter((part) => part.type === 'value')
    : [];

  return (
    <>
      <tr>
        <td className={mergeClasses(styles.cell, styles.cellFirst)}>
          <Button
            appearance="subtle"
            icon={expanded ? <ChevronDown20Regular /> : <ChevronRight20Regular />}
            aria-label={expandLabel}
            onClick={handleToggle}
          />
        </td>
        <td className={mergeClasses(styles.cell, styles.cellName)}>
          <Text weight="semibold">{item.columnLabel}</Text>
        </td>
        <td className={mergeClasses(styles.cell, styles.cellOperator)}>
          <span className={styles.summaryOperators}>
            {operatorParts.length
              ? operatorParts.map((part, index) => (
                <FilterSummaryPart key={`${item.id}-op-${index}`} part={part} styles={styles} />
              ))
              : null}
          </span>
        </td>
        <td className={mergeClasses(styles.cell, styles.cellValue)}>
          <span className={styles.summaryValues}>
            {valueParts.length
              ? valueParts.map((part, index) => (
                <FilterSummaryPart key={`${item.id}-val-${index}`} part={part} styles={styles} />
              ))
              : <Text size={200}>{item.summary}</Text>}
          </span>
        </td>
        <td className={mergeClasses(styles.cell, styles.cellLast)}>
          <Button appearance="subtle" onClick={handleClear}>Clear</Button>
        </td>
      </tr>
      {expanded ? (
        <tr>
          <td className={mergeClasses(styles.cell, styles.cellEditor)} colSpan={5}>{children}</td>
        </tr>
      ) : null}
    </>
  );
});

function PurchaseOrdersActiveRulesSection({
  title,
  emptyText,
  headerItems = EMPTY_ITEMS,
  lineItems = EMPTY_ITEMS,
  keyPrefix,
  expandedKey,
  onToggleExpanded,
  onClear,
  renderEditor,
}) {
  const styles = useStyles();
  const hasItems = headerItems.length > 0 || lineItems.length > 0;
  const renderItem = useCallback((item) => {
    const itemKey = `${keyPrefix}${item.id}`;
    const expanded = expandedKey === itemKey;
    return (
      <ActiveRuleRow
        key={item.id}
        item={item}
        itemKey={itemKey}
        expanded={expanded}
        onToggleExpanded={onToggleExpanded}
        onClear={onClear}
        styles={styles}
      >
        {expanded && typeof renderEditor === 'function' ? renderEditor(item) : renderEditor}
      </ActiveRuleRow>
    );
  }, [expandedKey, keyPrefix, onClear, onToggleExpanded, renderEditor, styles]);

  return (
    <section className={styles.section}>
      <Text weight="semibold">{title}</Text>
      {hasItems ? null : <Text>{emptyText}</Text>}
      {headerItems.length > 0 ? (
        <div className={styles.group}>
          <Text size={200} weight="semibold">Header columns</Text>
          <table className={styles.table}>
            <tbody>{headerItems.map(renderItem)}</tbody>
          </table>
        </div>
      ) : null}
      {lineItems.length > 0 ? (
        <div className={styles.group}>
          <Text size={200} weight="semibold">Line columns</Text>
          <table className={styles.table}>
            <tbody>{lineItems.map(renderItem)}</tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

export default memo(PurchaseOrdersActiveRulesSection);
