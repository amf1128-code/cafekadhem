-- ============================================================
-- 051: Coming-soon state on events.
--
-- Adds a boolean that lets the operator publish an event for the
-- world to see (poster, date, location, tagline) while RSVP and
-- ticketing are still locked. The cinema landing + event detail
-- + calendar all read this and swap the RSVP/Reserve CTA for a
-- "more details to come" panel with a Jaya (جاية) tag.
--
-- Default true so every existing row keeps its current behavior.
-- ============================================================

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS is_rsvp_open BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN events.is_rsvp_open IS
  'When false, the event renders as a coming-soon teaser — info is visible but RSVP/ticketing is locked.';
