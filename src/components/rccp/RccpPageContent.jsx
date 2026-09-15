import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Text, makeStyles, tokens, shorthands } from '@fluentui/react-components';
import { ArrowClockwise24Regular, Settings24Regular } from '@fluentui/react-icons';
import { useAuth } from '../../context/AuthContext';
import { ROLES } from '../../constants/roles';
import { useRccpPage } from '../../hooks/useRccpPage';
import { useRccpVendorPrefetch } from '../../hooks/useRccpVendorPrefetch';
import {
  RCCP_PERIOD_GRAIN_MONTH,
  RCCP_PERIOD_GRAIN_WEEK,
  resolveRccpChartView,
  secondaryRccpPlanningDateMode,
} from './rccpPeriodGrain';
import RccpPageHeader from './RccpPageHeader';
import RccpDashboardCharts from './RccpDashboardCharts';
import RccpSettingsFlyout from './RccpSettingsFlyout';
import RccpVendorFilter from './RccpVendorFilter';
import RccpCapacityPlanningTab from './RccpCapacityPlanningTab';
import RccpWeekWindowFields from './RccpWeekWindowFields';
import RccpItemFilter from './RccpItemFilter';
import { useRccpItemFilter } from './useRccpItemFilter';
import { filterRccpChartByItem, filterRccpMatrixByItem } from './rccpChartItems';
import { useRccpVendorOptions } from '../../hooks/useRccpVendorOptions';
import {
  resolveDefaultRccpVendorWithFallback,
  resolveRccpVendorFromFilter,
} from './resolveRccpVendorFilter';
import { readPoRccpHandoff } from '../../utils/poVendorFilterHandoff';

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', ...shorthands.gap(tokens.spacingVerticalXL) },
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    width: '100%',
    ...shorthands.gap(tokens.spacingHorizontalM),
  },
  hint: { color: tokens.colorNeutralForeground3 },
});

export default function RccpPageContent() {
  const styles = useStyles();
  const { user } = useAuth();
  const isAdmin = user?.role === ROLES.ADMIN;
  const isSupplier = user?.role === ROLES.SUPPLIER;
  // null = nog geen vendor gekozen (voorkomt dat de dashboard-analyse voor ALLE vendors laadt, wat traag is)
  const [vendorAccount, setVendorAccount] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const {
    vendors, vendorNames, loading: vendorsLoading, error: vendorsError,
  } = useRccpVendorOptions();

  // Was er bij het openen van de pagina al een vendor-filter (nr of naam) actief op de
  // PO-tabelpagina? Bepaal dit één keer bij mount (los van of de vendorlijst al geladen is) —
  // zo weten we meteen of het zoekveld autofocus moet krijgen (geen PO-filter → gebruiker gaat
  // zelf zoeken) of niet (PO-filter aanwezig → vendor wordt automatisch voor-ingevuld).
  const [hadPoFilterHandoff] = useState(() => {
    const handoff = readPoRccpHandoff();
    return Boolean(resolveRccpVendorFromFilter(handoff?.filterByColumn)) || Boolean(handoff?.derivedVendor);
  });

  // hasVendor bepaalt of er daadwerkelijk data geladen wordt (en dus of chart/matrix/capacity
  // planning vullen) — pas waar wanneer er echt een vendor gekozen is, niet zodra het
  // resolve-effect hieronder eenmalig is afgerond (dat kan ook naar '' resolven).
  const hasVendor = isSupplier || Boolean(vendorAccount);
  const {
    window, setWindow, windowLoaded, lastVendor, setLastVendor,
    kpiWindowOnly, setKpiWindowOnly, chartVisibleKeys, setChartVisibleKeys,
    planningDateModes, setPlanningDateModes,
    analysis, analysisByMode, loading, error, readOnly,
    measureRows, periods, cells, reload,
  } = useRccpPage({
    vendorAccount: isSupplier ? undefined : (vendorAccount || undefined),
    enabled: hasVendor,
  });

  // Neem de vendor over waarop de PO-pagina net gefilterd was (nr of naam); is er geen
  // PO-filter, laat de vendor dan leeg (in plaats van automatisch de eerste vendor te laden,
  // wat traag is) — de gebruiker zoekt dan zelf een vendor op via het zoekveld. Dit effect staat
  // bewust ná useRccpPage: het leunt op windowLoaded/lastVendor uit die hook (TDZ voorkomen).
  useEffect(() => {
    if (isSupplier || vendorsLoading || vendorAccount !== null) return;
    const handoff = readPoRccpHandoff();
    const resolved = resolveDefaultRccpVendorWithFallback({
      vendors,
      vendorNames,
      filterByColumn: handoff?.filterByColumn,
      derivedVendor: handoff?.derivedVendor,
      lastVendor,
      lastVendorReady: windowLoaded,
    });
    // undefined = nog niet resolvable (geen PO-filter, lastVendor nog niet geladen) — geen state
    // zetten, effect draait opnieuw zodra windowLoaded true wordt.
    if (resolved !== undefined) setVendorAccount(resolved);
  }, [isSupplier, vendorsLoading, vendors, vendorNames, vendorAccount, windowLoaded, lastVendor]);

  // Onthoud de gekozen vendor als voorkeur (samen met de week in board-settings/rccp), zodat de
  // pagina bij terugkeer exact dezelfde vendor-week-combinatie toont. Lege selectie wist de
  // voorkeur niet (dan blijft de laatste bewaard).
  const handleVendorChange = useCallback((account) => {
    setVendorAccount(account);
    if (account) setLastVendor(account);
  }, [setLastVendor]);

  // Terwijl de gebruiker een vendor zoekt (hover/keyboard-highlight in de dropdown, of een
  // exacte match tijdens het typen), laad de analyse voor die vendor alvast op de achtergrond —
  // zodra hij/zij die vendor echt selecteert, komt de data al (grotendeels) uit cache.
  const handleHighlightVendor = useRccpVendorPrefetch(window, planningDateModes);

  const [periodGrain, setPeriodGrain] = useState(RCCP_PERIOD_GRAIN_WEEK);
  const capacityReloadRef = useRef(null);

  const handleWindowReplace = useCallback((next) => {
    setWindow({
      fromYear: Number(next.fromYear),
      fromWeek: Number(next.fromWeek),
      toYear: Number(next.toYear),
      toWeek: Number(next.toWeek),
    });
  }, [setWindow]);

  const handlePeriodGrainChange = useCallback((value) => {
    setPeriodGrain(value === RCCP_PERIOD_GRAIN_MONTH ? RCCP_PERIOD_GRAIN_MONTH : RCCP_PERIOD_GRAIN_WEEK);
  }, []);

  const handlePlanningDateModesChange = useCallback((value) => {
    setPlanningDateModes(value);
  }, [setPlanningDateModes]);

  const chartVisibility = useMemo(() => ({
    savedKeys: chartVisibleKeys,
    onChange: setChartVisibleKeys,
    ready: windowLoaded,
  }), [chartVisibleKeys, setChartVisibleKeys, windowLoaded]);

  const chartView = useMemo(() => resolveRccpChartView({
    grain: periodGrain,
    periods,
    chart: analysis?.chart,
    cells,
  }), [periodGrain, periods, analysis?.chart, cells]);

  const {
    selectedItems, items: itemNumbers, filteredChart, handleItemChange,
    extraColumns, extraValues,
  } = useRccpItemFilter(chartView.chart, analysis?.config?.itemPickerColumnKeys);

  const filteredCellMap = useMemo(
    () => filterRccpMatrixByItem(chartView.cellMap, {
      chart: filteredChart,
      measureRows,
      active: selectedItems.length > 0,
    }),
    [chartView.cellMap, filteredChart, measureRows, selectedItems],
  );

  // Tweede load-date-serie (beide toggles aan): dezelfde week- of maandweergave en dezelfde
  // item-filter, uit de al geladen analyse van de andere leverdatum.
  const secondaryMode = secondaryRccpPlanningDateMode(planningDateModes);
  const secondaryAnalysis = secondaryMode ? analysisByMode?.[secondaryMode] : null;
  const secondaryChartView = useMemo(
    () => (secondaryAnalysis
      ? resolveRccpChartView({
        grain: periodGrain,
        periods: secondaryAnalysis.periods,
        chart: secondaryAnalysis.chart,
        cells: secondaryAnalysis.cells,
      })
      : null),
    [secondaryAnalysis, periodGrain],
  );
  const secondaryFilteredChart = useMemo(
    () => (secondaryChartView
      ? filterRccpChartByItem(secondaryChartView.chart, selectedItems)
      : null),
    [secondaryChartView, selectedItems],
  );
  const secondaryFilteredCellMap = useMemo(
    () => (secondaryChartView
      ? filterRccpMatrixByItem(secondaryChartView.cellMap, {
        chart: secondaryFilteredChart,
        measureRows,
        active: selectedItems.length > 0,
      })
      : null),
    [secondaryChartView, secondaryFilteredChart, measureRows, selectedItems],
  );

  const handleOpenSettings = useCallback(() => setSettingsOpen(true), []);
  const handleCloseSettings = useCallback(() => setSettingsOpen(false), []);
  // Ná het opslaan van RCCP-instellingen moet de analyse (incl. kpis/kpisAll) opnieuw worden
  // opgehaald — anders blijven de KPI-kaarten de waarden van vóór de wijziging tonen (zie
  // RccpSettingsFlyout.handleSave, dat alleen onSaved?.() aanroept).
  const handleSettingsSaved = useCallback(() => reload(), [reload]);
  const handleCapacityChanged = useCallback(() => reload(), [reload]);
  const handleImportCompleted = useCallback(() => {
    setActiveTab('capacity-planning');
    reload();
  }, [reload]);

  const handleTabSelect = useCallback((_, data) => {
    setActiveTab(data.value);
  }, []);

  const dashboardMatrix = useMemo(() => ({
    measureRows,
    periods: chartView.periods,
    cellMap: filteredCellMap,
    cellMapSecondary: secondaryFilteredCellMap,
  }), [measureRows, chartView.periods, filteredCellMap, secondaryFilteredCellMap]);

  const handleShowDataWindow = useCallback(() => {
    if (analysis?.dataWindow) setWindow(analysis.dataWindow);
  }, [analysis, setWindow]);

  const handleRefresh = useCallback(() => {
    if (activeTab === 'capacity-planning') {
      capacityReloadRef.current?.();
      return;
    }
    reload();
  }, [activeTab, reload]);

  const handleRegisterCapacityReload = useCallback((fn) => {
    capacityReloadRef.current = fn;
  }, []);

  return (
    <div className={styles.root}>
      <RccpPageHeader activeTab={activeTab} onTabSelect={handleTabSelect} />

      <div className={styles.toolbar}>
        {!isSupplier && (
          <RccpVendorFilter
            value={vendorAccount || ''}
            onChange={handleVendorChange}
            vendors={vendors}
            vendorNames={vendorNames}
            loading={vendorsLoading}
            error={vendorsError}
            autoFocus={!hadPoFilterHandoff}
            onHighlightVendor={handleHighlightVendor}
          />
        )}
        {activeTab === 'dashboard' && (
          <RccpItemFilter
            value={selectedItems}
            onChange={handleItemChange}
            items={itemNumbers}
            extraColumns={extraColumns}
            extraValues={extraValues}
          />
        )}
        {activeTab === 'dashboard' && (
          <RccpWeekWindowFields
            window={window}
            onWindowReplace={handleWindowReplace}
            kpiWindowOnly={kpiWindowOnly}
            onKpiWindowOnlyChange={setKpiWindowOnly}
            periodGrain={periodGrain}
            onPeriodGrainChange={handlePeriodGrainChange}
            planningDateModes={planningDateModes}
            onPlanningDateModesChange={handlePlanningDateModesChange}
            analysis={analysis}
            onShowDataWindow={handleShowDataWindow}
          />
        )}
        <Button icon={<ArrowClockwise24Regular />} onClick={handleRefresh}>Refresh</Button>
        {isAdmin && (
          <Button icon={<Settings24Regular />} onClick={handleOpenSettings}>Settings</Button>
        )}
      </div>

      {!hasVendor && (
        <Text className={styles.hint}>
          Search for a vendor above to load the dashboard and capacity planning data.
        </Text>
      )}

      {activeTab === 'dashboard' && hasVendor && (
        <RccpDashboardCharts
          loading={loading}
          error={error}
          analysis={analysis}
          kpiWindowOnly={kpiWindowOnly}
          chart={filteredChart}
          chartSecondary={secondaryFilteredChart}
          matrix={dashboardMatrix}
          planningDateModes={planningDateModes}
          visibility={chartVisibility}
          interactive={false}
          onShowDataWindow={handleShowDataWindow}
        />
      )}

      {activeTab === 'capacity-planning' && (
        <RccpCapacityPlanningTab
          vendorAccount={isSupplier ? undefined : (vendorAccount || undefined)}
          enabled={activeTab === 'capacity-planning' && hasVendor}
          isAdmin={isAdmin}
          onImported={handleImportCompleted}
          onChanged={handleCapacityChanged}
          onRegisterReload={handleRegisterCapacityReload}
        />
      )}

      {isAdmin && (
        <RccpSettingsFlyout
          open={settingsOpen}
          onClose={handleCloseSettings}
          onSaved={handleSettingsSaved}
          readOnly={readOnly}
        />
      )}
    </div>
  );
}
