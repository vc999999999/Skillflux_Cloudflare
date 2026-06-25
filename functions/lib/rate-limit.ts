import { nowIso, runMigrations } from "./db.js";

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 120;

export async function checkRateLimit(db: D1Database, key: string): Promise<boolean> {
  await runMigrations(db);
  const now = Date.now();
  const row = await db
    .prepare(`SELECT count, window_start FROM rate_limits WHERE key = ?`)
    .bind(key)
    .first<{ count: number; window_start: string }>();

  if (!row) {
    await db
      .prepare(`INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)`)
      .bind(key, nowIso())
      .run();
    return true;
  }

  const windowStart = Date.parse(row.window_start);
  if (now - windowStart > WINDOW_MS) {
    await db
      .prepare(`UPDATE rate_limits SET count = 1, window_start = ? WHERE key = ?`)
      .bind(nowIso(), key)
      .run();
    return true;
  }

  if (row.count >= MAX_REQUESTS) {
    return false;
  }

  await db
    .prepare(`UPDATE rate_limits SET count = count + 1 WHERE key = ?`)
    .bind(key)
    .run();
  return true;
}
