import { randomId } from "./crypto.js";
import { nowIso, runMigrations } from "./db.js";

export interface UserRow {
  id: string;
  provider: string;
  provider_user_id: string;
  email: string | null;
  created_at: string;
}

export async function upsertGitHubUser(
  db: D1Database,
  githubUser: { id: number; login: string; email?: string | null },
): Promise<UserRow> {
  await runMigrations(db);
  const providerUserId = String(githubUser.id);
  const existing = await db
    .prepare(`SELECT * FROM users WHERE provider = 'github' AND provider_user_id = ?`)
    .bind(providerUserId)
    .first<UserRow>();

  if (existing) {
    if (githubUser.email && githubUser.email !== existing.email) {
      await db
        .prepare(`UPDATE users SET email = ? WHERE id = ?`)
        .bind(githubUser.email, existing.id)
        .run();
      return { ...existing, email: githubUser.email };
    }
    return existing;
  }

  const id = randomId("usr_");
  const createdAt = nowIso();
  await db
    .prepare(
      `INSERT INTO users (id, provider, provider_user_id, email, created_at)
       VALUES (?, 'github', ?, ?, ?)`,
    )
    .bind(id, providerUserId, githubUser.email ?? null, createdAt)
    .run();

  return {
    id,
    provider: "github",
    provider_user_id: providerUserId,
    email: githubUser.email ?? null,
    created_at: createdAt,
  };
}

export async function getUserById(db: D1Database, userId: string): Promise<UserRow | null> {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).bind(userId).first<UserRow>();
}

export async function upsertFixtureUser(db: D1Database, email = "fixture@skillflux.dev"): Promise<UserRow> {
  await runMigrations(db);
  const existing = await db
    .prepare(`SELECT * FROM users WHERE provider = 'fixture' AND provider_user_id = 'fixture-user'`)
    .first<UserRow>();
  if (existing) return existing;

  const id = randomId("usr_");
  const createdAt = nowIso();
  await db
    .prepare(
      `INSERT INTO users (id, provider, provider_user_id, email, created_at)
       VALUES (?, 'fixture', 'fixture-user', ?, ?)`,
    )
    .bind(id, email, createdAt)
    .run();

  return {
    id,
    provider: "fixture",
    provider_user_id: "fixture-user",
    email,
    created_at: createdAt,
  };
}
