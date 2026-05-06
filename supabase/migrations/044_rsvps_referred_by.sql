-- ============================================================
-- 044: Soft attribution from share URLs (?ref=<inviter_guest_id>).
--
-- The frontend's ShareButton produces /events/:id?ref=<sharer_guest_id>.
-- When the recipient RSVPs, set_rsvp_referrer is called with that ref;
-- it writes referred_by_guest_id once (one-shot, never edited later).
--
-- Distinct from the invites table: invites are explicit opt-in records
-- with a notification side-effect; ?ref= is just attribution metadata.
-- USER_FLOWS_SPEC.md §3a.8.
-- ============================================================

ALTER TABLE rsvps
  ADD COLUMN IF NOT EXISTS referred_by_guest_id UUID
    REFERENCES guests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS rsvps_referred_by_idx
  ON rsvps (referred_by_guest_id) WHERE referred_by_guest_id IS NOT NULL;

CREATE OR REPLACE FUNCTION set_rsvp_referrer(
  p_event_id    UUID,
  p_guest_id    UUID,
  p_referrer_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- One-shot: only set if currently NULL. No self-referral.
  IF p_referrer_id IS NULL OR p_referrer_id = p_guest_id THEN
    RETURN;
  END IF;

  UPDATE rsvps
     SET referred_by_guest_id = p_referrer_id,
         updated_at = now()
   WHERE event_id = p_event_id
     AND guest_id = p_guest_id
     AND plus_one_of IS NULL
     AND referred_by_guest_id IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION set_rsvp_referrer(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_rsvp_referrer(UUID, UUID, UUID) TO anon, authenticated;
