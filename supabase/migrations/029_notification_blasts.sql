-- Notification blasts: admin-initiated bulk messages to event RSVPs/invitees.
-- Each blast stores both email copy (subject + body rendered into an HTML
-- template) and SMS copy so the admin can tailor the message per channel.
-- The event link is always appended by the edge function at send time.

create table if not exists notification_blasts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  -- Who receives this blast:
  --   yes_only      → rsvps with status = 'yes'
  --   yes_and_maybe → rsvps with status in ('yes','maybe')
  --   all_invited   → all rsvps regardless of status
  audience text not null check (audience in ('yes_only', 'yes_and_maybe', 'all_invited')),
  email_subject text not null,
  email_body text not null,
  sms_body text not null,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed')),
  sent_count int not null default 0,
  failed_count int not null default 0,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

alter table notification_blasts enable row level security;

-- Only authenticated users (admins) may read or write blasts.
create policy "admins can manage notification_blasts"
  on notification_blasts
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
