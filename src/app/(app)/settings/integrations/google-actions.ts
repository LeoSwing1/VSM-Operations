"use server";
import { z } from "zod";
import { requireContext, requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { dbMessage, flash, str } from "@/lib/actions";
import { drainCalendarQueue } from "@/lib/google/calendar-queue";
import { googleConnectionFor, hasScope } from "@/lib/google/oauth";
import { uploadToDrive } from "@/lib/google/drive";

const BACK = "/settings/integrations/google";

export async function saveGoogleSettings(fd: FormData) {
  const ctx = await requirePerm("settings.manage");
  const folder = str(fd, "drive_folder_id")
    .replace(/^.*folders\//, "")
    .replace(/[?#].*$/, "");
  const sender = str(fd, "gmail_sender_employee_id") || null;
  if (folder && !/^[A-Za-z0-9_-]{10,100}$/.test(folder)) flash(BACK, "err", "That doesn't look like a Drive folder ID or link.");
  if (sender) {
    const c = await googleConnectionFor(sender);
    if (!c || !hasScope(c, "gmail")) flash(BACK, "err", "That person hasn't connected Gmail sending yet.");
  }
  const sb = await supabaseServer();
  const { error } = await sb.from("google_workspace_settings").upsert({
    org_id: ctx.org_id,
    calendar_two_way: fd.get("calendar_two_way") === "on",
    drive_enabled: fd.get("drive_enabled") === "on",
    drive_folder_id: folder || null,
    gmail_sender_employee_id: sender,
    updated_by: ctx.employee_id,
    updated_at: new Date().toISOString(),
  });
  if (error) flash(BACK, "err", dbMessage(error));
  await sb.rpc("log_audit", {
    p_action: "google.settings_saved",
    p_entity: "organization",
    p_entity_id: ctx.org_id,
    p_metadata: { drive: !!folder, gmail: !!sender },
  });
  flash(BACK, "ok", "Google Workspace settings saved.");
}

export async function disconnectGoogle() {
  const ctx = await requireContext();
  const sb = await supabaseServer();
  const { error } = await sb.from("calendar_provider_connections").delete().eq("employee_id", ctx.employee_id).eq("provider", "GOOGLE");
  if (error) flash(BACK, "err", dbMessage(error));
  await sb.rpc("log_audit", { p_action: "google.disconnected", p_entity: "employee", p_entity_id: ctx.employee_id, p_metadata: {} });
  flash(BACK, "ok", "Google disconnected. Meetings already copied to your Google Calendar stay there.");
}

export async function runCalendarSyncNow() {
  await requirePerm("settings.manage");
  const r = await drainCalendarQueue(50);
  flash(BACK, "ok", `Calendar sync: ${r.calendarPushed} pushed, ${r.calendarFailed} failed, ${r.calendarSkipped} skipped.`);
}

/** Copies one employee document into the company Drive folder, using the caller's own Google connection. */
export async function copyDocumentToDrive(fd: FormData) {
  const ctx = await requirePerm("people.manage");
  const id = z.string().uuid().parse(str(fd, "id"));
  const back = `/people/${str(fd, "employee_id")}?tab=documents`;
  const sb = await supabaseServer();
  const [{ data: doc }, { data: gws }] = await Promise.all([
    sb.from("employee_documents").select("id, org_id, title, original_name, mime_type, storage_path").eq("id", id).maybeSingle(), // RLS check
    sb.from("google_workspace_settings").select("drive_enabled, drive_folder_id").eq("org_id", ctx.org_id).maybeSingle(),
  ]);
  if (!doc) flash(back, "err", "Document not found.");
  if (!gws?.drive_enabled || !gws.drive_folder_id) flash(back, "err", "Google Drive isn't set up (Settings → Integrations → Google).");
  const conn = await googleConnectionFor(ctx.employee_id);
  if (!conn || !hasScope(conn, "drive")) flash(back, "err", "Connect your Google Drive first (Settings → Integrations → Google).");
  const file = await supabaseAdmin().storage.from("employee-private").download(doc.storage_path);
  if (file.error || !file.data) flash(back, "err", "Couldn't read the document from storage.");
  try {
    const g = await uploadToDrive(
      conn,
      gws.drive_folder_id,
      doc.original_name,
      doc.mime_type,
      new Uint8Array(await file.data.arrayBuffer()),
    );
    await supabaseAdmin()
      .from("google_drive_files")
      .upsert(
        {
          org_id: ctx.org_id,
          employee_document_id: doc.id,
          drive_file_id: g.id,
          web_view_link: g.webViewLink ?? null,
          uploaded_by: ctx.employee_id,
        },
        { onConflict: "employee_document_id" },
      );
    await sb.rpc("log_audit", { p_action: "google.drive_copy", p_entity: "employee_document", p_entity_id: doc.id, p_metadata: {} });
  } catch (e) {
    flash(back, "err", (e as Error).message);
  }
  flash(back, "ok", `“${doc.title}” copied to Google Drive.`);
}
