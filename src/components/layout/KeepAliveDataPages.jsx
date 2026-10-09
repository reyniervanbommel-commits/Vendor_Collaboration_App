import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { makeStyles, mergeClasses, shorthands, Spinner } from '@fluentui/react-components';
import { useAuth } from '../../context/AuthContext';
import { ROLES, STAFF_ROLES } from '../../constants/roles';
import { PageActiveContext } from '../../hooks/usePageActive';
import { recordApiTiming } from '../../utils/perf';
import PurchaseOrdersTableSkeleton from '../supplier/PurchaseOrdersTableSkeleton';

// Alleen dev/preview: meet hoe snel een pagina bij terugkeer weer geschilderd is (in de perf-HUD
// zichtbaar als "keepalive:return <pad>"). Vouwt in productie naar false → geen overhead.
const PERF_ENABLED = import.meta.env.DEV
  || import.meta.env.VITE_APP_ENV === 'dev'
  || import.meta.env.VITE_APP_ENV === 'preview';

// De drie zware datapagina's blijven hier lazy; ze worden pas geïmporteerd bij het eerste
// bezoek en daarna gemount gehouden (verborgen i.p.v. ge-unmount). Zo is terugkeren instant:
// geen her-mount van de Fluent-boom en geen herberekening van de board-pipeline/analyse.
const PurchaseOrdersPage = lazy(() =>
  import('../supplier').then((m) => ({ default: m.PurchaseOrdersPage })),
);
const RccpPage = lazy(() => import('../rccp/RccpPage'));
const BiPage = lazy(() => import('../bi').then((m) => ({ default: m.BiPage })));

// roles=null → elke ingelogde gebruiker. Anders alleen de genoemde rollen (rol-respect gelijk
// aan de oorspronkelijke per-route AuthGuards in App.jsx).
const PAGES = [
  { path: '/', Component: PurchaseOrdersPage, roles: null },
  { path: '/rccp', Component: RccpPage, roles: [...STAFF_ROLES, ROLES.SUPPLIER] },
  { path: '/bi', Component: BiPage, roles: [...STAFF_ROLES, ROLES.SUPPLIER] },
];

const useStyles = makeStyles({
  host: { height: '100%', minHeight: 0, minWidth: 0 },
  slot: { height: '100%', minHeight: 0, minWidth: 0 },
  slotHidden: { display: 'none' },
  loading: { display: 'flex', justifyContent: 'center', ...shorthands.padding('48px') },
  fallbackFill: { height: '100%', minHeight: 0, minWidth: 0, display: 'flex' },
});

function roleAllowed(roles, role) {
  return !Array.isArray(roles) || roles.length === 0 || roles.includes(role);
}

// Wrapper per pagina-slot: verborgen slots worden uit de a11y-/focus-boom gehaald (inert +
// aria-hidden) én krijgen display:none, zodat verborgen pagina's geen focus vangen. Bij terugkeer
// wordt (dev/preview) de tijd-tot-schilderen gemeten voor de perf-HUD.
function KeepAliveSlot({ active, path, className, children }) {
  const ref = useRef(null);
  const prevActiveRef = useRef(active);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.inert = !active;
      if (active) el.removeAttribute('aria-hidden');
      else el.setAttribute('aria-hidden', 'true');
    }
    const becameActive = active && prevActiveRef.current === false;
    prevActiveRef.current = active;
    if (!PERF_ENABLED || !becameActive) return undefined;
    const start = performance.now();
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        recordApiTiming({
          method: 'ui', path: `keepalive:return ${path}`, status: 0,
          ms: Math.round(performance.now() - start), at: Date.now(),
        });
      });
    });
    return () => { cancelAnimationFrame(raf1); if (raf2) cancelAnimationFrame(raf2); };
  }, [active, path]);
  return (
    <div ref={ref} className={className}>
      <PageActiveContext.Provider value={active}>
        {children}
      </PageActiveContext.Provider>
    </div>
  );
}

/**
 * Keep-alive container voor de datapagina's (/, /rccp, /bi). Mount elk bezocht pad één keer en
 * houdt het daarna verborgen gemount; alleen de actieve route is zichtbaar. Rol-controle gebeurt
 * per pagina (net als de vorige AuthGuards). Sessiecontrole zit in de omringende AuthGuard.
 */
export default function KeepAliveDataPages() {
  const styles = useStyles();
  const location = useLocation();
  const { user } = useAuth();
  const role = user?.role;

  const activeConfig = useMemo(
    () => PAGES.find((page) => page.path === location.pathname) || null,
    [location.pathname],
  );
  const activeAllowed = activeConfig ? roleAllowed(activeConfig.roles, role) : false;
  const activePath = activeConfig && activeAllowed ? activeConfig.path : null;

  // Alleen toegestane, daadwerkelijk bezochte paden worden gemount (mount-on-first-visit).
  const [visited, setVisited] = useState(() => (activePath ? [activePath] : []));
  useEffect(() => {
    if (!activePath) return;
    setVisited((prev) => (prev.includes(activePath) ? prev : [...prev, activePath]));
  }, [activePath]);

  const fallback = activePath === '/'
    ? (
      <div className={styles.fallbackFill}>
        <PurchaseOrdersTableSkeleton label="Loading purchase orders" />
      </div>
    )
    : (
      <div className={styles.loading}><Spinner label="Loading…" /></div>
    );

  return (
    <div className={styles.host}>
      {activeConfig && !activeAllowed ? <Navigate to="/" replace /> : null}
      <Suspense fallback={fallback}>
        {visited.map((path) => {
          const page = PAGES.find((entry) => entry.path === path);
          if (!page) return null;
          const { Component } = page;
          const active = path === activePath;
          return (
            <KeepAliveSlot
              key={path}
              path={path}
              active={active}
              className={active ? styles.slot : mergeClasses(styles.slot, styles.slotHidden)}
            >
              <Component />
            </KeepAliveSlot>
          );
        })}
      </Suspense>
    </div>
  );
}
