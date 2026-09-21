import { HEX_COLOR_PATTERN } from '../../utils/hexColor';
import { STATUS_COLOR_PALETTE, normalizeStatusCompareKey } from '../../utils/statusColumnUtils';
import {
  formatPurchStatusDisplay,
  isPurchStatusAliasText,
  purchStatusValuesEquivalent,
  toPurchStatusStoredValue,
} from '../../utils/purchStatusDisplay';

const COLUMN_KEY_PATTERN = /^[a-zA-Z0-9_]{1,64}$/;

export const FORMAT_RULE_OPERATORS = ['=', '<>', '>', '<', '>=', '<=', 'contains'];
export const FORMAT_RULE_TARGETS = ['cell', 'row'];
export const FORMAT_RULE_COLOR_PALETTE = STATUS_COLOR_PALETTE.slice(1);

function normalizeColumnKey(value) {
  const key = String(value || '').trim();
  return COLUMN_KEY_PATTERN.test(key) ? key : '';
}

function normalizeRuleValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  if (value === '') return '';
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (/^[-+]?\d+(\.\d+)?$/.test(text)) return Number(text);
  return text.slice(0, 200);
}

function normalizeRule(rawRule) {
  if (!rawRule || typeof rawRule !== 'object' || Array.isArray(rawRule)) return null;
  const rawOperator = rawRule.op ?? rawRule.operator;
  const op = FORMAT_RULE_OPERATORS.includes(rawOperator) ? rawOperator : '=';
  const color = HEX_COLOR_PATTERN.test(String(rawRule.color || ''))
    ? String(rawRule.color).toLowerCase()
    : '';
  if (!color) return null;
  const valueRef = normalizeColumnKey(
    rawRule.valueRef ?? rawRule.compareColumnKey ?? rawRule.compareToColumnKey
  );
  if (valueRef) return { op, valueRef, color };
  const rawValue = Object.prototype.hasOwnProperty.call(rawRule, 'value')
    ? rawRule.value
    : rawRule.compareValue;
  const value = normalizeRuleValue(rawValue);
  if (value === null) return null;
  return { op, value, color };
}

export function normalizeColumnFormatRuleSet(rawRuleSet) {
  if (!rawRuleSet || (typeof rawRuleSet !== 'object' && !Array.isArray(rawRuleSet))) return null;
  const legacyRuleArray = Array.isArray(rawRuleSet);
  const target = !legacyRuleArray && FORMAT_RULE_TARGETS.includes(rawRuleSet.target) ? rawRuleSet.target : 'cell';
  const rawRules = legacyRuleArray
    ? rawRuleSet
    : (Array.isArray(rawRuleSet.rules)
      ? rawRuleSet.rules
      : (Array.isArray(rawRuleSet.conditions) ? rawRuleSet.conditions : []));
  const rules = rawRules
    .map(normalizeRule)
    .filter(Boolean)
    .slice(0, 20);
  if (!rules.length) return null;
  return { target, rules };
}

export function normalizeColumnFormatRulesMap(rawMap, allowedKeys = null) {
  if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) return {};
  const allowed = Array.isArray(allowedKeys) && allowedKeys.length ? new Set(allowedKeys) : null;
  return Object.entries(rawMap).reduce((acc, [rawKey, rawRuleSet]) => {
    const key = normalizeColumnKey(rawKey);
    if (!key) return acc;
    if (allowed && !allowed.has(key)) return acc;
    const normalized = normalizeColumnFormatRuleSet(rawRuleSet);
    if (!normalized) return acc;
    acc[key] = normalized;
    return acc;
  }, {});
}

function toDateOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toNumericOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const text = String(value).trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function compareValues(left, right, op, statusOptions) {
  if (statusOptions) {
    const leftKey = normalizeStatusCompareKey(left, statusOptions);
    const rightKey = normalizeStatusCompareKey(right, statusOptions);
    if (leftKey.startsWith('id:') && rightKey.startsWith('id:')) {
      return compareScalarValues(leftKey.slice(3), rightKey.slice(3), op);
    }
  }
  return compareScalarValues(left, right, op);
}

function compareScalarValues(left, right, op) {
  if (op === 'contains') {
    const leftText = String(left ?? '').trim().toLowerCase();
    const rightText = String(right ?? '').trim().toLowerCase();
    // Bij lege query geen match (anders highlight je alles bij een lege input).
    if (!leftText || !rightText) return false;
    if (leftText.includes(rightText)) return true;
    if (!isPurchStatusAliasText(left) && !isPurchStatusAliasText(right)) return false;
    return formatPurchStatusDisplay(left).toLowerCase().includes(rightText)
      || toPurchStatusStoredValue(left).toLowerCase().includes(rightText);
  }

  const leftDate = toDateOrNull(left);
  const rightDate = toDateOrNull(right);
  if (leftDate && rightDate) {
    const diff = leftDate.getTime() - rightDate.getTime();
    if (op === '=') return diff === 0;
    if (op === '<>') return diff !== 0;
    if (op === '>') return diff > 0;
    if (op === '<') return diff < 0;
    if (op === '>=') return diff >= 0;
    if (op === '<=') return diff <= 0;
    return false;
  }

  const leftNum = toNumericOrNull(left);
  const rightNum = toNumericOrNull(right);
  if (leftNum !== null && rightNum !== null) {
    if (op === '=') return leftNum === rightNum;
    if (op === '<>') return leftNum !== rightNum;
    if (op === '>') return leftNum > rightNum;
    if (op === '<') return leftNum < rightNum;
    if (op === '>=') return leftNum >= rightNum;
    if (op === '<=') return leftNum <= rightNum;
    return false;
  }

  const leftText = String(left ?? '');
  const rightText = String(right ?? '');
  const diff = purchStatusValuesEquivalent(leftText, rightText) ? 0 : leftText.localeCompare(rightText);
  if (op === '=') return diff === 0;
  if (op === '<>') return diff !== 0;
  if (op === '>') return diff > 0;
  if (op === '<') return diff < 0;
  if (op === '>=') return diff >= 0;
  if (op === '<=') return diff <= 0;
  return false;
}

export function evalFormatRules(resultValue, ruleSet, rowValues = {}, statusOptions = null) {
  if (resultValue === null || resultValue === undefined) return null;
  const normalizedRuleSet = normalizeColumnFormatRuleSet(ruleSet);
  if (!normalizedRuleSet || !normalizedRuleSet.rules.length) return null;
  for (const rule of normalizedRuleSet.rules) {
    const rightValue = rule.valueRef
      ? rowValues?.[rule.valueRef]
      : rule.value;
    if (rule.valueRef && (rightValue === undefined || rightValue === null || rightValue === '')) continue;
    if (compareValues(resultValue, rightValue, rule.op, statusOptions)) return rule.color;
  }
  return null;
}

export function migrateFormatRulesForStatusRenames(rulesMap, columnKey, renames) {
  if (!rulesMap || typeof rulesMap !== 'object' || !Array.isArray(renames) || !renames.length) {
    return rulesMap;
  }
  const key = String(columnKey || '').trim();
  if (!key || !rulesMap[key]) return rulesMap;
  const renameMap = new Map(renames.map(({ from, to }) => [from, to]));
  const ruleSet = normalizeColumnFormatRuleSet(rulesMap[key]);
  if (!ruleSet) return rulesMap;
  const rules = ruleSet.rules.map((rule) => {
    if (rule.valueRef || !Object.prototype.hasOwnProperty.call(rule, 'value')) return rule;
    const nextValue = renameMap.get(rule.value);
    return nextValue !== undefined ? { ...rule, value: nextValue } : rule;
  });
  return {
    ...rulesMap,
    [key]: { ...ruleSet, rules },
  };
}
