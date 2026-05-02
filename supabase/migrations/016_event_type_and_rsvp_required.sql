-- Per-event "type" label and RSVP-required flag.
--
-- event_type is a free-form admin-entered string (e.g. "Watch Party",
-- "Pop-Up", "Darty") rendered above the event title on the home and
-- detail pages. NULL falls back to the generic "Cafe Kadhem" label so
-- existing rows keep working.
--
-- rsvp_required toggles the home-card label between "RSVP Required" and
-- "RSVP Requested". Defaults to TRUE so existing events keep their
-- previous wording.
ALTER TABLE events
  ADD COLUMN event_type TEXT,
  ADD COLUMN rsvp_required BOOLEAN NOT NULL DEFAULT TRUE;
