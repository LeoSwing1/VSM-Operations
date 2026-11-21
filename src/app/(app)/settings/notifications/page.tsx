export const metadata = {};

"use client";
import { Card, Flash, PageHeader } from "@/components/ui";
import { useForm } from "react-hook-form";
import { useTransition, useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { createClient } from "@supabase/ssr";

export default function NotificationsPage({ searchParams }: { searchParams: any }) {
  const [prefs, setPrefs] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchPrefs() {
      try {
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const { data: prefs } = await supabase
          .from("notification_preferences")
          .select("*")
          .eq("employee_id", session.user.user_metadata?.employee_id || "000")
          .single();

        setPrefs(prefs);
      } catch (e) {
        console.error("Failed to fetch notification prefs:", e);
      } finally {
        setLoading(false);
      }
    }

    fetchPrefs();
  }, [searchParams]);

  if (loading) {
    return (
      <>
        <PageHeader title="Notification Preferences" />
        <Card>
          <p className="text-muted italic">Loading notification preferences...</p>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Notification Preferences" />
      <Flash sp={searchParams} />

      <Card>
        <h3 className="font-medium mb-4">Delivery Methods</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Email Notifications</Label>
              <p className="text-xs text-muted">Receive notifications via email</p>
            </div>
            <Switch checked={prefs?.email_in_app ?? true} />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Push Notifications</Label>
              <p className="text-xs text-muted">Receive push notifications on your devices</p>
            </div>
            <Switch checked={prefs?.push_enabled ?? false} />
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
            <Label>Send daily digest at: {prefs?.email_digest_mode || "IMMEDIATE"}</Label>
          </div>
        </div>

        {prefs?.quiet_hours_start !== undefined && (
          <div className="mt-6">
            <h3 className="font-medium mb-4">Quiet Hours</h3>
            <p className="text-xs text-muted">
              {prefs.quiet_hours_start}:00 - {prefs.quiet_hours_end}:00
            </p>
          </div>
        )}
      </Card>
    </>
  );
}