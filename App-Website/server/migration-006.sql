-- Migration 6: one account model with roles, profiles, email verification, visible sessions,
-- persistent activity events and an append-only administrator audit trail.

-- Profiles and account state. `role` stays the account type (merchant or bank);
-- `access_role` is the permission level. `disabled_at` is superseded by `status`.
ALTER TABLE users ADD COLUMN full_name TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN location TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN organization TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN access_role TEXT NOT NULL DEFAULT 'user' CHECK(access_role IN ('user','admin','super_admin'));
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','deactivated'));
ALTER TABLE users ADD COLUMN status_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN status_changed_at TEXT;
ALTER TABLE users ADD COLUMN email_verified_at TEXT;
-- 1 = must verify before signing in. Accounts created before verification existed keep signing in (0).
ALTER TABLE users ADD COLUMN must_verify INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN last_activity_at TEXT;
ALTER TABLE users ADD COLUMN password_changed_at TEXT;
ALTER TABLE users ADD COLUMN mfa_secret TEXT;
ALTER TABLE users ADD COLUMN mfa_enabled_at TEXT;
ALTER TABLE users ADD COLUMN mfa_last_step INTEGER;
-- 1 only for a public demo account created on the server with "create-super-admin --demo".
ALTER TABLE users ADD COLUMN mfa_exempt INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN avatar_updated_at TEXT;

UPDATE users SET status = 'suspended', status_changed_at = disabled_at, status_reason = 'Suspended before 2.4 (no reason recorded)' WHERE disabled_at IS NOT NULL;
UPDATE users SET must_verify = 0;
-- A shop owner's own name, as they typed it into their first shop, becomes their profile name.
UPDATE users SET full_name = trim(coalesce((SELECT json_extract(w.document, '$.shop.owner') FROM workspaces w WHERE w.user_id = users.id), ''))
  WHERE role = 'merchant';
-- A recorded sign-in is the only activity known from before this release.
UPDATE users SET last_activity_at = last_login_at;

CREATE INDEX users_created ON users(created_at);
CREATE INDEX users_status ON users(status, created_at);
CREATE INDEX users_access_role ON users(access_role, created_at);
CREATE INDEX users_last_activity ON users(last_activity_at);
CREATE INDEX users_last_login ON users(last_login_at);
CREATE INDEX users_name ON users(full_name COLLATE NOCASE);

CREATE TABLE user_avatars (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK(content_type IN ('image/jpeg','image/png','image/webp')),
  data BLOB NOT NULL,
  updated_at TEXT NOT NULL
);

-- Shop names are copied out of the workspace document so they can be searched and listed quickly.
ALTER TABLE shops ADD COLUMN name TEXT NOT NULL DEFAULT '';
UPDATE shops SET name = coalesce((SELECT json_extract(w.document, '$.shop.name') FROM workspaces w WHERE w.user_id = shops.id), '');
CREATE INDEX shops_name ON shops(name COLLATE NOCASE);

-- Sessions get a public id (never the token hash) and coarse device and network details.
ALTER TABLE sessions ADD COLUMN id TEXT;
ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER;
ALTER TABLE sessions ADD COLUMN device TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN network TEXT NOT NULL DEFAULT '';
UPDATE sessions SET id = lower(hex(randomblob(16))), last_seen_at = created_at;
CREATE UNIQUE INDEX sessions_public_id ON sessions(id);

-- One-time links and sign-in challenges. Only a SHA-256 hash of each token is stored.
CREATE TABLE auth_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK(purpose IN ('verify_email','reset_password','change_email','mfa_challenge')),
  payload TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX auth_tokens_user ON auth_tokens(user_id, purpose, created_at);
CREATE INDEX auth_tokens_expiry ON auth_tokens(expires_at);

CREATE TABLE mfa_recovery_codes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at TEXT,
  PRIMARY KEY(user_id, code_hash)
);

-- Failed sign-ins per email address (hashed), for temporary lockouts.
CREATE TABLE login_throttle (
  key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL,
  window_started_at INTEGER NOT NULL,
  locked_until INTEGER
);

-- Admin panel sessions: separate cookie scoped to /api/admin, opened only after MFA.
DROP TABLE admin_sessions;
CREATE TABLE staff_sessions (
  token_hash TEXT PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  device TEXT NOT NULL DEFAULT '',
  network TEXT NOT NULL DEFAULT ''
);
CREATE INDEX staff_sessions_user ON staff_sessions(user_id);

-- Things the migration could not decide safely. Shown to Super Admins under System.
CREATE TABLE migration_review (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  reference TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

-- Administrators become Super Admin accounts (they could already manage everything), keeping
-- their id and password. An email already used by a customer account is never merged: whoever
-- set that customer password may not be the administrator.
INSERT INTO migration_review(id, kind, reference, detail, created_at)
  SELECT lower(hex(randomblob(16))), 'administrator_not_merged', a.id,
    'Administrator ' || a.email || ' was not converted because a customer account already uses this email (or id). Confirm who owns it, then grant access with "admin promote-super-admin" on the server.',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM administrators a
  WHERE EXISTS (SELECT 1 FROM users u WHERE u.email = a.email OR u.id = a.id);
INSERT INTO users(id, email, password_hash, role, created_at, last_login_at, last_activity_at, access_role, must_verify)
  SELECT a.id, a.email, a.password_hash, 'merchant', a.created_at, a.last_login_at, a.last_login_at, 'super_admin', 0
  FROM administrators a
  WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.email = a.email OR u.id = a.id);
-- Kept for reference only; nothing reads or writes it any more.
ALTER TABLE administrators RENAME TO legacy_administrators;

-- Persistent activity events. No foreign keys: the history outlives a deleted account until the
-- retention period removes it. Never holds passwords, tokens or request bodies.
CREATE TABLE activity_events (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  actor_id TEXT,
  action TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('success','failure')),
  description TEXT NOT NULL,
  record_type TEXT,
  record_id TEXT,
  shop_id TEXT,
  device TEXT NOT NULL DEFAULT '',
  network TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX activity_created ON activity_events(created_at);
CREATE INDEX activity_user ON activity_events(user_id, created_at);
CREATE INDEX activity_action ON activity_events(action, created_at);
CREATE TRIGGER activity_events_no_update BEFORE UPDATE ON activity_events
BEGIN SELECT RAISE(ABORT, 'Activity events cannot be changed'); END;

-- One row per account per Dhaka day with signed-in use: the basis for daily and monthly active users.
CREATE TABLE user_activity_days (
  day TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY(day, user_id)
);
CREATE INDEX activity_days_user ON user_activity_days(user_id, day);

-- The audit trail gains structure and becomes append-only for everyone, including the server.
ALTER TABLE admin_audit ADD COLUMN target_type TEXT NOT NULL DEFAULT '';
ALTER TABLE admin_audit ADD COLUMN reason TEXT NOT NULL DEFAULT '';
ALTER TABLE admin_audit ADD COLUMN before_state TEXT;
ALTER TABLE admin_audit ADD COLUMN after_state TEXT;
ALTER TABLE admin_audit ADD COLUMN outcome TEXT NOT NULL DEFAULT 'success' CHECK(outcome IN ('success','failure'));
ALTER TABLE admin_audit ADD COLUMN network TEXT NOT NULL DEFAULT '';
CREATE INDEX admin_audit_target ON admin_audit(target, created_at);
CREATE INDEX admin_audit_admin ON admin_audit(admin_id, created_at);
CREATE INDEX admin_audit_action ON admin_audit(action, created_at);
CREATE TRIGGER admin_audit_no_update BEFORE UPDATE ON admin_audit
BEGIN SELECT RAISE(ABORT, 'Audit records are append-only'); END;
CREATE TRIGGER admin_audit_no_delete BEFORE DELETE ON admin_audit
BEGIN SELECT RAISE(ABORT, 'Audit records are append-only'); END;

CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO app_settings(key, value) VALUES('activity_tracking_started_at', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
