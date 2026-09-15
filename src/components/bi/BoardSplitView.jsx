import React, { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import {
  Button, Tab, TabList, makeStyles, mergeClasses, shorthands, Spinner, tokens,
} from '@fluentui/react-components';
import { ChevronDownRegular, ChevronUpRegular } from '@fluentui/react-icons';
import AdminInfoHint from '../admin/AdminInfoHint';
import { useRccpWindow } from '../../hooks/useRccpWindow';
import { useRccpVendorOptions } from '../../hooks/useRccpVendorOptions';
import { usePoTableZoomNode } from '../../hooks/usePoTableZoomNode';
import { resolvePoBoardRccpVendor } from '../rccp/resolveRccpVendorFilter';
import {
  parseRccpPeriodGrain,
  RCCP_PERIOD_GRAIN_WEEK,
} from '../rccp/rccpPeriodGrain';
import RccpSplitToolbar from '../rccp/RccpSplitToolbar';
import {
  nextRccpItemTableFilter,
  resolveRccpItemColumnKey,
} from '../rccp/resolveRccpItemFilter';
import { useSplitPane } from './hooks/useSplitPane';
import SplitPaneResizeHandle from './SplitPaneResizeHandle';
import { useBiCharts } from './hooks/useBiCharts';
import { useChartData } from './hooks/useChartData';
import { useBiMeta } from './hooks/useBiMeta';
import { BOARD_KEY } from './biConstants';
import { buildTableDataRevision } from './tableDataRevision';
import { useAuth } from '../../context/AuthContext';
import { ROLES } from '../../constants/roles';
import {
  PO_TABLE_SPLIT_ZOOM_STYLE,
  PO_TABLE_ZOOM_CSS_VAR,
  PO_TABLE_ZOOM_DEFAULT,
} from '../../utils/poTableZoom';

const BiChartStrip = lazy(() => import('./BiChartStrip'));
const RccpSplitStrip = lazy(() => import('../rccp/RccpSplitStrip'));
const PoBoardKpiStrip = lazy(() => import('../rccp/PoBoardKpiStrip'));

const PO_BOARD_KPI_INFO =
  'Values come from the purchase orders currently in the table. Click a tile to filter; quantity columns then show the units counted by that tile.';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    [PO_TABLE_ZOOM_CSS_VAR]: String(PO_TABLE_ZOOM_DEFAULT),
  },
  tableRegion: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    display: 'flex',
    overflow: 'hidden',
    '& > *': {
      flex: 1,
      minHeight: 0,
      minWidth: 0,
      overflow: 'hidden',
      scrollbarGutter: 'stable',
    },
  },
  toggleBar: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap(tokens.spacingHorizontalS),
    ...shorthands.padding(tokens.spacingVerticalXS, tokens.spacingHorizontalS),
    backgroundColor: tokens.colorNeutralBackground2,
    flexWrap: 'wrap',
  },
  toggleBarCollapsed: {
    ...shorthands.borderTop('1px', 'solid', tokens.colorNeutralStroke2),
  },
  pane: {
    ...shorthands.padding(tokens.spacingVerticalXS, tokens.spacingHorizontalS, tokens.spacingVerticalXS),
    backgroundColor: tokens.colorNeutralBackground2,
    minHeight: 0,
    overflow: 'auto',
  },
  paneCollapsed: {
    height: 0,
    overflow: 'hidden',
    padding: 0,
    borderTopWidth: 0,
    minHeight: 0,
  },
});

export default function BoardSplitView({
  filterByColumn, tableRows, isStaff, visibleOrders, kpiFilterKey, onKpiFilter, tableFilter, children,
  orderNumbers, derivedVendor,
}) {
  const styles = useStyles();
  const setSplitRootNode = usePoTableZoomNode();
  const { user } = useAuth();
  const isSupplier = user?.role === ROLES.SUPPLIER;
  // Staff en suppliers krijgen beide de split-view; suppliers zien uitsluitend hun eigen data
  // (RCCP + BI worden server-side op hun leveranciersaccount gescoped).
  const showSplit = isStaff || isSupplier;
  const split = useSplitPane();
  const { isoWindow, setIsoWindow, planningDateModes, setPlanningDateModes } = useRccpWindow();
  const [periodGrain, setPeriodGrain] = useState(RCCP_PERIOD_GRAIN_WEEK);
  const [rccpAnalysis, setRccpAnalysis] = useState(null);
  const handlePeriodGrainChange = useCallback((value) => {
    setPeriodGrain(parseRccpPeriodGrain(value));
  }, []);
  const handleWindowReplace = useCallback((next) => {
    setIsoWindow({
      fromYear: Number(next.fromYear),
      fromWeek: Number(next.fromWeek),
      toYear: Number(next.toYear),
      toWeek: Number(next.toWeek),
    });
  }, [setIsoWindow]);
  const handleRccpAnalysisChange = useCallback((next) => {
    setRccpAnalysis(next);
  }, []);
  const handleShowDataWindow = useCallback(() => {
    if (rccpAnalysis?.dataWindow) setIsoWindow(rccpAnalysis.dataWindow);
  }, [rccpAnalysis, setIsoWindow]);
  const {
    vendors, vendorNames, vendorColumnKey, loading: vendorsLoading,
  } = useRccpVendorOptions();
  const { charts } = useBiCharts();
  const meta = useBiMeta(BOARD_KEY);

  const handleTabSelect = useCallback((_, data) => {
    split.setActiveTab(data.value);
    if (!split.open) split.toggleOpen();
  }, [split]);

  const selectedIdSet = useMemo(() => new Set(split.chartIds.map(String)), [split.chartIds]);
  const selectedCharts = useMemo(
    () => charts.filter((chart) => selectedIdSet.has(String(chart.id))),
    [charts, selectedIdSet],
  );

  const dataRevision = useMemo(() => buildTableDataRevision(tableRows), [tableRows]);
  // View-tabs filteren vaak op vendorName; /rccp/analysis verwacht het accountnummer
  // (zelfde mapping als de RCCP-pagina). Wacht op de vendorlijst om een lege fetch te vermijden.
  const vendorAccount = useMemo(
    () => resolvePoBoardRccpVendor({
      isSupplier,
      supplierAccount: user?.vendor_account || '',
      filterByColumn,
      vendors,
      vendorNames,
      vendorColumnKey: vendorColumnKey || 'vendorAccount',
      vendorsReady: !vendorsLoading,
      derivedVendor,
    }),
    [isSupplier, user?.vendor_account, filterByColumn, vendors, vendorNames, vendorColumnKey, vendorsLoading, derivedVendor],
  );
  const rccpVendorReady = isSupplier || !vendorsLoading;
  // Item-filters blijven client-side op de al geladen analysis. Alleen vendor of
  // load-date mag een nieuwe /rccp/analysis-call triggeren — niet de PO-tabel-fingerprint.
  // De load-date zit niet in de refresh-key: beide leverdatums worden per vendor/venster
  // ingeladen, zodat de toggle client-side is en geen nieuwe /rccp/analysis-call triggert.
  const rccpRefreshKey = useMemo(() => `${vendorAccount || ''}`, [vendorAccount]);
  const itemColumnKey = useMemo(
    () => resolveRccpItemColumnKey(tableFilter?.columns, tableFilter?.lineValueLinks),
    [tableFilter],
  );
  const handleRccpItemClick = useCallback((itemNumber) => {
    if (!itemColumnKey || !tableFilter?.applyColumnFilter) return;
    const next = nextRccpItemTableFilter(itemNumber, filterByColumn?.[itemColumnKey], itemColumnKey);
    if (next.action === 'clear') tableFilter.clearColumnFilter?.(itemColumnKey);
    else tableFilter.applyColumnFilter(itemColumnKey, next.filter);
  }, [filterByColumn, tableFilter, itemColumnKey]);
  const showBiPane = split.open && split.activeTab === 'bi';
  const showRccpPane = split.open && split.activeTab === 'rccp';
  const kpiEnabled = split.open && split.activeTab === 'kpis';

  const { resultsById } = useChartData({
    charts: showBiPane ? selectedCharts : [],
    externalFilterByColumn: filterByColumn,
    dataRevision,
  });

  const chartsWithSeries = useMemo(
    () => charts.map((chart) => ({ ...chart, series: resultsById[String(chart.id)] || [] })),
    [charts, resultsById],
  );

  if (!showSplit) return children;

  return (
    <div className={styles.root} ref={setSplitRootNode}>
      <div className={styles.tableRegion}>{children}</div>
      {split.open ? (
        <SplitPaneResizeHandle height={split.height} onResize={split.setHeight} />
      ) : null}

      <div
        className={mergeClasses(styles.toggleBar, !split.open && styles.toggleBarCollapsed)}
        style={PO_TABLE_SPLIT_ZOOM_STYLE}
      >
        <Button
          size="small"
          appearance="subtle"
          icon={split.open ? <ChevronDownRegular /> : <ChevronUpRegular />}
          aria-expanded={split.open}
          aria-label={split.open ? 'Hide panel' : 'Show panel'}
          onClick={split.toggleOpen}
        />

        <TabList
          size="small"
          selectedValue={split.activeTab}
          onTabSelect={handleTabSelect}
        >
          {/* BI/Charts-tab verborgen op verzoek */}
          <Tab value="rccp">Performance & Planning</Tab>
          <Tab value="kpis">KPIs</Tab>
        </TabList>
        {kpiEnabled ? <AdminInfoHint text={PO_BOARD_KPI_INFO} label="About KPI tiles" /> : null}
        {showRccpPane ? (
          <RccpSplitToolbar
            isoWindow={isoWindow}
            onReplaceWindow={handleWindowReplace}
            periodGrain={periodGrain}
            onPeriodGrainChange={handlePeriodGrainChange}
            planningDateModes={planningDateModes}
            onPlanningDateModesChange={setPlanningDateModes}
            vendorAccount={vendorAccount}
            analysis={rccpAnalysis}
            onShowDataWindow={handleShowDataWindow}
          />
        ) : null}
      </div>

      <div
        className={split.open ? styles.pane : styles.paneCollapsed}
        style={split.open ? { height: `${split.height}px` } : undefined}
        aria-hidden={!split.open}
      >
        <div hidden={!showBiPane} style={PO_TABLE_SPLIT_ZOOM_STYLE}>
          {showBiPane ? (
            <Suspense fallback={<Spinner size="tiny" label="Loading charts…" />}>
              <BiChartStrip
                availableCharts={chartsWithSeries}
                selectedIds={split.chartIds}
                onToggleChart={split.toggleChart}
                height={split.height}
                columns={meta.columns}
              />
            </Suspense>
          ) : null}
        </div>
        <div hidden={!showRccpPane} style={PO_TABLE_SPLIT_ZOOM_STYLE}>
          {showRccpPane ? (
            <Suspense fallback={<Spinner size="tiny" label="Loading PERF…" />}>
              {rccpVendorReady ? (
                <RccpSplitStrip
                  vendorAccount={vendorAccount}
                  refreshKey={rccpRefreshKey}
                  enabled
                  isoWindow={isoWindow}
                  filterByColumn={filterByColumn}
                  itemColumnKey={itemColumnKey}
                  onItemClick={handleRccpItemClick}
                  planningDateModes={planningDateModes}
                  periodGrain={periodGrain}
                  orderNumbers={orderNumbers}
                  onAnalysisChange={handleRccpAnalysisChange}
                />
              ) : (
                <Spinner size="tiny" label="Loading PERF…" />
              )}
            </Suspense>
          ) : null}
        </div>
        <div hidden={!kpiEnabled} style={PO_TABLE_SPLIT_ZOOM_STYLE}>
          {kpiEnabled ? (
            <Suspense fallback={<Spinner size="tiny" label="Loading KPIs…" />}>
              <PoBoardKpiStrip
                orders={visibleOrders}
                selectedKey={kpiFilterKey || ''}
                onKpiFilter={onKpiFilter}
                refreshKey={dataRevision}
              />
            </Suspense>
          ) : null}
        </div>
      </div>
    </div>
  );
}
