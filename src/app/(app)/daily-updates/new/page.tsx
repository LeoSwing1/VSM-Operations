import { requireContext } from "@/lib/auth";
import { Card, Flash, PageHeader } from "@/components/ui";
import Link from "next/link";

export const metadata = { title: "New Daily Update" };

export default async function NewDailyUpdatePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();

  return (
    <>
      <PageHeader title="New Daily Update" />
      <Flash sp={sp} />

      <Card>
        <p className="text-muted">Daily update form will appear here.</p>
        <div className="mt-4">
          <Link href="/daily-updates" className="btn btn-sm btn-outline">
            Back to Updates
          </Link>
        </div>
      </Card>
    </>
  );
}