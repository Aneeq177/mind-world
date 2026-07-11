-- Migration 012: Track compare_calls_used per user
-- Allows server-side enforcement of the free-tier "See the difference" quota.
-- Column mirrors improve_calls_used; default 0 so existing rows are unaffected.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS compare_calls_used INTEGER NOT NULL DEFAULT 0;
