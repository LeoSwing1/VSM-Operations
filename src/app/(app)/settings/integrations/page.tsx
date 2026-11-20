import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, Flash, PageHeader } from "@/components/ui";
import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings, MessageSquare, Calendar, Database, Bell } from "lucide-react";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const sb = await supabaseServer();

  // Get integrations
  const { data: integrations } = await sb.from("integrations")
    .select("*")
    .eq("org_id", ctx.org_id)
    .order("kind");

  // Get FCM tokens count
  const { count: fcmTokensCount } = await sb.from("fcm_tokens")
    .select("*", { count: "exact", head: true })
    .eq("employee_id", ctx.employee_id);

  // Map integrations by kind
  const integrationMap = new Map(integrations?.map((i) => [i.kind, i]) || []);

  const integrationConfig = [
    {
      key: "general",
      label: "General",
      icon: Settings,
      integrations: [
        {
          key: "GOOGLE_CALENDAR",
          name: "Google Calendar",
          description: "Sync meetings and events with Google Calendar",
          status: (integrationMap.get("GOOGLE_CALENDAR")?.status as string) || "DISCONNECTED",
        },
        {
          key: "SLACK",
          name: "Slack",
          description: "Connect Slack for team communications",
          status: (integrationMap.get("SLACK")?.status as string) || "DISCONNECTED",
        },
        {
          key: "TEAMS",
          name: "Microsoft Teams",
          description: "Integrate with Teams for meetings",
          status: (integrationMap.get("TEAMS")?.status as string) || "DISCONNECTED",
        },
      ],
    },
    {
      key: "notifications",
      label: "Push Notifications",
      icon: Bell,
      integrations: [
        {
          key: "FCM",
          name: "FCM Push",
          description: "Firebase Cloud Messaging for push notifications",
          status: "CONFIGURED",
          tokenCount: fcmTokensCount || 0,
        },
        {
          key: "RESEND",
          name: "Resend Email",
          description: "Email delivery via Resend",
          status: (integrationMap.get("RESEND")?.status as string) || "DISCONNECTED",
        },
      ],
    },
    {
      key: "storage",
      label: "Documents",
      icon: Database,
      integrations: [
        {
          key: "GOOGLE_DRIVE",
          name: "Google Drive",
          description: "Access Google Drive files",
          status: (integrationMap.get("GOOGLE_DRIVE")?.status as string) || "DISCONNECTED",
        },
        {
          key: "CUSTOM",
          name: "Custom Storage",
          description: "Configure custom file storage backend",
          status: (integrationMap.get("CUSTOM")?.status as string) || "DISCONNECTED",
        },
      ],
    },
    {
      key: "chat",
      label: "Chat",
      icon: MessageSquare,
      integrations: [
        {
          key: "WEBRTC",
          name: "WebRTC",
          description: "Enable WebRTC for real-time communications",
          status: "AVAILABLE",
        },
      ],
    },
  ];

  return (
    <>
      <PageHeader title="Integrations" />
      <Flash sp={sp} />

      <Tabs defaultValue="general" className="w-full">
        <TabsList className="mb-6">
          {integrationConfig.map((section) => (
            <TabsTrigger key={section.key} value={section.key}>
              <section.icon className="h-4 w-4 mr-2" />
              {section.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {integrationConfig.map((section) => (
          <TabsContent key={section.key} value={section.key}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {section.integrations.map((int) => (
                <Card key={int.key} className="hover:border-ink/30 transition">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h3 className="font-medium text-sm line-clamp-1">{int.name}</h3>
                      <p className="text-xs text-muted mt-1 line-clamp-2">
                        {int.description}
                      </p>
                      {int.tokenCount !== undefined && (
                        <p className="text-xs text-muted mt-2">
                          <span className="font-medium">{int.tokenCount}</span> device tokens registered
                        </p>
                      )}
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      int.status === "CONNECTED" ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" :
                      int.status === "CONFIGURED" ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" :
                      int.status === "AVAILABLE" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200" :
                      "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200"
                    }`}>
                      {int.status}
                    </span>
                  </div>
                  {int.status !== "CONNECTED" && int.status !== "CONFIGURED" && int.status !== "AVAILABLE" && (
                    <Link
                      href={`/settings/integrations/${int.key}`}
                      className="mt-3 block text-sm text-volt hover:text-volt/80"
                    >
                      Configure →
                    </Link>
                  )}
                </Card>
              ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </>
  );
}