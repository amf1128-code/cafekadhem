-- Site theme controlled by admin. Applies to all visitors.
ALTER TABLE admin_settings
  ADD COLUMN theme TEXT NOT NULL DEFAULT 'theme1'
    CHECK (theme IN ('theme1', 'theme2'));
