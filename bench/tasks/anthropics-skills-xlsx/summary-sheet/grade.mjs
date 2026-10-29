import { cellText, check, inspect, sheet } from '../../_lib/grade-lib.mjs';

const PRODUCTS = ['Notebook', 'Pen', 'Stapler', 'Folder', 'Marker', 'Tape'];

export default async ({ workDir }) => {
  const book = inspect('xlsx', workDir, 'orders.xlsx');
  const orders = sheet(book, 'Orders');
  const summary = sheet(book, 'Summary');
  const found = (orders ?? []).map(row => cellText(row[0]).trim());
  const assertions = [check('orders-sheet', orders && PRODUCTS.every(name => found.includes(name)), book.error ?? (orders ? `products: ${found.slice(1).join(', ')}` : 'no Orders sheet'))];
  const formulas = (summary ?? []).flat().map(cell => cell.f).filter(Boolean);
  const referencing = formulas.filter(formula => /'?Orders'?!/i.test(formula));
  assertions.push(check('summary-formulas', summary && referencing.length >= 2, summary ? `${referencing.length} formula(s) reference Orders: ${referencing.slice(0, 3).join(' ; ')}` : 'no Summary sheet'));
  // Revenue: SUMPRODUCT over Orders, or a SUM over a per-row revenue column of Units*Price formulas.
  const orderFormulas = (orders ?? []).flat().map(cell => cell.f).filter(Boolean);
  const perRow = orderFormulas.filter(formula => /\b[B-C]\d+\s*\*\s*[B-C]\d+\b/i.test(formula)).length >= PRODUCTS.length;
  const revenue = referencing.some(formula => /SUMPRODUCT\s*\(/i.test(formula)) || (perRow && referencing.some(formula => /SUM\s*\(/i.test(formula)));
  assertions.push(check('revenue-formula', revenue, revenue ? 'revenue multiplies units by price' : 'no formula multiplies units by price'));
  return { assertions };
};
