import React from 'react';
import {
  CalendarLtr24Regular,
  Chat24Regular,
  CursorClick24Regular,
  DataBarVertical24Regular,
  DataTrending24Regular,
  MathFormula24Regular,
  PaintBrush24Regular,
  Settings24Regular,
  Table24Regular,
  TableAdd24Regular,
  TabAdd24Regular,
} from '@fluentui/react-icons';

const ICONS = {
  board: Table24Regular,
  chart: DataTrending24Regular,
  settings: Settings24Regular,
  tabs: TabAdd24Regular,
  column: TableAdd24Regular,
  formula: MathFormula24Regular,
  calendar: CalendarLtr24Regular,
  cursor: CursorClick24Regular,
  remarks: Chat24Regular,
  paint: PaintBrush24Regular,
  kpi: DataBarVertical24Regular,
};

export default function TourIcon({ name, ...props }) {
  const Icon = ICONS[name] || Table24Regular;
  return <Icon {...props} />;
}
