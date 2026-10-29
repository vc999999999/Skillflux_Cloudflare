// Parses durations such as "2h", "45m" or "1h30m" into minutes.
export function parseDuration(text) {
  const match = /^(\d+)(h|m)/.exec(text);
  if (!match) throw new Error(`invalid duration: ${text}`);
  const value = Number(match[1]);
  return match[2] === 'h' ? value * 60 : value;
}
