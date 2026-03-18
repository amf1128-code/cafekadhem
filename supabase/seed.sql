-- Seed initial admin settings
INSERT INTO admin_settings (venmo_handle, cafe_name, contact_email)
VALUES ('amf1128', 'Cafe Kadhem', NULL)
ON CONFLICT DO NOTHING;
