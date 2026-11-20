import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, Flash, PageHeader } from "@/components/ui";
import Link from "next/link";
import { PlusIcon } from "lucide-react";

export const metadata = { title: "Documents" };

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const sb = await supabaseServer();

  // Get documents user owns or has access to
  const { data: documents } = await sb.from("documents")
    .select(`
      id,
      title,
      mime_type,
      size_bytes,
      version,
      is_folder,
      created_at,
      updated_at,
      owner:employees!inner(full_name)
    `)
    .or(`owner_id.eq.${ctx.employee_id},document_shares!inner(employee_id).eq.${ctx.employee_id}`)
    .order("updated_at", { ascending: false })
    .limit(30);

  // Separate folders and files
  const folders = documents?.filter((d) => d.is_folder) || [];
  const files = documents?.filter((d) => !d.is_folder) || [];

  return (
    <>
      <PageHeader title="Documents" />
      <Flash sp={sp} />

      {(!documents || documents.length === 0) ? (
        <Card>
          <p className="text-muted">No documents found.</p>
        </Card>
      ) : (
        <div className="grid gap-6">
          {folders.length > 0 && (
            <>
              <h2 className="text-sm font-medium">Folders</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {folders.map((folder) => (
                  <Link key={folder.id} href={`/documents/${folder.id}`} className="card p-4 hover:border-ink/30 transition">
                    <div className="flex items-center gap-3">
                      <div className="rounded-md bg-muted p-2">
                        <svg className="h-5 w-5 text-muted-foreground" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M10 4v4h6V8l-3-3v4H10zm6 8v6H4v-6h18zm0-2H4v6h18V10z" />
                        </svg>
                      </div>
                      <div>
                        <h3 className="font-medium text-sm line-clamp-1">{folder.title}</h3>
                        <p className="text-xs text-muted">
                          {folder.version} • Updated {folder.updated_at ? new Date(folder.updated_at).toLocaleDateString() : ""}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </>
          )}

          {files.length > 0 && (
            <>
              <h2 className="text-sm font-medium">Files</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {files.map((file) => (
                  <Link key={file.id} href={file.id} className="card p-4 hover:border-ink/30 transition">
                    <div className="flex items-center gap-3">
                      <div className="rounded-md bg-muted p-2">
                        <svg className="h-5 w-5 text-muted-foreground" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-sm line-clamp-1">{file.title}</h3>
                        <p className="text-xs text-muted">
                          {file.mime_type} • v{file.version}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}