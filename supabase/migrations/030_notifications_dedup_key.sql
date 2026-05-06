-- ============================================================
-- 030: Idempotency for the notifications pipeline.
--
-- Commit 3 will wire send-notification to populate dedup_key per send.
-- Adding the column + partial unique index now so later code can
-- rely on it without a migration race.
--
-- USER_FLOWS_SPEC.md §7.2.
-- ============================================================

ALTER TABLE notifications_log
  ADD COLUMN IF NOT EXISTS dedup_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_log_dedup_unique
  ON notifications_log (dedup_key)
  WHERE dedup_key IS NOT NULL;

COMMENT ON COLUMN notifications_log.dedup_key IS
  'Idempotency key for send-notification. Format: <type>:<guest_id>:<event_id|null>:<bucket>. See USER_FLOWS_SPEC.md §7.2.';
