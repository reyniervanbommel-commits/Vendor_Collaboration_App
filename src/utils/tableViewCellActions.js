function padDatePart(value) {
  return String(value).padStart(2, '0');
}

function isDateColumn(column) {
  return column?.dataType === 'date' || column?.filterDataType === 'date';
}

export function serializeRawValueForFilter(column, rawValue) {
  if (rawValue === null || rawValue === undefined) return '';
  if (isDateColumn(column)) {
    const parsed = new Date(rawValue);
    if (Number.isNaN(parsed.getTime())) return String(rawValue);
    return `${parsed.getFullYear()}-${padDatePart(parsed.getMonth() + 1)}-${padDatePart(parsed.getDate())}`;
  }
  return String(rawValue);
}

export function buildFilterFromCellValue(column, rawValue) {
  return {
    operator: 'equals',
    value: serializeRawValueForFilter(column, rawValue),
    secondaryValue: '',
  };
}

export function isCellContextMenuDisabled(column) {
  if (!column?.key) return true;
  return false;
}

export async function copyCellValueToClipboard(column, rawValue) {
  const text = serializeRawValueForFilter(column, rawValue);
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  if (typeof document === 'undefined') return false;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  return copied;
}
