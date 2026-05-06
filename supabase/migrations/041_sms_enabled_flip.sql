-- ============================================================
-- 041: 10DLC approved (per user, 2026-05). Flip the global toggle.
--
-- This migration is idempotent — re-running has no effect after the
-- flag is true. If you need to disable SMS for any reason (billing
-- emergency, provider issue), set sms_enabled = false manually; the
-- send-notification fallback then routes everything to email.
-- ============================================================

UPDATE admin_settings SET sms_enabled = true;
