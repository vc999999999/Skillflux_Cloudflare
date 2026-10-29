import { cellText, check, inspect } from '../../_lib/grade-lib.mjs';

const REGIONS = ['North', 'South', 'East', 'West', 'Central'];

export default async ({ workDir }) => {
  const book = inspect('xlsx', workDir, 'quarterly.xlsx');
  const sheets = Object.values(book.sheets ?? {});
  const assertions = [check('workbook', sheets.length > 0, book.error ?? 'workbook opened')];
  if (!sheets.length) return { assertions };
  const rows = sheets[0];
  const header = rows[0]?.map(cell => cellText(cell).toLowerCase()) ?? [];
  const growthCol = header.findIndex(text => text.includes('growth'));
  const q1 = header.findIndex(text => text === 'q1');
  const q2 = header.findIndex(text => text === 'q2');
  const letter = index => String.fromCharCode(65 + index);
  const dataRows = rows.map((row, index) => ({ row, number: index + 1 })).filter(({ row }) => REGIONS.includes(cellText(row[0]).trim()));
  assertions.push(check('regions', dataRows.length === 5 && dataRows.every(({ row }) => typeof row[q1]?.v === 'number' && typeof row[q2]?.v === 'number'), `${dataRows.length} region rows; header ${header.join(' | ')}`));
  const formulas = dataRows.map(({ row, number }) => ({ number, f: growthCol >= 0 ? row[growthCol]?.f ?? '' : '' }));
  const good = formulas.filter(({ number, f }) => q1 >= 0 && q2 >= 0 && new RegExp(`\\$?${letter(q1)}\\$?${number}\\b`, 'i').test(f) && new RegExp(`\\$?${letter(q2)}\\$?${number}\\b`, 'i').test(f));
  assertions.push(check('growth-formulas', growthCol >= 0 && good.length === 5, growthCol < 0 ? 'no Growth column' : `${good.length}/5 rows have a formula using Q1 and Q2; e.g. ${formulas[0]?.f || 'none'}`));
  const formats = dataRows.map(({ row }) => row[growthCol]?.fmt ?? '');
  assertions.push(check('percent-format', growthCol >= 0 && formats.every(fmt => fmt.includes('%')), `formats: ${[...new Set(formats)].join(', ') || 'none'}`));
  return { assertions };
};
