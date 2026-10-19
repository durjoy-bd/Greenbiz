-- Migration 3: durable mutation result identity; old requests have no inferred result.
ALTER TABLE idempotency ADD COLUMN result_id TEXT;
