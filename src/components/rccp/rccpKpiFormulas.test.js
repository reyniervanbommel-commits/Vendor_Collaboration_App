import { describe, expect, it } from 'vitest';
import { buildKpiFormulaText, KPI_FORMULAS } from './rccpKpiFormulas';

describe('buildKpiFormulaText', () => {
  it('falls back to the generic open/delivered wording without config', () => {
    expect(buildKpiFormulaText('ordered', null)).toBe(KPI_FORMULAS.ordered);
    // "ordered" in de teller/noemer is altijd "open + delivered" (matcht de server-berekening),
    // ook zonder config — dat is een verbetering t.o.v. de oude statische tekst.
    expect(buildKpiFormulaText('delivered', undefined)).toBe(
      'delivered\n% = delivered / open + delivered × 100',
    );
  });

  it('uses the user-defined measure labels from RCCP settings', () => {
    const config = {
      openMeasureKey: 'remainingPurchaseQuantity',
      deliveredMeasureKey: 'receivedPurchaseQuantity',
      quantityMeasures: [
        { columnKey: 'remainingPurchaseQuantity', label: 'Remaining qty' },
        { columnKey: 'receivedPurchaseQuantity', label: 'Received qty' },
      ],
    };
    expect(buildKpiFormulaText('ordered', config)).toBe(
      'Remaining qty + Received qty\non visible purchase-order lines',
    );
    expect(buildKpiFormulaText('delivered', config)).toBe(
      'Received qty\n% = Received qty / Remaining qty + Received qty × 100',
    );
    expect(buildKpiFormulaText('open', config)).toContain('Remaining qty');
  });

  it('keeps unknown KPI keys empty', () => {
    expect(buildKpiFormulaText('doesNotExist', {})).toBe('');
  });

  // "Planned date" verwarde vendors/admins (requested of confirmed?). De server gebruikt
  // hiervoor altijd de requested delivery date (dateColumnKey), nooit de confirmed date —
  // zie server/utils/rccpKpis.js walkRccpPoKpiLines. De tekst moet dat expliciet zeggen.
  it('spells out "requested delivery date" instead of the ambiguous "planned date"', () => {
    expect(buildKpiFormulaText('lateDelivery', null)).toContain('requested delivery date');
    expect(buildKpiFormulaText('lateDelivery', null)).not.toContain('planned date');
    expect(buildKpiFormulaText('onTime', null)).toContain('requested delivery date');
    expect(buildKpiFormulaText('openLate', null)).toContain('requested delivery date');
    expect(buildKpiFormulaText('planned1900', null)).toContain('requested delivery date');
    expect(buildKpiFormulaText('lateItems', null)).toContain('requested delivery date');
  });
});
