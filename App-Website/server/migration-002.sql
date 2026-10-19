-- Migration 2: merchant expressions of interest; these are not lending applications.
CREATE TABLE interests (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(offer_id,business_id)
);
CREATE INDEX interests_business ON interests(business_id);
