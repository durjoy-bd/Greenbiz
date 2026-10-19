-- Shop IDs preserve legacy user IDs. All business-owned rows now cascade via shops.
CREATE TABLE shops (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE INDEX shops_owner ON shops(owner_id,created_at,id);
INSERT INTO shops(id,owner_id,created_at) SELECT w.user_id,w.user_id,u.created_at FROM workspaces w JOIN users u ON u.id=w.user_id;

-- Rebuild foreign keys inside the migration transaction without disabling enforcement.
CREATE TEMP TABLE saved_workspaces AS SELECT * FROM workspaces;
CREATE TEMP TABLE saved_orders AS SELECT * FROM orders;
CREATE TEMP TABLE saved_offers AS SELECT * FROM offers;
CREATE TEMP TABLE saved_interests AS SELECT * FROM interests;
CREATE TEMP TABLE saved_idempotency AS SELECT * FROM idempotency;
CREATE TEMP TABLE saved_claims AS SELECT * FROM payment_claims;
DROP TABLE interests;
DROP TABLE offers;
DROP TABLE orders;
DROP TABLE idempotency;
DROP TABLE payment_claims;
DROP TABLE workspaces;

CREATE TABLE workspaces (
  user_id TEXT PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
  document TEXT NOT NULL CHECK(json_valid(document)),
  updated_at TEXT NOT NULL
);
CREATE TABLE offers (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  bank_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document TEXT NOT NULL CHECK(json_valid(document)),
  created_at TEXT NOT NULL
);
CREATE INDEX offers_business ON offers(business_id);
CREATE TABLE orders (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  document TEXT NOT NULL CHECK(json_valid(document)),
  payment_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX orders_owner ON orders(user_id);
CREATE TABLE idempotency (
  user_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  request_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  result_id TEXT,
  PRIMARY KEY(user_id,request_key)
);
CREATE TABLE payment_claims (
  payment_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  trx_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX claims_trx ON payment_claims(trx_id);
CREATE TABLE interests (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(offer_id,business_id)
);
CREATE INDEX interests_business ON interests(business_id);
INSERT INTO workspaces SELECT * FROM saved_workspaces;
INSERT INTO offers SELECT * FROM saved_offers;
INSERT INTO orders SELECT * FROM saved_orders;
INSERT INTO idempotency SELECT * FROM saved_idempotency;
INSERT INTO payment_claims SELECT * FROM saved_claims;
INSERT INTO interests SELECT * FROM saved_interests;
DROP TABLE saved_workspaces;
DROP TABLE saved_orders;
DROP TABLE saved_offers;
DROP TABLE saved_interests;
DROP TABLE saved_idempotency;
DROP TABLE saved_claims;

-- Never evicted: a committed offline envelope survives app/server restarts.
CREATE TABLE sync_requests (
  shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(shop_id,request_id)
);
