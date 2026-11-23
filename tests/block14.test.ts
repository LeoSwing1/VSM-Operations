import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("Block 14 realtime chat and notification infrastructure", () => {
  it("authorizes private chat topics against current organisation membership", () => {
    const sql = read("../supabase/migrations/0019_realtime_chat_notifications.sql");
    expect(sql).toContain("can_access_chat_realtime_topic");
    expect(sql).toContain("current_org_id()");
    expect(sql).toContain("current_employee_id()");
    expect(sql).toContain("realtime.messages");
  });
  it("publishes chat reactions and notifications with old row values", () => {
    const sql = read("../supabase/migrations/0019_realtime_chat_notifications.sql");
    expect(sql).toContain("alter table public.notifications replica identity full");
    expect(sql).toContain("alter publication supabase_realtime add table public.chat_reactions");
    expect(sql).toContain("alter publication supabase_realtime add table public.notifications");
    expect(sql).toContain("alter publication supabase_realtime add table public.chat_channel_members");
  });
  it("uses private Supabase channels for presence and typing events", () => {
    const chat = read("../src/components/chat/chat-room.tsx");
    expect(chat).toContain("private: true");
    expect(chat).toContain('event: "typing"');
    expect(chat).toContain("presenceState");
    expect(chat).toContain("openChannel("); // channel cleanup lives in openChannel (src/lib/supabase/browser.ts)
    expect(read("../src/lib/supabase/browser.ts")).toContain("removeChannel(ch)");
  });
  it("updates unread counts and surfaces live notification alerts", () => {
    const notice = read("../src/components/notifications/realtime-unread.tsx");
    expect(notice).toContain('table: "notifications"');
    expect(notice).toContain("Notification.permission");
    expect(notice).toContain("setUnread");
  });
});
