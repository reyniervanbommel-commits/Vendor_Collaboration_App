import { describe, expect, it } from 'vitest';
import { NO_DEFAULT_VIEW, pickStartupView } from './purchaseOrderStartupView';

describe('pickStartupView', () => {
  const views = [
    { id: 1, scope: 'personal', isDefault: false },
    { id: 2, scope: 'personal', isDefault: true },
    { id: 3, scope: 'global', isDefault: true },
    { id: 4, scope: 'vendor', isDefault: true },
  ];

  it('kiest voor staff de persoonlijke default view', () => {
    expect(pickStartupView(views, false).id).toBe(2);
  });

  it('kiest voor een supplier de vendor-default view', () => {
    expect(pickStartupView(views, true).id).toBe(4);
  });

  it('laat de eigen keuze van de gebruiker voorgaan', () => {
    expect(pickStartupView(views, false, '3').id).toBe(3);
    expect(pickStartupView(views, true, 1).id).toBe(1);
  });

  it('opent All orders als de gebruiker daarvoor koos', () => {
    expect(pickStartupView(views, false, NO_DEFAULT_VIEW)).toBeNull();
    expect(pickStartupView(views, true, NO_DEFAULT_VIEW)).toBeNull();
  });

  it('valt terug op de scope-default als de gekozen view weg is', () => {
    expect(pickStartupView(views, false, '99').id).toBe(2);
  });
});
