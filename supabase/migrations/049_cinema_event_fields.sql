-- ============================================================
-- 049: Cinema landing — extra display fields on events + menu_items.
--
-- Adds the optional copy fields the new poster/cinema landing
-- (/cinema) wants to surface per row. All nullable so existing
-- rows keep working unchanged; the landing falls back to defaults
-- when these are empty.
--
-- - events.display_arabic : Arabic display word shown over the
--   poster + on calendar rows (e.g. الكأس).
-- - events.tagline        : short italic line under the title in
--   the hero (1 sentence).
-- - events.highlights     : 2–3 short sentences describing the
--   event, rendered as bullet-ish lines in the hero rail.
-- - menu_items.display_arabic : Arabic display word shown next
--   to each menu cell (e.g. كنافة).
-- ============================================================

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS display_arabic TEXT,
  ADD COLUMN IF NOT EXISTS tagline TEXT,
  ADD COLUMN IF NOT EXISTS highlights TEXT;

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS display_arabic TEXT;

COMMENT ON COLUMN events.display_arabic IS 'Optional Arabic display word for poster overlays + calendar rows.';
COMMENT ON COLUMN events.tagline IS 'Short italic tagline shown under the event title in the cinema hero.';
COMMENT ON COLUMN events.highlights IS 'Plain-text bullets / 2-3 short sentences describing the event.';
COMMENT ON COLUMN menu_items.display_arabic IS 'Optional Arabic display word shown alongside the item name.';
