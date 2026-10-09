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

// Elke regel is een kaart met twee regels: kolomnaam + Clear bovenaan, operator en waarde(n)
// eronder over de volle breedte. Zo passen lange waarden (bv. artikelnummers) zonder af te breken.
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
  list: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap(tokens.spacingVerticalXS),
    ...shorthands.margin(0),
    ...shorthands.padding(0),
    listStyleType: 'none',
  },
  card: {
    backgroundColor: tokens.colorNeutralBackground1,
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    ...shorthands.borderRadius(tokens.borderRadiusMedium),
    ...shorthands.padding(tokens.spacingVerticalXS, tokens.spacingHorizontalS),
  },
  cardExpanded: {
    ...shorthands.borderColor(tokens.colorNeutralStroke1),
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap(tokens.spacingHorizontalXS),
    minWidth: 0,
  },
  name: {
    flexGrow: 1,
    minWidth: 0,
    ...shorthands.overflow('hidden'),
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  summary: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: tokens.spacingHorizontalXS,
    rowGap: '2px',
    // Uitlijnen onder de kolomnaam (breedte van de uitklapknop).
    paddingLeft: '28px',
    paddingBottom: tokens.spacingVerticalXS,
    minWidth: 0,
  },
  editor: {
    ...shorthands.borderTop('1px', 'solid', tokens.colorNeutralStroke2),
    marginTop: tokens.spacingVerticalXS,
    paddingTop: tokens.spacingVerticalS,
  },
  summaryOperator: {
    color: tokens.colorNeutralForeground3,
  },
  summaryValue: {
    color: tokens.colorBrandForeground1,
    fontWeight: tokens.fontWeightBold,
    fontSize: tokens.fontSizeBase400,
    lineHeight: tokens.lineHeightBase400,
    // Een waarde blijft heel; alleen tussen waarden mag de regel breken.
    whiteSpace: 'nowrap',
    maxWidth: '100%',
    ...shorthands.overflow('hidden'),
    textOverflow: 'ellipsis',
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
  const parts = Array.isArray(item.summaryParts) ? item.summaryParts : [];

  return (
    <li className={mergeClasses(styles.card, expanded && styles.cardExpanded)}>
      <div className={styles.header}>
        <Button
          appearance="subtle"
          size="small"
          icon={expanded ? <ChevronDown20Regular /> : <ChevronRight20Regular />}
          aria-label={expandLabel}
          aria-expanded={expanded}
          onClick={handleToggle}
        />
        <Text weight="semibold" className={styles.name} title={item.columnLabel}>{item.columnLabel}</Text>
        <Button appearance="subtle" size="small" onClick={handleClear}>Clear</Button>
      </div>
      <div className={styles.summary} data-rule-summary>
        {parts.length
          ? parts.map((part, index) => (
            <React.Fragment key={`${item.id}-part-${index}`}>
              {index > 0 ? ' ' : null}
              <FilterSummaryPart part={part} styles={styles} />
            </React.Fragment>
          ))
          : <Text size={200}>{item.summary}</Text>}
      </div>
      {expanded ? <div className={styles.editor}>{children}</div> : null}
    </li>
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
          <Text size={200} weight="semibold" id={`${keyPrefix}header-label`}>Header columns</Text>
          <ul className={styles.list} aria-labelledby={`${keyPrefix}header-label`}>
            {headerItems.map(renderItem)}
          </ul>
        </div>
      ) : null}
      {lineItems.length > 0 ? (
        <div className={styles.group}>
          <Text size={200} weight="semibold" id={`${keyPrefix}line-label`}>Line columns</Text>
          <ul className={styles.list} aria-labelledby={`${keyPrefix}line-label`}>
            {lineItems.map(renderItem)}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export default memo(PurchaseOrdersActiveRulesSection);
