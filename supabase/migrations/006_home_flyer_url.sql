-- Optional alternate flyer image used on the public home page card.
-- When null, the home card falls back to flyer_url (the full event-detail flyer).
ALTER TABLE events
  ADD COLUMN home_flyer_url TEXT;
