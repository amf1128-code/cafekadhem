-- ============================================================
-- 039: Add 'both' to notification_preference values.
--
-- Pre-existing CHECK constraint (from migration 001): values restricted
-- to ('sms', 'email', 'none'). We extend to include 'both', meaning
-- SMS for time-sensitive types and email for everything else (resolved
-- per-type by send-notification, see USER_FLOWS_SPEC.md §7.1).
--
-- 'none' stays in the enum as system-set only — it's written by STOP/
-- unsubscribe webhooks (migration 040) and is no longer offered to users
-- in the public form (commit 3 frontend changes).
-- ============================================================

ALTER TABLE guests
  DROP CONSTRAINT IF EXISTS guests_notification_preference_check;

ALTER TABLE guests
  ADD CONSTRAINT guests_notification_preference_check
  CHECK (notification_preference IN ('sms', 'email', 'both', 'none'));

COMMENT ON COLUMN guests.notification_preference IS
  $cmt$Channel preference: 'sms' (time-sensitive default), 'email', 'both' (per-type routing), or 'none' (system-set only on STOP/unsubscribe). USER_FLOWS_SPEC.md §7.1.$cmt$;
