/** Pure semver precedence comparison (pure, no dependencies).
 * Mirrors mcp/src/semver.ts; both must stay in sync — the web side decides
 * "latest published version" and the client decides "newest installable
 * version", so divergence would point users at different versions. */
function compareNumericIdentifier(x: string, y: string): number {
  // Arbitrary-precision safe: longer digit strings are larger; equal length compares lexicographically.
  if (x.length !== y.length) return x.length < y.length ? -1 : 1;
  return x < y ? -1 : x > y ? 1 : 0;
}
export function compareSemver(left: string, right: string): number {
  const parts = (value: string) => { const base = value.split('+')[0]!; const at = base.indexOf('-'); return { core: (at < 0 ? base : base.slice(0, at)).split('.'), pre: at < 0 ? [] : base.slice(at + 1).split('.') }; };
  const a = parts(left), b = parts(right);
  for (let i = 0; i < 3; i++) {
    const x = a.core[i] ?? '0', y = b.core[i] ?? '0';
    if (x !== y) return compareNumericIdentifier(x, y);
  }
  if (!a.pre.length || !b.pre.length) return a.pre.length ? -1 : b.pre.length ? 1 : 0;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i], y = b.pre[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const xn = /^\d+$/.test(x!), yn = /^\d+$/.test(y!);
    if (xn && yn) return compareNumericIdentifier(x!, y!);
    if (xn !== yn) return xn ? -1 : 1;
    return x! < y! ? -1 : 1;
  }
  return 0;
}
