import {
  PRODUCT_IMAGE_COLUMN_KEY,
  resolveProductImageColumnWidth,
} from '../../utils/purchaseOrderProductImageColumn';

export const DEFAULT_HEADER_COLUMN_WIDTH = 160;
export const DEFAULT_LINE_COLUMN_WIDTH = 160;
export const MIN_COLUMN_WIDTH = 80;
export const MAX_COLUMN_WIDTH = 1000;

function clampStoredWidth(width) {
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(width)));
}

export function resolveLineColumnWidth(columnWidths, columnKey) {
  if (columnKey === PRODUCT_IMAGE_COLUMN_KEY) {
    return resolveProductImageColumnWidth(columnWidths);
  }
  const width = Number(columnWidths?.[columnKey]);
  if (!Number.isFinite(width)) return DEFAULT_LINE_COLUMN_WIDTH;
  return clampStoredWidth(width);
}

export function resolveHeaderColumnWidth(columnWidths, columnKey) {
  if (columnKey === PRODUCT_IMAGE_COLUMN_KEY) {
    return resolveProductImageColumnWidth(columnWidths);
  }
  const width = Number(columnWidths?.[columnKey]);
  if (!Number.isFinite(width)) return DEFAULT_HEADER_COLUMN_WIDTH;
  return clampStoredWidth(width);
}

export function fillHeaderColumnWidths(columnsOrKeys, widths) {
  const list = Array.isArray(columnsOrKeys) ? columnsOrKeys : [];
  const next = {};
  list.forEach((item) => {
    const key = typeof item === 'string' ? item : item?.key;
    if (!key) return;
    next[key] = resolveHeaderColumnWidth(widths, key);
  });
  return next;
}
