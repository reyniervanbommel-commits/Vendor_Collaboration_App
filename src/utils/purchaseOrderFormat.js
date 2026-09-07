// Hulpfuncties voor het netjes weergeven van purchase-order celwaarden en
// de versheidsindicator. Gehouden in een aparte util zodat tabel en pagina
// dezelfde formattering delen.

import { formatPurchStatusDisplay, isPurchaseOrderStatusColumn } from './purchStatusDisplay';

const NL_NUMBER = new Intl.NumberFormat('nl-NL');

function resolveColumnMeta(columnMeta) {
  if (typeof columnMeta === 'string') {
    return { columnKey: columnMeta, columnLabel: '', d365Field: '' };
  }
  const meta = columnMeta && typeof columnMeta === 'object' ? columnMeta : {};
  return {
    columnKey: meta.columnKey || meta.key || '',
    columnLabel: meta.columnLabel || meta.label || '',
    d365Field: meta.d365Field || '',
  };
}

function padDatePart(value) {
  return String(value).padStart(2, '0');
}

function formatAsDdMmYyyyFromDate(date) {
  return `${padDatePart(date.getDate())}/${padDatePart(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function tryFormatAsDdMmYyyy(value) {
  if (value instanceof Date) {
    if (!Number.isNaN(value.getTime())) return formatAsDdMmYyyyFromDate(value);
    return null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    // ISO datums (yyyy-mm-dd of yyyy-mm-ddThh:mm:ss) mappen direct, zonder locale variatie.
    // Geen komma in het restant: "ISO, ISO" is een lijst, geen enkele datetime.
    const isoDateMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s][^,]*)?$/);
    if (isoDateMatch) {
      const [, year, month, day] = isoDateMatch;
      return `${day}/${month}/${year}`;
    }
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatAsDdMmYyyyFromDate(parsed);
}

function isDateType(dataType) {
  const normalized = String(dataType || '').trim().toLowerCase();
  return normalized === 'date' || normalized === 'datetime' || normalized === 'date-time';
}

function isLikelyDateColumn(columnKey, columnLabel) {
  const keyText = String(columnKey || '');
  const labelText = String(columnLabel || '');
  return /date|datum|aangemaakt|created|delivery|ship/i.test(`${keyText} ${labelText}`);
}

function looksLikeIsoDateString(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return /^(\d{4})-(\d{2})-(\d{2})(?:[T\s][^,]*)?$/.test(trimmed);
}

function formatJoinedIsoDateValues(value) {
  if (typeof value !== 'string') return null;
  const parts = value.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2 || !parts.every(looksLikeIsoDateString)) return null;
  return parts.map((part) => tryFormatAsDdMmYyyy(part) || part).join(', ');
}

/**
 * Push-to-header kolommen slaan meerdere regel-datums op als één komma-gescheiden string.
 * Geeft de eerste geformatteerde datum plus het aantal overige unieke datums terug, zodat de
 * cel dezelfde eerste-waarde + "+N"-badge kan tonen als de Image-kolom (PurchaseOrderLinkedValueCell).
 * Retourneert null wanneer de waarde geen komma-gescheiden ISO-datumlijst is.
 */
export function getJoinedDateValuePreview(value) {
  if (typeof value !== 'string') return null;
  const parts = value.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2 || !parts.every(looksLikeIsoDateString)) return null;
  const formattedParts = parts.map((part) => tryFormatAsDdMmYyyy(part) || part);
  const uniqueParts = [...new Set(formattedParts)];
  return {
    firstValue: uniqueParts[0],
    additionalCount: Math.max(uniqueParts.length - 1, 0),
    allValuesLabel: uniqueParts.join(', '),
  };
}

/** True for Date objects and ISO date/datetime strings, including comma-separated lists. */
export function isDateLikeCellValue(value) {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (looksLikeIsoDateString(trimmed)) return true;
  return formatJoinedIsoDateValues(trimmed) !== null;
}

/**
 * Formatteert een readonly D365-celwaarde op basis van het dataType.
 * Custom kolommen worden elders inline bewerkbaar gerenderd.
 */
export function formatCellValue(value, dataType, columnMeta = '') {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  const { columnKey: resolvedColumnKey, columnLabel: resolvedColumnLabel, d365Field } = resolveColumnMeta(columnMeta);
  const normalizedDataType = String(dataType || '').trim().toLowerCase();
  if (normalizedDataType !== 'date_period') {
    const joinedDates = formatJoinedIsoDateValues(value);
    if (joinedDates) return joinedDates;
  }
  const normalizedDate = tryFormatAsDdMmYyyy(value);
  if (
    isDateType(dataType)
    || (normalizedDataType !== 'date_period'
      && isLikelyDateColumn(resolvedColumnKey, resolvedColumnLabel)
      && normalizedDate)
    || (normalizedDataType !== 'date_period' && looksLikeIsoDateString(value) && normalizedDate)
  ) {
    return normalizedDate || String(value);
  }

  if (dataType === 'number') {
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isNaN(num)) {
      return NL_NUMBER.format(num);
    }
    return String(value);
  }

  if (dataType === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  if (isPurchaseOrderStatusColumn({ key: resolvedColumnKey, d365Field })) {
    return formatPurchStatusDisplay(value) || String(value);
  }

  return String(value);
}

/**
 * Last refreshed: calendar date plus clock hour (no minutes/seconds).
 */
export function formatSyncedAt(syncedAt) {
  if (!syncedAt) return null;
  const parsed = new Date(syncedAt);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${formatAsDdMmYyyyFromDate(parsed)} ${padDatePart(parsed.getHours())}:00`;
}
