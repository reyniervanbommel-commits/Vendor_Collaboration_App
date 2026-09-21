'use strict';

const {
  normalizeFormulaExpression,
  validateFormulaReferences,
  validateFormulaResultTypeCompatibility,
} = require('./tableColumnFormulaValidation');

const COLUMNS = [
  { key: 'qty', dataType: 'number', scope: 'master' },
  { key: 'total', dataType: 'number', scope: 'master' },
  { key: 'status', dataType: 'text', scope: 'master' },
  { key: 'approved', dataType: 'boolean', scope: 'master' },
];

// Valideert zoals de API het doet: normaliseren → referenties toetsen →
// proefevaluatie tegen het gekozen resultaattype.
function validate(expression, resultType = 'boolean') {
  const { expression: normalized, references } = normalizeFormulaExpression(expression);
  validateFormulaReferences(references, COLUMNS);
  validateFormulaResultTypeCompatibility(normalized, references, COLUMNS, resultType);
}

describe('tableColumnFormulaValidation — AND/OR', () => {
  it('accepteert een AND-formule in functievorm en in operatorvorm', () => {
    expect(() => validate("AND((status)='Open';(qty)>0)")).not.toThrow();
    expect(() => validate("(status)='Open' AND (qty)>0")).not.toThrow();
  });

  it('accepteert OR en de aliassen EN/OF', () => {
    expect(() => validate('OR((qty)>0;(total)>0)')).not.toThrow();
    expect(() => validate('(qty)>0 EN (total)>0')).not.toThrow();
    expect(() => validate('(qty)>0 OF (total)>0')).not.toThrow();
  });

  it('accepteert een AND-formule met result type Text via IF', () => {
    expect(() => validate("IF((status)='Open' AND (qty)>0;'ok';'no')", 'text')).not.toThrow();
  });

  it('verzamelt de referenties uit beide takken van een AND', () => {
    const { references } = normalizeFormulaExpression('(qty)>0 AND (total)>0');
    expect([...references].sort()).toEqual(['qty', 'total']);
  });

  it('weigert een onbekende kolom in de rechtertak van een AND', () => {
    expect(() => validate('(qty)>0 AND (onbekend)>0')).toThrow(/Unknown column reference/);
  });

  it('weigert een kapotte AND-formule', () => {
    expect(() => validate('(qty)>0 AND')).toThrow();
    expect(() => validate('AND()')).toThrow();
  });

  // Vastgelegd verschil, geen bug: de proefevaluatie gebruikt sample-waarden
  // (number = 10), dus de linkerkant van een AND is hier bijna altijd waar en
  // de rechterkant wórdt uitgerekend — terwijl die in productie juist kan
  // worden overgeslagen. Validatie is daarmee strenger dan de runtime, nooit
  // soepeler; een formule die opslaat kan dus niet alsnog op de rechtertak
  // stuklopen om een reden die hier al zichtbaar was.
  it('rekent de rechtertak wél uit bij de proefevaluatie (strenger dan runtime)', () => {
    // sample qty = 10, dus (qty)<>0 is waar en (total)/(qty) wordt geëvalueerd
    expect(() => validate('AND((qty)<>0;(total)/(qty)>1)')).not.toThrow();
  });

  it('een tak die met sample-waarden wordt overgeslagen blokkeert het opslaan niet', () => {
    // sample qty = 10, dus (qty)=0 is onwaar → deling door nul wordt hier nooit bereikt
    expect(() => validate('AND((qty)=0;(total)/(qty)>1)')).not.toThrow();
  });

  it('accepteert een boolean-kolom rechtstreeks als voorwaarde', () => {
    expect(() => validate('AND((approved);(qty)>0)')).not.toThrow();
  });
});
