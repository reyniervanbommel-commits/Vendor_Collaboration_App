import * as XLSX from 'xlsx';
import { CAPACITY_PLANNING_COLUMNS } from './rccpCapacityPlanningColumns';

export function capacityPlanningRowsToSheetData(rows) {
  const headers = CAPACITY_PLANNING_COLUMNS.map((column) => column.label);
  const body = (rows || []).map((row) => CAPACITY_PLANNING_COLUMNS.map((column) => {
    const value = row?.[column.key];
    if (value === null || value === undefined || value === '') return '';
    if (column.type === 'number') {
      const num = Number(value);
      return Number.isFinite(num) ? num : '';
    }
    return String(value);
  }));
  return [headers, ...body];
}

export function exportCapacityPlanningToExcel(rows, fileName = 'performance-planning-capacity-planning.xlsx') {
  const worksheet = XLSX.utils.aoa_to_sheet(capacityPlanningRowsToSheetData(rows));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Performance & Planning Capacity');
  XLSX.writeFile(workbook, fileName);
}

export function buildCapacityPlanningExportFileName(date = new Date()) {
  const stamp = date.toISOString().slice(0, 10);
  return `performance-planning-capacity-planning-${stamp}.xlsx`;
}
