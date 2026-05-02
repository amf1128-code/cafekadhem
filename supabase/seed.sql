-- Seed initial admin settings
INSERT INTO admin_settings (venmo_handle, contact_email)
VALUES ('amf1128', NULL)
ON CONFLICT DO NOTHING;
