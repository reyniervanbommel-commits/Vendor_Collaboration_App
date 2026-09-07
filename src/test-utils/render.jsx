import { render } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { AuthContext } from '../context/AuthContext';

// Herbruikbare RTL-render-wrapper voor componenten die FluentProvider nodig
// hebben (context voor tokens/styling). Patroon overgenomen uit
// src/components/rccp/RccpVendorFilter.test.jsx.
//
// Optioneel `authUser` (bijv. { role: 'admin' }) wikkelt de UI ook in een
// AuthContext.Provider zodat componenten die `useAuth`/`useContext(AuthContext)`
// gebruiken (bijv. rol-afhankelijke UI) in tests werken zonder een echte
// AuthProvider (die een netwerkcall doet) te hoeven mounten.
export function renderWithFluent(ui, { authUser, ...options } = {}) {
  const tree = <FluentProvider theme={webLightTheme}>{ui}</FluentProvider>;
  if (!authUser) return render(tree, options);
  const authValue = { user: authUser, isAuthenticated: true, hasRole: (role) => authUser.role === role };
  return render(
    <AuthContext.Provider value={authValue}>{tree}</AuthContext.Provider>,
    options,
  );
}
