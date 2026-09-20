import React, { memo, useCallback, useEffect, useMemo } from 'react';
import { makeStyles, shorthands, tokens } from '@fluentui/react-components';
import { usePoBoardKpis } from '../../hooks/usePoBoardKpis';
import { useElementHeight } from '../../hooks/useElementHeight';
import { useIdleReady } from '../../hooks/useIdleReady';
import { useSplitPanelKpiKeys } from '../../hooks/useSplitPanelKpiToggle';
import {
  CLICKABLE_SPLIT_PANEL_KPI_KEYS, SPLIT_PANEL_KPI_LIMIT, resolveKpiCardProps,
} from './rccpKpiCardProps';
import { primaryRccpPlanningDateMode } from './rccpPeriodGrain';
import { resolveSplitPanelKpiColumns } from '../../utils/rccpSplitPanelColumns';
import KpiCardStyleProvider from './KpiCardStyleProvider';
import KpiCard from './RccpKpiCard';

const TILE_WIDTH = 124;
const TILE_HEIGHT = 108;
const TILE_GAP = 8;
const MAX_COLUMNS = 3;
const CLICKABLE_KEY_SET = new Set(CLICKABLE_SPLIT_PANEL_KPI_KEYS);

const useStyles = makeStyles({
  // 1 kolom bij voorkeur; grid-template-columns/rows worden hieronder dynamisch gezet zodra
  // de gemeten hoogte niet genoeg is voor alle tegels onder elkaar (max 3 kolommen, zie
  // resolveSplitPanelKpiColumns). 'grid-auto-flow: column' vult eerst de hele 1e kolom, dan
  // de 2e/3e, zodat de verdeling links-rechts altijd zo gelijk mogelijk blijft.
  panel: {
    display: 'grid',
    gridAutoFlow: 'column',
    height: '100%',
    flexShrink: 0,
    ...shorthands.gap(`${TILE_GAP}px`, `${TILE_GAP}px`),
  },
  tile: { height: `${TILE_HEIGHT}px`, width: `${TILE_WIDTH}px`, minWidth: 0 },
});

/**
 * Rechterdeel van de "Performance & Planning" tab op de PO-tabel-pagina: de KPI-tegels die de
 * admin per kaart heeft aangevinkt (vouw in het hoekje van elke KPI-kaart, zie KpiFormulaFold).
 * Gebruikt dezelfde per-order KPI-data en klik-naar-filter matching als de "KPIs"-tab
 * (PoBoardKpiStrip), zodat een klik zowel de PO-tabel als de Performance & Planning-grafiek
 * filtert (die volgt de tabel via de gedeelde zichtbare-ordernummers). Capaciteits-tegels
 * hebben geen per-order match-set en zijn dus wel zichtbaar maar niet klikbaar.
 */
function RccpSplitKpiPanel({ kpiKeys, orders, selectedKey, onKpiFilter, refreshKey, planningDateModes = null }) {
  const styles = useStyles();
  // Reageert meteen op een toggle via de kaart-vouw (zelfde sessie), zonder te wachten op de
  // volgende /rccp/analysis-herlading — zie useSplitPanelKpiToggle.js. `kpiKeys` (uit
  // analysis.config) blijft de fallback zolang er geen toggle is geweest.
  const liveKpiKeys = useSplitPanelKpiKeys(kpiKeys);
  // Kort uitgesteld (niet gelijktijdig met de RCCP-analyse/BI-call om dezelfde trage
  // PO-cache-tabel vragen) — de grafiek/matrix krijgt zo voorrang op de kleine tegels ernaast.
  const dataReady = useIdleReady();
  const {
    loading, kpis, kpisConfirmed, matchByKey, config, buildOverlay,
  } = usePoBoardKpis({ orders, refreshKey, enabled: dataReady });
  // Volgt dezelfde "load date"-toggle (Req./Conf.) als de grafiek op deze tab.
  const dateMode = primaryRccpPlanningDateMode(planningDateModes);
  const { ref: panelRef, height: panelHeight } = useElementHeight();

  const handleActivate = useCallback((key) => {
    onKpiFilter?.(key, matchByKey[key] || new Set(), { qtyOverlay: buildOverlay(key) });
  }, [matchByKey, onKpiFilter, buildOverlay]);

  // Houdt de overlay/match-set van een al-actieve KPI-filter vers zolang dit paneel gemount
  // is (zelfde patroon als PoBoardKpiStrip) — bv. wanneer de tabeldata ververst terwijl een
  // tegel al geselecteerd was via deze of de "KPIs"-tab.
  useEffect(() => {
    if (!selectedKey) return;
    onKpiFilter?.(selectedKey, matchByKey[selectedKey] || new Set(), {
      toggle: false,
      qtyOverlay: buildOverlay(selectedKey),
    });
  }, [matchByKey, onKpiFilter, selectedKey, buildOverlay]);

  const keys = (liveKpiKeys || []).slice(0, SPLIT_PANEL_KPI_LIMIT);
  const { columns, rows } = useMemo(
    () => resolveSplitPanelKpiColumns({
      tileCount: keys.length,
      containerHeight: panelHeight,
      tileHeight: TILE_HEIGHT,
      gap: TILE_GAP,
      maxColumns: MAX_COLUMNS,
    }),
    [keys.length, panelHeight],
  );
  if (loading || !kpis || !keys.length) return null;
  const clickable = Boolean(onKpiFilter);

  return (
    <KpiCardStyleProvider>
      <div
        className={styles.panel}
        ref={panelRef}
        style={{
          gridTemplateColumns: `repeat(${columns}, ${TILE_WIDTH}px)`,
          gridTemplateRows: `repeat(${rows}, ${TILE_HEIGHT}px)`,
        }}
        data-tour="rccp-split-kpi-panel"
      >
        {keys.map((key) => {
          const cardProps = resolveKpiCardProps(key, kpis, kpisConfirmed);
          if (!cardProps) return null;
          const isClickable = clickable && CLICKABLE_KEY_SET.has(key);
          return (
            <div key={key} className={styles.tile}>
              <KpiCard
                {...cardProps}
                compact
                selected={selectedKey === key}
                clickable={isClickable}
                onActivate={handleActivate}
                config={config}
                dateMode={dateMode}
              />
            </div>
          );
        })}
      </div>
    </KpiCardStyleProvider>
  );
}

export default memo(RccpSplitKpiPanel);
