import { requireContext } from "@/lib/auth";
import { Card, Flash, PageHeader } from "@/components/ui";
import Link from "next/link";

export const metadata = { title: "New Meeting" };

export default async function NewMeetingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();

  return (
    <>
      <PageHeader title="New Meeting" />
      <Flash sp={sp} />

      <Card>
        <p className="text-muted">Meeting creation form will appear here.</p>
        <div className="mt-4">
          <Link href="/meetings" className="btn btn-sm btn-outline">
            Back to Meetings
          </Link>
        </div>
      </Card>
    </>
  );
}