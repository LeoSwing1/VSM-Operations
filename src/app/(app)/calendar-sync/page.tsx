import { requireContext } from "@/lib/auth";
import { Card, Flash, PageHeader } from "@/components/ui";
import Link from "next/link";

export const metadata = { title: "Calendar Sync" };

export default async function CalendarSyncPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();

  return (
    <>
      <PageHeader title="Calendar Sync" />
      <Flash sp={sp} />

      <Card>
        <p className="text-muted">Google Calendar sync management page.</p>
        <div className="mt-4">
          <Link href="/settings/integrations" className="btn btn-sm btn-outline">
            Go to Integrations
          </Link>
        </div>
      </Card>
    </>
  );
}