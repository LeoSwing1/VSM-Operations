import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, Flash, PageHeader } from "@/components/ui";
import { useForm } from "react-hook-form";
import { useTransition } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export const metadata = { title: "Notification Preferences" };

interface NotificationPreferences {
  email_in_app: boolean;
  email_digest_mode: "IMMEDIATE" | "HOURLY" | "DAILY" | "WEEKLY";
  push_enabled: boolean;
  quiet_hours_start?: number;
  quiet_hours_end?: number;
}

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const sb = await supabaseServer();

  // Get user's notification preferences
  const { data: prefs } = await sb.from("notification_preferences")
    .select("*")
    .eq("employee_id", ctx.employee_id)
    .single();

  return (
    <>
      <PageHeader title="Notification Preferences" />
      <Flash sp={sp} />

      {prefs ? (
        <Card>
          <h3 className="font-medium mb-4">Delivery Methods</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">Email Notifications</Label>
                <p className="text-xs text-muted">Receive notifications via email</p>
              </div>
              <Switch checked={prefs.email_in_app ?? true} />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">Push Notifications</Label>
                <p className="text-xs text-muted">Receive push notifications on your devices</p>
              </div>
              <Switch checked={prefs.push_enabled ?? false} />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">In-App Notifications</Label>
                <p className="text-xs text-muted">Show notifications within the app</p>
              </div>
              <Checkbox checked={true} />
            </div>
          </div>

          <div className="mt-6">
            <h3 className="font-medium mb-4">Digest Schedule</h3>
            <div className="flex items-center justify-between">
              <Label>Send daily digest at: {prefs.email_digest_mode || "IMMEDIATE"}</Label>
            </div>
          </div>

          {prefs.quiet_hours_start !== undefined && (
            <div className="mt-6">
              <h3 className="font-medium mb-4">Quiet Hours</h3>
              <p className="text-xs text-muted">
                {prefs.quiet_hours_start}:00 - {prefs.quiet_hours_end}:00
              </p>
            </div>
          )}
        </Card>
      ) : (
        <Card>
          <p className="text-muted">No notification preferences configured.</p>
        </Card>
      )}
    </>
  );
}