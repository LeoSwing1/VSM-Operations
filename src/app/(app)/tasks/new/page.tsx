import { requireContext } from "@/lib/auth";
import { Card, Flash, PageHeader } from "@/components/ui";
import Link from "next/link";

export const metadata = { title: "New Task" };

export default async function NewTaskPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();

  return (
    <>
      <PageHeader title="New Task" />
      <Flash sp={sp} />

      <Card>
        <p className="text-muted">Task creation form will appear here.</p>
        <div className="mt-4">
          <Link href="/tasks" className="btn btn-sm btn-outline">
            Back to Tasks
          </Link>
        </div>
      </Card>
    </>
  );
}