import { cellText, check, inspect, sheet } from '../../_lib/grade-lib.mjs';

const CATEGORIES = ['Rent', 'Groceries', 'Utilities', 'Transport', 'Internet', 'Insurance', 'Gym', 'Savings'];

export default async ({ workDir }) => {
  const book = inspect('xlsx', workDir, 'budget.xlsx');
  const rows = sheet(book, 'Budget');
  const assertions = [check('workbook', rows, book.error ?? (rows ? 'Budget sheet found' : `sheets: ${Object.keys(book.sheets ?? {}).join(', ')}`))];
  if (!rows) return { assertions };
  const labelled = rows.map(row => ({ label: cellText(row[0]).trim(), cells: row }));
  const missing = CATEGORIES.filter(name => !labelled.some(row => row.label.toLowerCase() === name.toLowerCase() && row.cells.slice(1).some(cell => typeof cell.v === 'number')));
  assertions.push(check('categories', missing.length === 0, missing.length ? `missing or non-numeric: ${missing.join(', ')}` : 'all categories present'));
  const total = labelled.find(row => /^total$/i.test(row.label));
  const formula = total?.cells.slice(1).map(cell => cell.f).find(Boolean) ?? '';
  assertions.push(check('total-formula', /SUM\s*\(/i.test(formula), total ? `total formula: ${formula || 'none (typed value)'}` : 'no Total row'));
  return { assertions };
};
