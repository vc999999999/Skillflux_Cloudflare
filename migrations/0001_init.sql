-- SkillFlux Registry D1 schema (P3)

CREATE TABLE IF NOT EXISTS users (
  id                TEXT PRIMARY KEY,
  provider          TEXT NOT NULL,
  provider_user_id  TEXT NOT NULL,
  email             TEXT,
  created_at        TEXT NOT NULL,
  UNIQUE(provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS device_sessions (
  id              TEXT PRIMARY KEY,
  device_id_hash  TEXT NOT NULL,
  agent           TEXT NOT NULL,
  user_code       TEXT NOT NULL UNIQUE,
  user_id         TEXT,
  status          TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  expires_at      TEXT NOT NULL,
  completed_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_device_sessions_user_code ON device_sessions(user_code);
CREATE INDEX IF NOT EXISTS idx_device_sessions_status ON device_sessions(status);

CREATE TABLE IF NOT EXISTS devices (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  device_id_hash  TEXT NOT NULL,
  token_hash      TEXT NOT NULL UNIQUE,
  agent           TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  last_seen_at    TEXT,
  revoked_at      TEXT,
  UNIQUE(user_id, device_id_hash)
);

CREATE INDEX IF NOT EXISTS idx_devices_token_hash ON devices(token_hash);

CREATE TABLE IF NOT EXISTS entitlements (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  product     TEXT NOT NULL,
  plan        TEXT NOT NULL,
  status      TEXT NOT NULL,
  source      TEXT NOT NULL,
  order_id    TEXT,
  created_at  TEXT NOT NULL,
  expires_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_entitlements_user_product ON entitlements(user_id, product, status);

CREATE TABLE IF NOT EXISTS checkout_sessions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  product         TEXT NOT NULL,
  provider        TEXT NOT NULL,
  provider_ref    TEXT,
  status          TEXT NOT NULL,
  checkout_url    TEXT,
  created_at      TEXT NOT NULL,
  completed_at    TEXT
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key         TEXT PRIMARY KEY,
  count       INTEGER NOT NULL,
  window_start TEXT NOT NULL
);
