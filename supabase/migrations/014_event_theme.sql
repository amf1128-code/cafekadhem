-- Per-event theme. Each event picks the visual treatment used on its
-- detail page (and on the home page when admin_settings.theme is 'default'
-- and this is the next upcoming event). New events default to theme1 so
-- existing rows keep the editorial archival look.
ALTER TABLE events
  ADD COLUMN theme TEXT NOT NULL DEFAULT 'theme1'
    CHECK (theme IN ('theme1', 'theme2', 'theme3'));
