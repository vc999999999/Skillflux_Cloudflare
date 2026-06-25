import { deviceToken, randomId, sha256Hex, userCode } from "./crypto.js";
import { nowIso, runMigrations } from "./db.js";

export interface DeviceSessionRow {
  id: string;
  device_id_hash: string;
  agent: string;
  user_code: string;
  user_id: string | null;
  status: string;
  created_at: string;
  expires_at: string;
  completed_at: string | null;
}

export async function createDeviceSession(
  db: D1Database,
  deviceIdHash: string,
  agent: string,
  ttlMinutes = 15,
): Promise<DeviceSessionRow> {
  await runMigrations(db);
  const id = randomId("ds_");
  const code = userCode();
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();

  await db
    .prepare(
      `INSERT INTO device_sessions
       (id, device_id_hash, agent, user_code, status, created_at, expires_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .bind(id, deviceIdHash, agent, code, createdAt, expiresAt)
    .run();

  return {
    id,
    device_id_hash: deviceIdHash,
    agent,
    user_code: code,
    user_id: null,
    status: "pending",
    created_at: createdAt,
    expires_at: expiresAt,
    completed_at: null,
  };
}

export async function getDeviceSessionById(
  db: D1Database,
  id: string,
): Promise<DeviceSessionRow | null> {
  return db.prepare(`SELECT * FROM device_sessions WHERE id = ?`).bind(id).first<DeviceSessionRow>();
}

export async function getDeviceSessionByCode(
  db: D1Database,
  code: string,
): Promise<DeviceSessionRow | null> {
  return db
    .prepare(`SELECT * FROM device_sessions WHERE user_code = ?`)
    .bind(code)
    .first<DeviceSessionRow>();
}

export async function bindUserToSession(
  db: D1Database,
  sessionId: string,
  userId: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE device_sessions
       SET user_id = ?, status = 'authorized', completed_at = ?
       WHERE id = ?`,
    )
    .bind(userId, nowIso(), sessionId)
    .run();
}

export async function issueDeviceForSession(
  db: D1Database,
  session: DeviceSessionRow,
): Promise<{ token: string; deviceId: string }> {
  if (!session.user_id) {
    throw new Error("Session has no bound user");
  }

  const token = deviceToken();
  const tokenHash = await sha256Hex(token);
  const deviceRowId = randomId("dev_");
  const createdAt = nowIso();

  const existing = await db
    .prepare(`SELECT id FROM devices WHERE user_id = ? AND device_id_hash = ?`)
    .bind(session.user_id, session.device_id_hash)
    .first<{ id: string }>();

  if (existing) {
    await db
      .prepare(
        `UPDATE devices SET token_hash = ?, agent = ?, last_seen_at = ?, revoked_at = NULL
         WHERE id = ?`,
      )
      .bind(tokenHash, session.agent, createdAt, existing.id)
      .run();
    return { token, deviceId: existing.id };
  }

  await db
    .prepare(
      `INSERT INTO devices (id, user_id, device_id_hash, token_hash, agent, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(deviceRowId, session.user_id, session.device_id_hash, tokenHash, session.agent, createdAt, createdAt)
    .run();

  return { token, deviceId: deviceRowId };
}

export function sessionExpired(session: DeviceSessionRow): boolean {
  return Date.now() > Date.parse(session.expires_at);
}

export async function markSessionExpired(db: D1Database, sessionId: string): Promise<void> {
  await db
    .prepare(`UPDATE device_sessions SET status = 'expired' WHERE id = ?`)
    .bind(sessionId)
    .run();
}

export interface DeviceRow {
  id: string;
  user_id: string;
  device_id_hash: string;
  token_hash: string;
  agent: string;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
}

export async function getDeviceByTokenHash(
  db: D1Database,
  tokenHash: string,
): Promise<DeviceRow | null> {
  return db
    .prepare(`SELECT * FROM devices WHERE token_hash = ? AND revoked_at IS NULL`)
    .bind(tokenHash)
    .first<DeviceRow>();
}

export async function touchDevice(db: D1Database, deviceId: string): Promise<void> {
  await db
    .prepare(`UPDATE devices SET last_seen_at = ? WHERE id = ?`)
    .bind(nowIso(), deviceId)
    .run();
}
