// Beschrijft welke functies in de formule-kolom beschikbaar zijn. Wordt gebruikt om:
// - klikbare "insert"-knoppen te tonen in PurchaseOrderFormulaFunctionsHelp
// - de helpteksten in de formuledialoog consistent te houden met de server-engine
//   (server/utils/tableFormulaEngine.js — hier alleen metadata, geen rekenlogica).
export const FORMULA_FUNCTIONS_HELP = [
  {
    name: 'TODAY()',
    snippet: 'TODAY()',
    description: "Today's date. Combine with a date column to get a number of days, e.g. TODAY()-(deliverydate).",
  },
  {
    name: 'IF(condition;true;false)',
    snippet: 'IF(;;)',
    description: 'Returns one value if the condition is true, another if false.',
  },
  {
    name: 'AND(condition;condition;...)',
    snippet: 'AND(;)',
    description: 'True when all conditions are true; stops at the first false one. Also: (a)>5 AND (b)<10.',
  },
  {
    name: 'OR(condition;condition;...)',
    snippet: 'OR(;)',
    description: 'True when at least one condition is true; stops at the first true one. Also: (a)>5 OR (b)<10.',
  },
  {
    name: 'TRUE() / FALSE()',
    snippet: 'TRUE()',
    description: 'A fixed yes or no, useful as a default inside IF, AND or OR.',
  },
  {
    name: 'AFRONDEN(number;decimals)',
    snippet: 'AFRONDEN(;0)',
    description: 'Rounds a number, e.g. divide days by 7 and round to get whole weeks.',
  },
  {
    name: 'ABS(number)',
    snippet: 'ABS()',
    description: 'Absolute value, useful to ignore whether a delay is early or late.',
  },
  {
    name: 'MAX(number;number;...)',
    snippet: 'MAX(0;)',
    description: 'Largest of the given numbers, e.g. clamp a negative delay to 0.',
  },
  {
    name: 'MIN(number;number;...)',
    snippet: 'MIN(;)',
    description: 'Smallest of the given numbers.',
  },
  {
    name: 'NETWERKDAGEN(start;end)',
    snippet: 'NETWERKDAGEN(;)',
    description: 'Number of weekdays (Mon-Fri) between two dates, weekends excluded. Divide by 5 for work weeks.',
  },
];
