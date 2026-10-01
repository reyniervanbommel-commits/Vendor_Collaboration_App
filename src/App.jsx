import React, { useState, useMemo, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { FluentProvider, makeStyles, Spinner } from '@fluentui/react-components';
import { createCustomTheme } from './theme/customTheme';
import AuthGuard from './components/auth/AuthGuard';
import IdleSessionGuard from './components/auth/IdleSessionGuard';
import LoginPage from './components/auth/LoginPage';
import { ROLES } from './constants/roles';
import { AppFooter, AppLayout, DevFeatureChecklist, DevPerfOverlay, KeepAliveDataPages } from './components/layout';
import { TourProvider } from './components/onboarding';
import AppToaster from './components/shared/AppToaster';
import CommentPermissionNotice from './components/shared/CommentPermissionNotice';
import SecretExpiryWarning from './components/shared/SecretExpiryWarning';
import { BulkWriteBackJobProvider } from './context/BulkWriteBackJobContext';
import { usePreventTrackpadNavigation } from './hooks/usePreventTrackpadNavigation';
import { useRouteAnalytics } from './hooks/useRouteAnalytics';

// Route-based code-splitting: de admin-module (incl. de zware recharts-bibliotheek), de
// hoofd-board-pagina en de secundaire auth-pagina's worden pas geladen wanneer hun route bezocht
// wordt. Zo bevat de initiële bundle enkel de shell + LoginPage. LoginPage blijft eager zodat de
// eerste (uitgelogde) render geen Suspense-flits geeft.
const SetPasswordPage = lazy(() => import('./components/auth/SetPasswordPage'));
const ForgotPasswordPage = lazy(() => import('./components/auth/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./components/auth/ResetPasswordPage'));
const MfaPage = lazy(() => import('./components/auth/MfaPage'));
const AdminPage = lazy(() => import('./components/admin/AdminPage'));
// De drie datapagina's (/, /rccp, /bi) worden via KeepAliveDataPages gemount-gehouden; hun
// lazy-imports staan daar. Zo delen ze één AppLayout-instantie en blijft terugkeren instant.

const AUTH_PATHS = new Set([
  '/login',
  '/set-password',
  '/forgot-password',
  '/reset-password',
  '/mfa',
]);

const useStyles = makeStyles({
  appShell: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
  },
  content: {
    flexGrow: 1,
  },
  routeFallback: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '60vh',
  },
});

function AppInner({ isDarkMode, onToggleTheme }) {
  const styles = useStyles();
  const location = useLocation();
  const showFooter = !AUTH_PATHS.has(location.pathname);
  const isDevEnvironment = import.meta.env.DEV || import.meta.env.VITE_APP_ENV === 'dev';
  // Perf-HUD ook op de preview tonen (niet in productie), zodat we daar de snelheid kunnen meten.
  const isPerfEnabled = isDevEnvironment || import.meta.env.VITE_APP_ENV === 'preview';
  useRouteAnalytics();

  // Eén gedeeld shell-element voor de drie datapagina's. Doordat /, /rccp en /bi hetzelfde
  // element renderen, houdt react-router AppLayout + KeepAliveDataPages gemount bij navigatie
  // tussen deze paden (geen unmount → instant terugkeren). Sessiecontrole via AuthGuard;
  // rol-controle per pagina in KeepAliveDataPages.
  const dataPagesElement = useMemo(
    () => (
      <AuthGuard>
        <AppLayout isDarkMode={isDarkMode} onToggleTheme={onToggleTheme}>
          <KeepAliveDataPages />
        </AppLayout>
      </AuthGuard>
    ),
    [isDarkMode, onToggleTheme],
  );

  return (
    <TourProvider enabled={showFooter}>
      <div className={styles.appShell}>
        <SecretExpiryWarning />
        <CommentPermissionNotice />
        <div className={styles.content}>
          <Suspense fallback={<div className={styles.routeFallback}><Spinner label="Loading…" /></div>}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/set-password" element={<SetPasswordPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/mfa" element={<MfaPage />} />
            <Route
              path="/admin"
              element={
                <AuthGuard allowedRoles={[ROLES.ADMIN, ROLES.EMPLOYEE, ROLES.SUPPLIER]}>
                  <AppLayout isDarkMode={isDarkMode} onToggleTheme={onToggleTheme}>
                    <AdminPage />
                  </AppLayout>
                </AuthGuard>
              }
            />
            <Route path="/bi" element={dataPagesElement} />
            <Route path="/rccp" element={dataPagesElement} />
            <Route path="/" element={dataPagesElement} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </div>

        {showFooter ? <AppFooter /> : null}
        <AppToaster />

        {isDevEnvironment ? <DevFeatureChecklist /> : null}
        {isPerfEnabled ? <DevPerfOverlay /> : null}
      </div>
    </TourProvider>
  );
}

export default function App() {
  usePreventTrackpadNavigation();
  const [isDarkMode, setIsDarkMode] = useState(false);
  // Memoiseer het theme-object zodat FluentProvider niet bij elke App-render een nieuw theme
  // krijgt (wat de hele Fluent-componentenboom onnodig zou hertekenen).
  const theme = useMemo(() => createCustomTheme(isDarkMode), [isDarkMode]);
  const handleToggleTheme = () => setIsDarkMode((v) => !v);

  return (
    <FluentProvider theme={theme}>
      <IdleSessionGuard />
      <BulkWriteBackJobProvider>
        <AppInner isDarkMode={isDarkMode} onToggleTheme={handleToggleTheme} />
      </BulkWriteBackJobProvider>
    </FluentProvider>
  );
}
