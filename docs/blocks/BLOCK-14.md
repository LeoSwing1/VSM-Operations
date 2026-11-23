# Block 14 — Real-Time Chat & Notification Infrastructure

## Delivered

- Added a browser-scoped Supabase client using the public anon key and authenticated SSR session.
- Replaced four-second chat polling with Supabase Realtime Postgres Changes for messages and reactions.
- Added private per-channel Realtime topics, member-authorized broadcast/presence policies, online member count and typing indicators.
- Added a 30-second visible-tab recovery refresh as a fallback for dropped or missed Realtime events.
- Added read receipt display based on the existing `chat_channel_members.last_read_at` field, with membership-row Realtime updates.
- Added real-time notification badge updates, in-app toast alerts and optional browser desktop notifications when permission has been granted.
- Added a user-initiated desktop notification permission control on the Notifications page.
- Kept existing server actions, RLS, chat moderation, attachments and database-generated chat notifications.
- Added migration `0019_realtime_chat_notifications.sql` and static regression tests.

## Security

- Browser Realtime uses the public anon key; no service-role key is shipped to the browser.
- Private `chat:<channel UUID>` topics are authorized by current organisation and active channel membership.
- Existing database RLS policies continue to govern message, reaction and notification rows.
- Notifications are filtered by `recipient_id` and their existing RLS policy.
- Moderation read-only users can still load messages through the authenticated API; they are not granted private channel membership by this block.

## Deployment

1. Apply `supabase/migrations/0019_realtime_chat_notifications.sql` to the Supabase project.
2. Confirm Supabase Realtime is enabled for the project and the `supabase_realtime` publication exists.
3. Deploy the updated Next.js application.
4. Test with two active members in the same channel: send messages, react, type, observe presence and verify read receipts.
5. Test notifications with two employees and verify only the recipient sees the toast and unread badge increment.
6. In a browser that supports desktop notifications, open Notifications and explicitly enable desktop alerts.

## Boundaries / not included

- Desktop alerts use the browser Notification API while the OPDesk app is open. This is not Web Push and does not deliver when the browser is fully closed.
- No service worker push subscription, VAPID keys, FCM/APNs or native mobile push delivery is included.
- Presence is ephemeral and reflects connected sessions; it is not an authoritative employee attendance signal.
- Read receipts are channel-level `last_read_at` based and do not provide per-message delivery/read states.
- No end-to-end encryption, voice/video calling, offline message queue or attachment malware scanning is included.
- Full Next.js build, Vitest, live Supabase Realtime authorization and two-user end-to-end tests require the configured project environment and were not executed in this workspace.
