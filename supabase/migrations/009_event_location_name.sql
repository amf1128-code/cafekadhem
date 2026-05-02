-- Split event location into a name (optional) and an address (required).
-- The existing `location` column becomes the address. Add `location_name`
-- as an optional display label that admins can show alongside the address.

ALTER TABLE events
  ADD COLUMN location_name TEXT;
