-- Migrations 022 and 023 added columns (admin_settings.sms_enabled,
-- rsvps.plus_one_of) without telling PostgREST. Without NOTIFY, the
-- REST API can keep serving the previously-cached schema for a while
-- and clients see rows that look like they're missing the new fields.
-- This catches up the cache so /rest/v1/rsvps returns plus_one_of and
-- /rest/v1/admin_settings returns sms_enabled on the next request.
NOTIFY pgrst, 'reload schema';
