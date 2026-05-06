-- ============================================================
-- 032: Track invite consumption + send attempts.
--
-- - consumed_by_guest_id: which guest ultimately RSVP'd from a session
--   that opened this token (attribution; non-blocking).
-- - send_attempt_n: increments when admin re-sends; used by send-notification's
--   dedup_key (USER_FLOWS_SPEC.md §7.2) so explicit resends actually go out.
-- - last_sent_at: when the invite notification last left.
-- - Partial unique index: at most one outstanding invite per
--   (event_id, inviter, target). Allows duplicate-token reuse on resend.
-- ============================================================

ALTER TABLE invites
  ADD COLUMN IF NOT EXISTS consumed_by_guest_id UUID REFERENCES guests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS send_attempt_n INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ;

-- Coalesce email/phone into one logical "target" so the unique
-- constraint matches whichever channel the invite uses.
CREATE UNIQUE INDEX IF NOT EXISTS invites_unique_target_idx
  ON invites (
    event_id,
    invited_by,
    COALESCE(lower(invited_email), invited_phone)
  );

COMMENT ON COLUMN invites.consumed_by_guest_id IS
  'guest_id that RSVPd from a session opened via this invite token. Set on first RSVP from that session; never blocks RSVP.';
COMMENT ON COLUMN invites.send_attempt_n IS
  'Increments on admin resend; appended to send-notification dedup_key.';
