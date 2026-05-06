-- ============================================================
-- 034: Keep plus-one rows' status synchronized with their parent.
--
-- USER_FLOWS_SPEC.md §6 invariant I3 (plus-one status equals parent's),
-- and §4.1 rule (when parent leaves {yes, waitlisted}, plus-ones are removed).
--
-- Plus-ones reference the parent RSVP row via rsvps.plus_one_of (uuid → rsvps.id),
-- not the parent's guest_id. The trigger fires only on parent rows
-- (plus_one_of IS NULL) and only when status actually changed.
-- ============================================================

CREATE OR REPLACE FUNCTION sync_plus_one_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only act on parent rows.
  IF NEW.plus_one_of IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Only when status actually changed.
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('yes', 'waitlisted') THEN
    -- Mirror status onto plus-ones of this parent RSVP.
    -- waitlist_position carries through (plus-ones inherit the parent's place
    -- in the queue; not strictly correct but keeps invariant I3 simple).
    UPDATE rsvps
       SET status            = NEW.status,
           waitlist_position = NEW.waitlist_position,
           waitlisted_at     = NEW.waitlisted_at,
           updated_at        = now()
     WHERE plus_one_of = NEW.id;
  ELSE
    -- Parent went to 'maybe'/'no' — remove plus-ones for this parent.
    DELETE FROM rsvps WHERE plus_one_of = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rsvps_sync_plus_one ON rsvps;
CREATE TRIGGER rsvps_sync_plus_one
  AFTER UPDATE OF status ON rsvps
  FOR EACH ROW
  EXECUTE FUNCTION sync_plus_one_status();
