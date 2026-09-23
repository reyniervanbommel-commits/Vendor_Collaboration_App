import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Option,
  Dropdown,
  Text,
  Textarea,
  makeStyles,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import PurchaseOrderColumnFormatRulesSection from './PurchaseOrderColumnFormatRulesSection';
import PurchaseOrderFormulaHelpPanel from './PurchaseOrderFormulaHelpPanel';
import {
  FORMAT_RULE_COLOR_PALETTE,
  FORMAT_RULE_OPERATORS,
  normalizeColumnFormatRuleSet,
} from './columnFormatRuleUtils';
import { usePurchaseOrderFormulaValidation } from '../../hooks/usePurchaseOrderFormulaValidation';

const FORMULA_RESULT_TYPES = [
  { value: 'number', label: 'Number' },
  { value: 'text', label: 'Text' },
  { value: 'date', label: 'Date' },
  { value: 'boolean', label: 'Yes/No' },
];

const DATA_TYPE_LABELS = Object.fromEntries(FORMULA_RESULT_TYPES.map((type) => [type.value, type.label]));
const useStyles = makeStyles({
  form: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('14px'),
  },
  helperText: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  validateRow: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('8px'),
  },
  validText: {
    color: tokens.colorPaletteGreenForeground1,
    fontSize: tokens.fontSizeBase200,
  },
});

export default function PurchaseOrderFormulaColumnDialog({
  open,
  onOpenChange,
  onSubmit,
  sourceColumn,
  availableColumns = [],
  initialValue = null,
  initialFormatRuleSet = null,
}) {
  const styles = useStyles();
  const [label, setLabel] = useState('');
  const [resultType, setResultType] = useState('number');
  const [formulaExpr, setFormulaExpr] = useState('');
  const [formatTarget, setFormatTarget] = useState('cell');
  const [formatRules, setFormatRules] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { formulaValidation, validateFormula, resetFormulaValidation } = usePurchaseOrderFormulaValidation();

  useEffect(() => {
    if (!open) return;
    setLabel(String(initialValue?.label || '').trim() || 'New formula');
    setResultType(initialValue?.dataType || 'number');
    setFormulaExpr(initialValue?.formulaExpr || '');
    const initialRules = Array.isArray(initialFormatRuleSet?.rules) ? initialFormatRuleSet.rules : [];
    setFormatTarget(initialFormatRuleSet?.target === 'row' ? 'row' : 'cell');
    setFormatRules(initialRules.map((rule, index) => ({
      id: `rule-${index}`,
      op: FORMAT_RULE_OPERATORS.includes(rule?.op) ? rule.op : '=',
      compareMode: rule?.valueRef ? 'column' : 'value',
      value: rule?.value === undefined || rule?.value === null ? '' : String(rule.value),
      valueRef: String(rule?.valueRef || ''),
      color: String(rule?.color || FORMAT_RULE_COLOR_PALETTE[0]).toLowerCase(),
    })));
    setSaving(false);
    setError('');
    resetFormulaValidation();
  }, [open, initialValue, initialFormatRuleSet, resetFormulaValidation]);

  const dialogTitle = initialValue ? 'Edit formula column' : 'Add formula column';
  const sourceLabel = String(sourceColumn?.label || '').trim();
  const sourceKey = String(sourceColumn?.key || '').trim();

  const referenceColumns = useMemo(() => (
    (Array.isArray(availableColumns) ? availableColumns : []).filter((column) => {
      if (!column || typeof column !== 'object') return false;
      const key = String(column.key || '').trim();
      if (!key) return false;
      return !String(column.formulaExpr || '').trim();
    })
  ), [availableColumns]);

  const insertReference = useCallback((columnKey) => {
    const ref = `(${columnKey})`;
    setFormulaExpr((prev) => `${String(prev || '')}${ref}`);
  }, []);
  const insertFunctionSnippet = useCallback((snippet) => {
    setFormulaExpr((prev) => `${String(prev || '')}${snippet}`);
  }, []);
  const addFormatRule = useCallback(() => {
    setFormatRules((prev) => [...prev, {
      id: `rule-${Date.now()}-${prev.length}`,
      op: '=',
      compareMode: 'value',
      value: '',
      valueRef: '',
      color: FORMAT_RULE_COLOR_PALETTE[0],
    }]);
  }, []);
  const removeFormatRule = useCallback((ruleId) => {
    setFormatRules((prev) => prev.filter((rule) => rule.id !== ruleId));
  }, []);
  const updateFormatRule = useCallback((ruleId, patch) => {
    setFormatRules((prev) => prev.map((rule) => (rule.id === ruleId ? { ...rule, ...patch } : rule)));
  }, []);

  const handleSubmit = useCallback(async () => {
    const cleanLabel = String(label || '').trim();
    const cleanFormula = String(formulaExpr || '').trim();
    if (!cleanLabel) {
      setError('Enter a name for the formula column.');
      return;
    }
    if (!cleanFormula) {
      setError('Enter a formula.');
      return;
    }
    const validation = await validateFormula({
      formulaExpr: cleanFormula,
      ownColumnKey: initialValue?.key,
      dataType: resultType,
    });
    if (!validation.valid) {
      setError('Formula validation failed. Adjust the formula using the tip.');
      return;
    }
    const normalizedFormatRuleSet = normalizeColumnFormatRuleSet({
      target: formatTarget,
      rules: formatRules.map((rule) => ({
        op: rule.op,
        color: rule.color,
        ...(rule.compareMode === 'column' ? { valueRef: rule.valueRef } : { value: rule.value }),
      })),
    });
    setSaving(true);
    setError('');
    try {
      await onSubmit({
        label: cleanLabel,
        dataType: resultType,
        formulaExpr: validation.normalizedExpression || cleanFormula,
        formatRuleSet: normalizedFormatRuleSet,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err?.message || 'Failed to save formula.');
    } finally {
      setSaving(false);
    }
  }, [label, formulaExpr, formatRules, formatTarget, initialValue?.key, onOpenChange, onSubmit, resultType, validateFormula]);

  return (
    <Dialog open={open} onOpenChange={(_, data) => onOpenChange(data.open)}>
      <DialogSurface data-tour="formula-dialog">
        <DialogBody>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogContent>
            <div className={styles.form}>
              <Text className={styles.helperText}>
                New column will appear to the right of: {sourceLabel || '-'} {sourceKey ? `(${sourceKey})` : ''}
              </Text>

              <Field label="Name" required data-tour="formula-name">
                <Input
                  value={label}
                  onChange={(_, data) => setLabel(data.value)}
                  placeholder="e.g. Budget difference"
                />
              </Field>

              <Field
                label="Result type"
                required
                hint="Pick Yes/No for a plain condition without IF, such as (a)>5 AND (b)<10."
                data-tour="formula-result-type"
              >
                <Dropdown
                  value={DATA_TYPE_LABELS[resultType]}
                  selectedOptions={[resultType]}
                  onOptionSelect={(_, data) => setResultType(data.optionValue)}
                >
                  {FORMULA_RESULT_TYPES.map((type) => (
                    <Option key={type.value} value={type.value}>
                      {type.label}
                    </Option>
                  ))}
                </Dropdown>
              </Field>

              <Field
                label="Formula"
                required
                hint="Example: IF((a)>(b) AND (c)>0;'Too late';(a)+(b)). Combine conditions with AND / OR."
                data-tour="formula-expression"
              >
                <Textarea
                  value={formulaExpr}
                  onChange={(_, data) => {
                    setFormulaExpr(data.value);
                    resetFormulaValidation();
                  }}
                  resize="vertical"
                  rows={4}
                />
                <div className={styles.validateRow}>
                  <Button
                    size="small"
                    appearance="secondary"
                    onClick={() => validateFormula({ formulaExpr, ownColumnKey: initialValue?.key, dataType: resultType })}
                    disabled={saving || formulaValidation.status === 'checking'}
                    data-tour="formula-check"
                  >
                    {formulaValidation.status === 'checking' ? 'Checking...' : 'Check formula'}
                  </Button>
                  {formulaValidation.status === 'valid' ? (
                    <Text className={styles.validText}>{formulaValidation.message}</Text>
                  ) : null}
                </div>
              </Field>

              <div data-tour="formula-help">
                <PurchaseOrderFormulaHelpPanel
                  referenceColumns={referenceColumns}
                  onInsertReference={insertReference}
                  onInsertFunction={insertFunctionSnippet}
                />
              </div>

              <PurchaseOrderColumnFormatRulesSection
                formatTarget={formatTarget}
                setFormatTarget={setFormatTarget}
                formatRules={formatRules}
                referenceColumns={referenceColumns}
                addFormatRule={addFormatRule}
                updateFormatRule={updateFormatRule}
                removeFormatRule={removeFormatRule}
              />

              {formulaValidation.status === 'invalid'
                ? <Field validationState="error" validationMessage={`${formulaValidation.message}${formulaValidation.tip ? ` Tip: ${formulaValidation.tip}` : ''}`} />
                : null}
              {error ? <Field validationState="error" validationMessage={error} /> : null}
            </div>
          </DialogContent>
          <DialogActions data-tour="formula-actions">
            <Button appearance="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button appearance="primary" onClick={handleSubmit} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
