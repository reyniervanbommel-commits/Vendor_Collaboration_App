import React, {
  Suspense, createContext, lazy, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { ROLES } from '../../constants/roles';
import { useOnboardingState } from '../../hooks/useOnboardingState';
import { filterToursForRole, isTourDone, pageTourForPath } from '../../utils/tourSteps';
import { TOURS } from './tours';

// The visual parts are only needed once something opens, so they stay out of the shell bundle.
const GuidesDrawer = lazy(() => import('./GuidesDrawer'));
const TourCelebration = lazy(() => import('./TourCelebration'));
const TourOverlay = lazy(() => import('./TourOverlay'));
const TourPagePrompt = lazy(() => import('./TourPagePrompt'));
const WelcomeDialog = lazy(() => import('./WelcomeDialog'));

const PAGE_PROMPT_DELAY_MS = 1800;

const TourContext = createContext(null);

const NOOP_CONTEXT = Object.freeze({
  startPageTour: () => {},
  openGuides: () => {},
});

/** Tour actions for the app shell (header button, avatar menu). Safe outside the provider. */
export function useTour() {
  return useContext(TourContext) || NOOP_CONTEXT;
}

/**
 * Onboarding orchestration: welcome dialog on first login, a gentle per-page tour offer,
 * the Guides drawer and the active tour/guide overlay. Mounted once in AppInner so it survives
 * navigation between the data pages and /admin.
 */
export function TourProvider({ enabled, children }) {
  const { user, isAuthenticated } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const active = Boolean(enabled && isAuthenticated && user);
  const onboarding = useOnboardingState(active ? user.id : null);
  const { state, loaded, available, markTour, markWelcomeSeen, trackTourStep } = onboarding;

  const tours = useMemo(() => filterToursForRole(TOURS, user?.role), [user?.role]);
  const pageTour = useMemo(() => pageTourForPath(tours, location.pathname), [tours, location.pathname]);

  const [run, setRun] = useState(null); // { tour, stepIndex, direction }
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [guidesOpen, setGuidesOpen] = useState(false);
  const [promptVisible, setPromptVisible] = useState(false);
  const [quietThisSession, setQuietThisSession] = useState(false);
  const [celebration, setCelebration] = useState(null);

  // First login → welcome dialog.
  useEffect(() => {
    if (active && loaded && available && !state.welcomeSeenAt && !run) setWelcomeOpen(true);
  }, [active, available, loaded, run, state.welcomeSeenAt]);

  // Stop everything on logout.
  useEffect(() => {
    if (active) return;
    setRun(null);
    setWelcomeOpen(false);
    setGuidesOpen(false);
    setPromptVisible(false);
  }, [active]);

  // Offer the page tour once per page (after the welcome), a moment after the page settles.
  const shouldOfferPageTour = active && loaded && available && Boolean(state.welcomeSeenAt)
    && !run && !welcomeOpen && !guidesOpen && !quietThisSession
    && Boolean(pageTour) && !isTourDone(state, pageTour);
  useEffect(() => {
    setPromptVisible(false);
    if (!shouldOfferPageTour) return undefined;
    const timer = setTimeout(() => setPromptVisible(true), PAGE_PROMPT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [shouldOfferPageTour, pageTour]);

  const startTour = useCallback((tourId) => {
    const tour = tours.find((entry) => entry.id === tourId);
    if (!tour) return;
    setGuidesOpen(false);
    setWelcomeOpen(false);
    setPromptVisible(false);
    if (tour.route && tour.route !== location.pathname) navigate(tour.route);
    markTour(tour, 'in_progress', { step: 1, restart: true });
    setRun({ tour, stepIndex: 0, direction: 1 });
  }, [location.pathname, markTour, navigate, tours]);

  const startPageTour = useCallback(() => {
    startTour(pageTour ? pageTour.id : 'poBoard');
  }, [pageTour, startTour]);

  // Side effects stay out of state updaters (StrictMode runs updaters twice).
  const runRef = useRef(run);
  runRef.current = run;

  const goTo = useCallback((stepIndex, direction) => {
    const current = runRef.current;
    if (!current) return;
    trackTourStep(current.tour, stepIndex + 1);
    // Update the ref right away: optional steps can skip several times before the next render.
    runRef.current = { ...current, stepIndex, direction };
    setRun(runRef.current);
  }, [trackTourStep]);

  const finishTour = useCallback(() => {
    const current = runRef.current;
    if (!current) return;
    markTour(current.tour, 'completed', { step: current.tour.steps.length });
    setCelebration({ id: Date.now(), title: current.tour.title });
    setRun(null);
  }, [markTour]);

  const exitTour = useCallback(() => {
    const current = runRef.current;
    if (!current) return;
    markTour(current.tour, 'skipped', { step: current.stepIndex + 1 });
    setRun(null);
  }, [markTour]);

  const handleWelcomeStart = useCallback(() => {
    markWelcomeSeen();
    startPageTour();
  }, [markWelcomeSeen, startPageTour]);

  const handleWelcomeGuides = useCallback(() => {
    markWelcomeSeen();
    setWelcomeOpen(false);
    setGuidesOpen(true);
  }, [markWelcomeSeen]);

  const handleWelcomeDismiss = useCallback(() => {
    markWelcomeSeen();
    setWelcomeOpen(false);
    setQuietThisSession(true);
  }, [markWelcomeSeen]);

  const handlePromptDecline = useCallback(() => {
    if (pageTour) markTour(pageTour, 'skipped', { step: 0 });
    setPromptVisible(false);
  }, [markTour, pageTour]);

  const handlePromptClose = useCallback(() => {
    setPromptVisible(false);
    setQuietThisSession(true);
  }, []);

  const openGuides = useCallback(() => {
    setPromptVisible(false);
    setGuidesOpen(true);
  }, []);
  const closeGuides = useCallback(() => setGuidesOpen(false), []);
  const clearCelebration = useCallback(() => setCelebration(null), []);

  // Load a lazy dialog on first open, then keep it mounted so Fluent can play its close animation.
  const welcomeMountedRef = useRef(false);
  const guidesMountedRef = useRef(false);
  if (welcomeOpen) welcomeMountedRef.current = true;
  if (guidesOpen) guidesMountedRef.current = true;

  const contextValue = useMemo(() => ({
    startPageTour,
    openGuides,
  }), [openGuides, startPageTour]);

  return (
    <TourContext.Provider value={active ? contextValue : NOOP_CONTEXT}>
      {children}
      {active ? (
        <Suspense fallback={null}>
          {welcomeMountedRef.current ? (
            <WelcomeDialog
              open={welcomeOpen}
              user={user}
              showPowerTip={user.role !== ROLES.SUPPLIER}
              onStartTour={handleWelcomeStart}
              onBrowseGuides={handleWelcomeGuides}
              onDismiss={handleWelcomeDismiss}
            />
          ) : null}
          {guidesMountedRef.current ? (
            <GuidesDrawer
              open={guidesOpen}
              tours={tours}
              onboardingState={state}
              onStart={startTour}
              onClose={closeGuides}
            />
          ) : null}
          {promptVisible && pageTour ? (
            <TourPagePrompt
              tour={pageTour}
              onStart={startPageTour}
              onDecline={handlePromptDecline}
              onClose={handlePromptClose}
            />
          ) : null}
          {run ? (
            <TourOverlay
              key={run.tour.id}
              tour={run.tour}
              stepIndex={run.stepIndex}
              direction={run.direction}
              onGoTo={goTo}
              onFinish={finishTour}
              onExit={exitTour}
            />
          ) : null}
          {celebration ? (
            <TourCelebration key={celebration.id} title={celebration.title} onDone={clearCelebration} />
          ) : null}
        </Suspense>
      ) : null}
    </TourContext.Provider>
  );
}
