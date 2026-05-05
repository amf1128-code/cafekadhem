-- Admin-controlled toggle for outbound SMS. Off by default so the live
-- site cannot send a single SMS until the operator flips this on (e.g.
-- after their 10DLC campaign approval lands). All three notification
-- edge functions (send-notification, send-invite, lookup-tickets) read
-- this column and refuse the SMS path when it is false; the public
-- forms hide the phone input and the SMS notification preference.
ALTER TABLE admin_settings
  ADD COLUMN IF NOT EXISTS sms_enabled BOOLEAN NOT NULL DEFAULT false;
