import { requireContext } from "@/lib/auth";
import { Card, Flash, PageHeader } from "@/components/ui";
import Link from "next/link";

export const metadata = { title: "New Leave Request" };

export default async function NewLeavePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();

  return (
    <>
      <PageHeader title="New Leave Request" />
      <Flash sp={sp} />

      <Card>
        <p className="text-muted">Leave request form will appear here.</p>
        <div className="mt-4">
          <Link href="/leave" className="btn btn-sm btn-outline">
            Back to Leave
          </Link>
        </div>
      </Card>
    </>
  );
}