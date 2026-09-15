import React, { useCallback, useMemo, useState } from 'react';
import { makeStyles, mergeClasses, shorthands, tokens } from '@fluentui/react-components';
import {
  Settings24Regular,
  Table24Regular,
} from '@fluentui/react-icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTour } from '../onboarding';
import RccpNavIcon from '../rccp/RccpNavIcon';
import { useVendorCompanyName } from '../../hooks/useVendorCompanyName';
import { layout as appLayoutTokens } from '../../styles/brandTokens';
import AppNavItem from './AppNavItem';
import AppShellHeader from './AppShellHeader';
import BulkWriteBackJobBadge from './BulkWriteBackJobBadge';
import { kickDataPagesPrefetch } from '../../utils/dataPagesPrefetch';

// Rail-items die de idle-prefetch mogen versnellen bij hover (toont intentie om te navigeren).
const PREFETCH_ON_HOVER_IDS = new Set(['rccp']);

const RAIL_WIDTH = appLayoutTokens.railWidth;
const PANEL_WIDTH = appLayoutTokens.panelWidth;
const HEADER_HEIGHT = `${appLayoutTokens.headerHeight}px`;

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', height: '100vh', minHeight: '100vh' },
  body: { flex: 1, display: 'flex', position: 'relative', minHeight: 0 },
  rail: {
    width: `${RAIL_WIDTH}px`,
    position: 'fixed',
    top: HEADER_HEIGHT,
    left: 0,
    height: `calc(100vh - ${HEADER_HEIGHT})`,
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.borderRight('1px', 'solid', tokens.colorNeutralStroke1),
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    paddingTop: '8px',
    ...shorthands.gap('4px'),
    zIndex: 1500,
    overflowX: 'visible',
  },
  railItem: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    '&:hover > [data-tooltip]': { opacity: 1, visibility: 'visible', transitionDelay: '0.7s' },
  },
  railTooltip: {
    position: 'absolute',
    left: '100%',
    top: '50%',
    transform: 'translateY(-50%)',
    marginLeft: '10px',
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    ...shorthands.padding('6px', '10px'),
    ...shorthands.borderRadius('4px'),
    boxShadow: tokens.shadow8,
    whiteSpace: 'nowrap',
    fontSize: '12px',
    fontWeight: 500,
    opacity: 0,
    visibility: 'hidden',
    transitionProperty: 'opacity, visibility',
    transitionDuration: '0.1s',
    transitionDelay: '0s',
    pointerEvents: 'none',
    zIndex: 2000,
  },
  panel: {
    position: 'fixed',
    top: HEADER_HEIGHT,
    left: `${RAIL_WIDTH}px`,
    width: `${PANEL_WIDTH}px`,
    height: `calc(100vh - ${HEADER_HEIGHT})`,
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.borderRight('1px', 'solid', tokens.colorNeutralStroke1),
    ...shorthands.padding('12px'),
    ...shorthands.gap('4px'),
    display: 'flex',
    flexDirection: 'column',
    boxShadow: tokens.shadow16,
    zIndex: 1800,
    overflowY: 'auto',
    transitionProperty: 'transform, opacity',
    transitionDuration: '140ms',
    transitionTimingFunction: 'ease-in-out',
  },
  panelBackdrop: { position: 'fixed', inset: 0, zIndex: 1700, backgroundColor: 'transparent' },
  navButton: {
    justifyContent: 'flex-start',
    width: '100%',
  },
  divider: {
    ...shorthands.borderTop('1px', 'solid', tokens.colorNeutralStroke2),
    marginTop: '8px',
    marginBottom: '8px',
    width: '100%',
  },
  dividerCompact: {
    width: '80%',
    marginLeft: 'auto',
    marginRight: 'auto',
  },
  main: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    marginLeft: `${RAIL_WIDTH}px`,
    ...shorthands.padding('24px'),
    backgroundColor: tokens.colorNeutralBackground1,
    overflowY: 'auto',
    overflowX: 'hidden',
    '@media (max-width: 768px)': {
      ...shorthands.padding('12px'),
    },
  },
  purchaseOrdersMain: {
    paddingTop: 0,
    '& > *': {
      marginTop: '-4px',
    },
    '@media (max-width: 768px)': {
      paddingTop: 0,
      '& > *': {
        marginTop: 0,
      },
    },
  },
  adminMain: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.padding(0),
    overflow: 'hidden',
    '@media (max-width: 768px)': {
      ...shorthands.padding(0),
    },
  },
});

export default function AppLayout({ children, isDarkMode, onToggleTheme }) {
  const styles = useStyles();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { startPageTour, openGuides } = useTour();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const vendorCompanyName = useVendorCompanyName(user);
  const isPurchaseOrdersRoute = location.pathname === '/';
  const isAdminRoute = location.pathname === '/admin';

  const navItems = useMemo(
    () => [
      { id: 'po', label: 'Master plan purchase orders', icon: Table24Regular, path: '/' },
      { id: 'rccp', label: 'Performance & Planning', icon: RccpNavIcon, path: '/rccp' },
      // BI-nav-item verborgen op verzoek (pagina + route blijven bestaan, alleen niet in de nav).
      { type: 'divider' },
      { id: 'admin', label: 'Settings', icon: Settings24Regular, path: '/admin' },
    ],
    []
  );

  const handleNavigate = useCallback(
    (path) => { navigate(path); setSidebarOpen(false); setUserMenuOpen(false); },
    [navigate]
  );

  // Toont de gebruiker intentie om naar RCCP/BI te gaan: start de idle-prefetch meteen in plaats
  // van te wachten tot de browser idle wordt. Geen effect als de PO-pagina deze sessie nog niet
  // is geladen (kickDataPagesPrefetch is dan een no-op).
  const handleItemMouseEnter = useCallback((item) => {
    if (PREFETCH_ON_HOVER_IDS.has(item.id)) kickDataPagesPrefetch();
  }, []);

  const handleToggleSidebar = useCallback(() => {
    setSidebarOpen((value) => !value);
  }, []);

  const handleCloseSidebar = useCallback(() => {
    setSidebarOpen(false);
  }, []);

  const handleToggleUserMenu = useCallback(() => {
    setUserMenuOpen((value) => !value);
  }, []);

  const handleCloseUserMenu = useCallback(() => {
    setUserMenuOpen(false);
  }, []);

  const handleLogout = useCallback(async () => {
    await logout();
    setUserMenuOpen(false);
    navigate('/login');
  }, [logout, navigate]);

  const handleNavigateAdmin = useCallback(() => {
    handleNavigate('/admin');
  }, [handleNavigate]);

  const handleStartTour = useCallback(() => {
    setUserMenuOpen(false);
    setSidebarOpen(false);
    startPageTour();
  }, [startPageTour]);

  const handleOpenGuides = useCallback(() => {
    setUserMenuOpen(false);
    setSidebarOpen(false);
    openGuides();
  }, [openGuides]);

  return (
    <div className={styles.root}>
      <AppShellHeader
        sidebarOpen={sidebarOpen}
        onToggleSidebar={handleToggleSidebar}
        isDarkMode={isDarkMode}
        onToggleTheme={onToggleTheme}
        user={user}
        userMenuOpen={userMenuOpen}
        onToggleUserMenu={handleToggleUserMenu}
        onCloseUserMenu={handleCloseUserMenu}
        canAccessAdmin
        vendorCompanyName={vendorCompanyName}
        onNavigateAdmin={handleNavigateAdmin}
        onLogout={handleLogout}
        onStartTour={handleStartTour}
        onOpenGuides={handleOpenGuides}
        endSlot={<BulkWriteBackJobBadge />}
      />

      <div className={styles.body}>
        {!sidebarOpen && (
          <aside className={styles.rail} aria-label="Primary navigation" data-tour="nav-rail">
            {navItems.map((item, index) => (
              <AppNavItem
                key={item.id || `divider-${index}`}
                item={item}
                compact
                active={location.pathname === item.path}
                styles={styles}
                onNavigate={handleNavigate}
                onItemMouseEnter={handleItemMouseEnter}
              />
            ))}
          </aside>
        )}

        {sidebarOpen && (
          <div className={styles.panelBackdrop} onClick={handleCloseSidebar} />
        )}

        {sidebarOpen && (
          <aside className={styles.panel} aria-label="Primary navigation">
            {navItems.map((item, index) => (
              <AppNavItem
                key={item.id || `divider-${index}`}
                item={item}
                compact={false}
                active={location.pathname === item.path}
                styles={styles}
                onNavigate={handleNavigate}
                onItemMouseEnter={handleItemMouseEnter}
              />
            ))}
          </aside>
        )}

        <main className={mergeClasses(
          styles.main,
          isPurchaseOrdersRoute ? styles.purchaseOrdersMain : undefined,
          isAdminRoute ? styles.adminMain : undefined,
        )}>{children}</main>
      </div>
    </div>
  );
}
