/** RFC 4180 CSV with CRLF line endings and a header row. */
export function toCsv(header: string[], rows: Array<Array<string | number | boolean | null | undefined>>): string {
  const cell = (value: string | number | boolean | null | undefined) => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [header, ...rows].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
