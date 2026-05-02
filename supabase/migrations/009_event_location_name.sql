-- Split event location into a name (optional) and an address (required).
-- The existing `location` column becomes the address. Add `location_name`
-- as an optional display label that admins can show alongside the address.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS location_name TEXT;

-- Tell PostgREST to reload its schema cache so the new column is exposed via
-- the REST API immediately. Without this, the client gets
-- "Could not find the 'location_name' column of 'events' in the schema cache"
-- until PostgREST is restarted or the cache times out.
NOTIFY pgrst, 'reload schema';
