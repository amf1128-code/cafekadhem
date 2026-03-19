-- Add gathering_number column to events table
-- This allows the admin to set a custom label like "No. 01", "No. 02", etc.
ALTER TABLE events ADD COLUMN gathering_number TEXT;
