'use strict';

const { compileFormula, evaluateCompiledFormula, extractFormulaReferences } = require('./tableFormulaEngine');

describe('tableFormulaEngine.compileFormula', () => {
  it('compileert een geldige ALS-formule en verzamelt refs', () => {
    const compiled = compileFormula("ALS((a)>(b);'Fout';(a)+(b))");
    expect(compiled).toHaveProperty('ast');
    expect([...compiled.references].sort()).toEqual(['a', 'b']);
  });

  it('geeft een syntaxfout bij ongeldige formule', () => {
    expect(() => compileFormula('ALS((a)>(b);1')).toThrow();
  });

  it('extraheert refs case-insensitive', () => {
    const refs = extractFormulaReferences("ALS((Budget)>(KOSTEN);'X';'Y')");
    expect(refs.sort()).toEqual(['budget', 'kosten']);
  });
});

describe('tableFormulaEngine.evaluateCompiledFormula', () => {
  it('rekent een ALS-formule correct uit', () => {
    const compiled = compileFormula("ALS((a)>(b);'Fout';(a)+(b))");
    const res = evaluateCompiledFormula(compiled, { a: 3, b: 5 }, { resultType: 'text' });
    expect(res).toEqual({ value: '8', error: null });
  });

  it('levert runtime-fout bij onbekende kolom', () => {
    const compiled = compileFormula('(bekend)+(onbekend)');
    const res = evaluateCompiledFormula(compiled, { bekend: 1 }, { resultType: 'number' });
    expect(res.value).toBeNull();
    expect(res.error).toContain('Unknown column reference');
  });

  it('levert runtime-fout bij deling door nul', () => {
    const compiled = compileFormula('(a)/(b)');
    const res = evaluateCompiledFormula(compiled, { a: 12, b: 0 }, { resultType: 'number' });
    expect(res.value).toBeNull();
    expect(res.error).toContain('Division by zero');
  });

  it('behandelt lege operand als 0', () => {
    const compiled = compileFormula('(a)+(b)');
    const res = evaluateCompiledFormula(compiled, { a: 7, b: null }, { resultType: 'number' });
    expect(res).toEqual({ value: 7, error: null });
  });

  it('ondersteunt datum plus getal', () => {
    const compiled = compileFormula('(start)+(dagen)');
    const res = evaluateCompiledFormula(
      compiled,
      { start: '2026-01-10T00:00:00.000Z', dagen: 2 },
      { resultType: 'date' }
    );
    expect(res.error).toBeNull();
    expect(res.value).toBe('2026-01-12T00:00:00.000Z');
  });

  it('ondersteunt datum min datum (dagen)', () => {
    const compiled = compileFormula('(eind)-(start)');
    const res = evaluateCompiledFormula(
      compiled,
      { start: '2026-01-10T00:00:00.000Z', eind: '2026-01-12T00:00:00.000Z' },
      { resultType: 'number' }
    );
    expect(res).toEqual({ value: 2, error: null });
  });

  it('cast naar boolean-resultaattype', () => {
    const compiled = compileFormula('(a)>(b)');
    const res = evaluateCompiledFormula(compiled, { a: 9, b: 3 }, { resultType: 'boolean' });
    expect(res).toEqual({ value: true, error: null });
  });

  it('ondersteunt IF als Engelse alias van ALS', () => {
    const compiled = compileFormula("IF((a)>(b);'groter';'kleiner')");
    const res = evaluateCompiledFormula(compiled, { a: 9, b: 3 }, { resultType: 'text' });
    expect(res).toEqual({ value: 'groter', error: null });
  });
});

describe('tableFormulaEngine — TODAY()', () => {
  it('gebruikt de meegegeven "today" i.p.v. de systeemklok', () => {
    const compiled = compileFormula('(TODAY())-(leverdatum)');
    const res = evaluateCompiledFormula(
      compiled,
      { leverdatum: '2026-07-10T00:00:00.000Z' },
      { resultType: 'number', today: new Date('2026-07-22T00:00:00.000Z') }
    );
    expect(res).toEqual({ value: 12, error: null });
  });

  it('valt terug op de systeemklok wanneer "today" niet is meegegeven', () => {
    const compiled = compileFormula('TODAY()');
    const res = evaluateCompiledFormula(compiled, {}, { resultType: 'date' });
    expect(res.error).toBeNull();
    expect(res.value).toMatch(/T00:00:00\.000Z$/);
  });

  it('dezelfde "today" geeft dezelfde uitkomst voor meerdere rijen (consistentie binnen één read)', () => {
    const compiled = compileFormula('(TODAY())-(leverdatum)');
    const today = new Date('2026-07-22T00:00:00.000Z');
    const rowA = evaluateCompiledFormula(compiled, { leverdatum: '2026-07-01T00:00:00.000Z' }, { resultType: 'number', today });
    const rowB = evaluateCompiledFormula(compiled, { leverdatum: '2026-07-15T00:00:00.000Z' }, { resultType: 'number', today });
    expect(rowA.value).toBe(21);
    expect(rowB.value).toBe(7);
  });
});

describe('tableFormulaEngine — AFRONDEN/ROUND, ABS, MAX, MIN', () => {
  const today = new Date('2026-07-22T00:00:00.000Z');

  it('zet dagen om naar hele weken met AFRONDEN', () => {
    const compiled = compileFormula('AFRONDEN(((TODAY())-(leverdatum))/7;0)');
    const res = evaluateCompiledFormula(
      compiled,
      { leverdatum: '2026-07-01T00:00:00.000Z' },
      { resultType: 'number', today }
    );
    // 21 dagen / 7 = 3 weken exact
    expect(res).toEqual({ value: 3, error: null });
  });

  it('AFRONDEN met decimalen, ROUND is een gelijkwaardig alias', () => {
    const compiledAfronden = compileFormula('AFRONDEN((getal);2)');
    const compiledRound = compileFormula('ROUND((getal);2)');
    const values = { getal: 3.14159 };
    expect(evaluateCompiledFormula(compiledAfronden, values, { resultType: 'number' }).value).toBe(3.14);
    expect(evaluateCompiledFormula(compiledRound, values, { resultType: 'number' }).value).toBe(3.14);
  });

  it('ABS levert een absolute waarde, ook voor te vroege leveringen', () => {
    const compiled = compileFormula('ABS((TODAY())-(leverdatum))');
    const res = evaluateCompiledFormula(
      compiled,
      { leverdatum: '2026-08-01T00:00:00.000Z' },
      { resultType: 'number', today }
    );
    expect(res).toEqual({ value: 10, error: null });
  });

  it('MAX clampt negatieve achterstand naar 0 (nog niet te laat)', () => {
    const compiled = compileFormula('MAX(0;(TODAY())-(leverdatum))');
    const res = evaluateCompiledFormula(
      compiled,
      { leverdatum: '2026-08-01T00:00:00.000Z' },
      { resultType: 'number', today }
    );
    expect(res).toEqual({ value: 0, error: null });
  });

  it('MIN geeft de kleinste van meerdere waarden', () => {
    const compiled = compileFormula('MIN((a);(b);(c))');
    const res = evaluateCompiledFormula(compiled, { a: 8, b: 3, c: 5 }, { resultType: 'number' });
    expect(res).toEqual({ value: 3, error: null });
  });

  it('geeft een duidelijke fout bij een onbekende functienaam', () => {
    const compiled = compileFormula('ONBEKEND((a))');
    const res = evaluateCompiledFormula(compiled, { a: 1 }, { resultType: 'number' });
    expect(res.value).toBeNull();
    expect(res.error).toContain("Unknown function 'ONBEKEND'");
  });

  it('geeft een duidelijke fout bij een verkeerd aantal argumenten', () => {
    const compiled = compileFormula('ABS((a);(b))');
    const res = evaluateCompiledFormula(compiled, { a: 1, b: 2 }, { resultType: 'number' });
    expect(res.value).toBeNull();
    expect(res.error).toContain('ABS expects 1 argument');
  });
});

describe('tableFormulaEngine — AND/OR', () => {
  const evalText = (expression, values, resultType = 'boolean') =>
    evaluateCompiledFormula(compileFormula(expression), values, { resultType });

  it('AND als functie: waar wanneer alle voorwaarden waar zijn', () => {
    const compiled = compileFormula('AND((a)>5;(b)<10)');
    expect(evaluateCompiledFormula(compiled, { a: 9, b: 3 }, { resultType: 'boolean' }).value).toBe(true);
    expect(evaluateCompiledFormula(compiled, { a: 9, b: 30 }, { resultType: 'boolean' }).value).toBe(false);
  });

  it('AND als operator geeft hetzelfde resultaat als de functievorm', () => {
    const values = { a: 9, b: 3 };
    expect(evalText('AND((a)>5;(b)<10)', values).value).toBe(true);
    expect(evalText('(a)>5 AND (b)<10', values).value).toBe(true);
    expect(evalText('(a)>5 AND (b)<10', { a: 1, b: 3 }).value).toBe(false);
  });

  it('OR als functie en als operator', () => {
    expect(evalText('OR((a)>5;(b)<10)', { a: 1, b: 3 }).value).toBe(true);
    expect(evalText('(a)>5 OR (b)<10', { a: 1, b: 3 }).value).toBe(true);
    expect(evalText('(a)>5 OR (b)<10', { a: 1, b: 30 }).value).toBe(false);
  });

  it('EN en OF zijn gelijkwaardige aliassen, in beide schrijfwijzen', () => {
    const values = { a: 9, b: 3 };
    expect(evalText('EN((a)>5;(b)<10)', values).value).toBe(true);
    expect(evalText('(a)>5 EN (b)<10', values).value).toBe(true);
    expect(evalText('OF((a)>5;(b)>100)', values).value).toBe(true);
    expect(evalText('(a)>5 OF (b)>100', values).value).toBe(true);
  });

  it('combineert met IF, functie en operator geven hetzelfde antwoord', () => {
    const values = { status: 'Open', qty: 4 };
    const viaFunction = evalText("IF(AND((status)='Open';(qty)>0);'ok';'no')", values, 'text');
    const viaOperator = evalText("IF((status)='Open' AND (qty)>0;'ok';'no')", values, 'text');
    expect(viaFunction).toEqual({ value: 'ok', error: null });
    expect(viaOperator).toEqual({ value: 'ok', error: null });
  });

  it('meer dan twee voorwaarden achter elkaar', () => {
    expect(evalText('(a)>0 AND (b)>0 AND (c)>0', { a: 1, b: 2, c: 3 }).value).toBe(true);
    expect(evalText('(a)>0 AND (b)>0 AND (c)>0', { a: 1, b: 2, c: 0 }).value).toBe(false);
  });

  it('AND bindt sterker dan OR: a OR b AND c = a OR (b AND c)', () => {
    expect(evalText('FALSE() OR TRUE() AND FALSE()').value).toBe(false);
    expect(evalText('TRUE() OR TRUE() AND FALSE()').value).toBe(true);
    expect(evalText('(FALSE() OR TRUE()) AND FALSE()').value).toBe(false);
  });

  it('vergelijkingen binden sterker dan AND, rekenen sterker dan vergelijken', () => {
    expect(evalText('(a)+1>2 AND (b)>0', { a: 5, b: 1 }).value).toBe(true);
    expect(evalText('(a)+1>2 AND (b)>0', { a: 0, b: 1 }).value).toBe(false);
  });

  it('short-circuit: de rechterkant wordt overgeslagen zodra links beslist', () => {
    // b = 0 zou "Division by zero" geven als het tweede argument wél werd uitgerekend
    expect(evalText('AND((b)<>0;(a)/(b)>1)', { a: 12, b: 0 })).toEqual({ value: false, error: null });
    expect(evalText('(b)<>0 AND (a)/(b)>1', { a: 12, b: 0 })).toEqual({ value: false, error: null });
    expect(evalText('OR((b)=0;(a)/(b)>1)', { a: 12, b: 0 })).toEqual({ value: true, error: null });
  });

  it('zonder short-circuit blijft een echte fout wél zichtbaar', () => {
    const res = evalText('AND((b)=0;(a)/(b)>1)', { a: 12, b: 0 });
    expect(res.value).toBeNull();
    expect(res.error).toContain('Division by zero');
  });

  it('TRUE/FALSE en WAAR/ONWAAR als literals', () => {
    expect(evalText('TRUE()').value).toBe(true);
    expect(evalText('FALSE()').value).toBe(false);
    expect(evalText('WAAR()').value).toBe(true);
    expect(evalText('ONWAAR()').value).toBe(false);
  });

  it('verzamelt kolomreferenties uit beide takken, ook de overgeslagen tak', () => {
    expect(extractFormulaReferences('(a)>5 AND (b)<10').sort()).toEqual(['a', 'b']);
    expect(extractFormulaReferences('OR((a)>5;(b)<10)').sort()).toEqual(['a', 'b']);
  });

  it('een kolom die letterlijk (and) heet blijft een kolomreferentie', () => {
    expect(evalText('(and) AND (b)>0', { and: true, b: 1 }).value).toBe(true);
    expect(extractFormulaReferences('(and) AND (b)>0').sort()).toEqual(['and', 'b']);
  });

  it('AND zonder argumenten geeft een nette fout via de dispatchtabel', () => {
    const res = evalText('AND()', {});
    expect(res.value).toBeNull();
    expect(res.error).toContain('AND expects 1-64 argument(s)');
  });

  it('een naam van Object.prototype is geen functie', () => {
    for (const name of ['CONSTRUCTOR', 'TOSTRING', 'HASOWNPROPERTY', 'VALUEOF']) {
      const res = evalText(`${name}()`, {});
      expect(res.value).toBeNull();
      expect(res.error).toContain('Unknown function');
    }
  });

  it('IF houdt zijn argumentcontrole na de verhuizing naar de dispatchtabel', () => {
    const res = evalText("IF((a)>1;'ja')", { a: 2 }, 'text');
    expect(res.value).toBeNull();
    expect(res.error).toContain('IF expects 3 argument(s)');
  });
});

describe('tableFormulaEngine — toBoolean via Yes/No-waarden', () => {
  const evalBool = (expression, values) =>
    evaluateCompiledFormula(compileFormula(expression), values, { resultType: 'boolean' }).value;

  it('leest Engelse Yes/No net zo goed als Nederlandse ja/nee', () => {
    expect(evalBool('AND((flag))', { flag: 'Yes' })).toBe(true);
    expect(evalBool('AND((flag))', { flag: 'No' })).toBe(false);
    expect(evalBool('AND((flag))', { flag: 'ja' })).toBe(true);
    expect(evalBool('AND((flag))', { flag: 'nee' })).toBe(false);
  });

  it('lege waarde is onwaar, een echte boolean werkt rechtstreeks', () => {
    expect(evalBool('AND((flag))', { flag: '' })).toBe(false);
    expect(evalBool('AND((flag))', { flag: null })).toBe(false);
    expect(evalBool('(flag) AND (other)', { flag: true, other: true })).toBe(true);
    expect(evalBool('(flag) AND (other)', { flag: true, other: false })).toBe(false);
  });
});

describe('tableFormulaEngine — NETWERKDAGEN/NETWORKDAYS (weekend uitgesloten)', () => {
  it('telt alleen de maandag mee tussen vrijdag en de maandag erna', () => {
    // vrijdag 3 juli t/m maandag 6 juli 2026: za+zo tellen niet mee, alleen de maandag = 1 werkdag
    const compiled = compileFormula('NETWERKDAGEN((start);(eind))');
    const res = evaluateCompiledFormula(
      compiled,
      { start: '2026-07-03T00:00:00.000Z', eind: '2026-07-06T00:00:00.000Z' },
      { resultType: 'number' }
    );
    expect(res).toEqual({ value: 1, error: null });
  });

  it('een volle kalenderweek (maandag t/m volgende maandag) is 5 werkdagen', () => {
    const compiled = compileFormula('NETWERKDAGEN((start);(eind))');
    const res = evaluateCompiledFormula(
      compiled,
      { start: '2026-07-06T00:00:00.000Z', eind: '2026-07-13T00:00:00.000Z' },
      { resultType: 'number' }
    );
    expect(res).toEqual({ value: 5, error: null });
  });

  it('4 kalenderweken (28 dagen) tussen twee maandagen = 20 werkdagen = 4 werkweken', () => {
    const compiled = compileFormula('AFRONDEN(NETWERKDAGEN((leverdatum);(TODAY()))/5;0)');
    const res = evaluateCompiledFormula(
      compiled,
      { leverdatum: '2026-06-22T00:00:00.000Z' },
      { resultType: 'number', today: new Date('2026-07-20T00:00:00.000Z') }
    );
    expect(res).toEqual({ value: 4, error: null });
  });

  it('geeft 0 bij dezelfde datum', () => {
    const compiled = compileFormula('NETWERKDAGEN((start);(eind))');
    const res = evaluateCompiledFormula(
      compiled,
      { start: '2026-07-06T00:00:00.000Z', eind: '2026-07-06T00:00:00.000Z' },
      { resultType: 'number' }
    );
    expect(res).toEqual({ value: 0, error: null });
  });

  it('geeft een negatief aantal wanneer eind vóór start ligt', () => {
    const compiled = compileFormula('NETWERKDAGEN((start);(eind))');
    const res = evaluateCompiledFormula(
      compiled,
      { start: '2026-07-06T00:00:00.000Z', eind: '2026-07-03T00:00:00.000Z' },
      { resultType: 'number' }
    );
    expect(res).toEqual({ value: -1, error: null });
  });

  it('NETWORKDAYS is een gelijkwaardige Engelse alias', () => {
    const compiled = compileFormula('NETWORKDAYS((start);(eind))');
    const res = evaluateCompiledFormula(
      compiled,
      { start: '2026-07-06T00:00:00.000Z', eind: '2026-07-13T00:00:00.000Z' },
      { resultType: 'number' }
    );
    expect(res).toEqual({ value: 5, error: null });
  });

  it('geeft een duidelijke fout wanneer een argument geen datum is', () => {
    const compiled = compileFormula('NETWERKDAGEN(5;(eind))');
    const res = evaluateCompiledFormula(compiled, { eind: '2026-07-06T00:00:00.000Z' }, { resultType: 'number' });
    expect(res.value).toBeNull();
    expect(res.error).toContain('must be a date');
  });
});
