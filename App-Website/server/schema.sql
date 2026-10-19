-- Migration 1. Apply once, inside a transaction. Never edit an applied migration.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('merchant','bank')),
  created_at TEXT NOT NULL
);
CREATE TABLE workspaces (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  document TEXT NOT NULL CHECK(json_valid(document)),
  updated_at TEXT NOT NULL
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE offers (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bank_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document TEXT NOT NULL CHECK(json_valid(document)),
  created_at TEXT NOT NULL
);
CREATE INDEX offers_business ON offers(business_id);
CREATE TABLE orders (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document TEXT NOT NULL CHECK(json_valid(document)),
  payment_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX orders_owner ON orders(user_id);
CREATE TABLE idempotency (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id, request_key)
);
CREATE TABLE payment_claims (
  payment_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trx_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX claims_trx ON payment_claims(trx_id);
