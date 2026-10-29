// Parses durations such as "2h", "45m" or "1h30m" into minutes.
export function parseDuration(text) {
  const match = /^(?:(\d+)h)?(?:(\d+)m)?$/.exec(text);
  if (!text || !match || (match[1] === undefined && match[2] === undefined)) throw new Error(`invalid duration: ${text}`);
  return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
}
