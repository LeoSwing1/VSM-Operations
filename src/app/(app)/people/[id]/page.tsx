import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext, can, ROLE_LABEL, type Role } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { loadAttendance, minutesToHm } from "@/lib/data/attendance";
import { computeForEmployee } from "@/lib/data/performance";
import { Badge, Card, Empty, Flash, Meter, PageHeader, Stat, TableWrap, Tabs, inr } from "@/components/ui";
import { fmtDate, fmtDateTime, localDate, monthBounds } from "@/lib/engines/time";
import { firstSalaryDate, longDate, nextSalaryDate, ordinal } from "@/lib/engines/salary-day";
import { EmployeeFields } from "../employee-form";
import { LoginPanel } from "../login-panel";
import { copyDocumentToDrive } from "../../settings/integrations/google-actions";
import { resendInvite, updateEmployee, toggleOnboardingItem, addOnboardingItem, removeOnboardingItem, setOwner } from "../actions";
import { openDirectChat } from "../../chat/actions";
import { assignableRoles } from "@/lib/data/roles";
import {
  uploadEmployeeDocument,
  deleteEmployeeDocument,
  createProbationReview,
  updateProbationReview,
  addExitClearanceItem,
  toggleExitClearanceItem,
  issueEmployeeLetter,
  revokeEmployeeLetter,
} from "../actions";

export const metadata = { title: "Employee 360" };

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "onboarding", label: "Onboarding" },
  { key: "documents", label: "Documents" },
  { key: "letters", label: "Letters" },
  { key: "probation", label: "Probation" },
  { key: "exit", label: "Exit clearance" },
  { key: "attendance", label: "Attendance" },
  { key: "tasks", label: "Tasks" },
  { key: "updates", label: "Daily updates" },
  { key: "leave", label: "Leave" },
  { key: "performance", label: "Performance" },
  { key: "salary", label: "Salary" },
  { key: "kyc", label: "KYC" },
  { key: "assets", label: "Assets" },
  { key: "activity", label: "Activity" },
];

export default async function Employee360({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await requireContext();
  const sb = await supabaseServer();
  const { data: e, error: loadErr } = await sb
    .from("employees")
    .select(
      "*, department:departments!department_id(name), manager:employees!manager_id(id, full_name), shift:shifts(name, start_time, end_time)",
    )
    .eq("id", id)
    .maybeSingle();
  if (loadErr) throw new Error(`Profile could not load: ${loadErr.message}`); // a query problem, not "no access" — show it
  if (!e) {
    // Outside your access: show the basic company profile card (no salary, documents or personal details).
    const { data: card } = await sb.rpc("employee_card", { p_emp: id });
    if (!card) notFound();
    return <ProfileCard card={card as CardData} self={id === ctx.employee_id} />;
  }
  const self = id === ctx.employee_id;
  const manage = can(ctx, "people.manage");
  const salaryAllowed = self || can(ctx, "payroll.view_all");
  const tabs = [
    ...TABS.filter((t) => t.key !== "salary" || salaryAllowed)
      .filter((t) => t.key !== "activity" || self || manage || can(ctx, "audit.view") || can(ctx, "people.view_team"))
      .filter((t) => t.key !== "onboarding" || self || manage || can(ctx, "people.view_team"))
      .filter((t) => t.key !== "kyc" || self || can(ctx, "kyc.verify")),
    ...(manage ? [{ key: "edit", label: "Edit" }] : []),
  ];
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : "overview";
  const tz = ctx.timezone;
  const [{ data: canReset }, { data: teams }] = await Promise.all([
    sb.rpc("can_reset_password", { p_target: id }),
    sb.from("org_team_members").select("member_role, team:org_teams(name, chat_channel_id)").eq("employee_id", id),
  ]);
  const { start, end } = monthBounds(localDate(new Date(), tz));

  return (
    <>
      <PageHeader eyebrow={`${e.employee_code} · ${ROLE_LABEL[e.role as Role]}`} title={e.full_name}>
        <Badge>{e.status}</Badge>
        {e.role === "SUPER_ADMIN" && <Badge tone="green">PROTECTED · ONLY SUPER ADMIN</Badge>}
        {e.is_owner && <Badge tone="green">OWNER</Badge>}
        {ctx.role === "SUPER_ADMIN" && e.role === "ADMIN" && (
          <form action={setOwner}>
            <input type="hidden" name="id" value={e.id} />
            <input type="hidden" name="owner" value={e.is_owner ? "0" : "1"} />
            <button className="btn-ghost">{e.is_owner ? "Remove as co-owner" : "Make co-owner"}</button>
          </form>
        )}
        {e.is_demo && <Badge tone="amber">DEMO</Badge>}
      </PageHeader>
      <Flash sp={sp} />
      <Tabs tabs={tabs} active={tab} base={`/people/${id}`} />

      {tab === "overview" && (
        <Overview e={e} manage={manage} canReset={!!canReset} self={self} teams={(teams ?? []) as unknown as TeamRow[]} />
      )}
      {tab === "onboarding" && <OnboardingTab sb={sb} id={id} manage={manage} />}
      {tab === "documents" && <DocumentsTab sb={sb} id={id} manage={manage} />}
      {tab === "letters" && <LettersTab sb={sb} id={id} manage={manage} />}
      {tab === "probation" && <ProbationTab sb={sb} id={id} manage={manage} />}
      {tab === "exit" && <ExitTab sb={sb} id={id} manage={manage} />}
      {tab === "attendance" && <AttendanceTab sb={sb} id={id} start={start} end={end} tz={tz} />}
      {tab === "tasks" && <TasksTab sb={sb} id={id} tz={tz} />}
      {tab === "updates" && <UpdatesTab sb={sb} id={id} />}
      {tab === "leave" && <LeaveTab sb={sb} id={id} />}
      {tab === "performance" && <PerformanceTab sb={sb} id={id} start={start} end={end} tz={tz} />}
      {tab === "salary" && salaryAllowed && <SalaryTab sb={sb} id={id} />}
      {tab === "kyc" && (self || can(ctx, "kyc.verify")) && <KycTab sb={sb} id={id} self={self} />}
      {tab === "assets" && <AssetsTab sb={sb} id={id} tz={tz} />}
      {tab === "activity" && <ActivityTab sb={sb} id={id} tz={tz} />}
      {tab === "edit" && manage && (
        <EditTab sb={sb} e={e} assignable={await assignableRoles(sb, ctx)} canSalary={can(ctx, "people.salary_day")} />
      )}
    </>
  );
}

type SB = Awaited<ReturnType<typeof supabaseServer>>;

type TeamRow = { member_role: string; team: { name: string; chat_channel_id: string | null } | null };
function Overview({ e, manage, canReset, self, teams }: { e: any; manage: boolean; canReset: boolean; self: boolean; teams: TeamRow[] }) {
  const rows: [string, React.ReactNode][] = [
    [
      "Employee ID",
      <span key="id" className="font-mono font-semibold">
        {e.employee_code}
      </span>,
    ],
    [
      "Teams",
      teams.length
        ? teams.map((t, i) => (
            <span key={i} className="mr-2">
              {t.team?.chat_channel_id ? (
                <Link href={`/chat/${t.team.chat_channel_id}`} className="hover:text-volt">
                  {t.team?.name}
                </Link>
              ) : (
                t.team?.name
              )}
              {t.member_role === "LEAD" ? " (lead)" : ""}
            </span>
          ))
        : "—",
    ],
    ["Official email", e.official_email],
    ["Phone", e.phone ?? "—"],
    ["Designation", e.designation ?? "—"],
    ["Department", e.department?.name ?? "—"],
    [
      "Reporting manager",
      e.manager ? (
        <Link href={`/people/${e.manager.id}`} className="hover:text-volt">
          {e.manager.full_name}
        </Link>
      ) : (
        "—"
      ),
    ],
    ["Joining date", fmtDate(e.joining_date)],
    [
      "Salary day",
      e.salary_day
        ? `${ordinal(e.salary_day)} of every month · next ${fmtDate(nextSalaryDate(e.salary_day, localDate(new Date(), "Asia/Kolkata")))}`
        : "—",
    ],
    ["Employment", `${e.employment_type.replace("_", " ")}`],
    ["Work location", e.work_location ?? "—"],
    ["Shift", e.shift ? `${e.shift.name} (${e.shift.start_time.slice(0, 5)}–${e.shift.end_time.slice(0, 5)})` : "—"],
    ["Skills", e.skills?.length ? e.skills.join(", ") : "—"],
  ];
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card title="Profile" className="lg:col-span-2">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="mt-0.5 text-sm">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card title="Account">
        <p className="text-sm">{e.user_id ? "Sign-in linked." : "No sign-in yet."}</p>
        {!e.user_id && manage && !canReset && (
          <form action={resendInvite} className="mt-3">
            <input type="hidden" name="id" value={e.id} />
            <button className="btn-ghost">Send invitation</button>
          </form>
        )}
        {canReset && <LoginPanel id={e.id} email={e.official_email} hasLogin={!!e.user_id} />}
        {e.user_id && self && (
          <p className="mt-3 text-xs text-muted">
            To change your own password use{" "}
            <Link href="/login/reset" className="text-volt hover:underline">
              Change password
            </Link>
            .
          </p>
        )}
        {e.role === "SUPER_ADMIN" && !self && (
          <p className="mt-3 text-xs text-muted">The Super Admin&apos;s login and password are protected. Only they can change them.</p>
        )}
      </Card>
    </div>
  );
}

async function OnboardingTab({ sb, id, manage }: { sb: SB; id: string; manage: boolean }) {
  const { data: who } = await sb.from("employees").select("joining_date, salary_day").eq("id", id).maybeSingle();
  const dates =
    who?.joining_date && who?.salary_day ? (
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Joining date" value={longDate(who.joining_date)} />
        <Stat label="Salary date" value={`${ordinal(who.salary_day)} monthly`} />
        <Stat label="First salary" value={longDate(firstSalaryDate(who.salary_day, who.joining_date))} tone="volt" />
      </div>
    ) : null;
  const { data, error } = await sb
    .from("onboarding_checklist_items")
    .select("id,title,category,due_date,completed_at,completed_by")
    .eq("employee_id", id)
    .order("created_at");
  if (error)
    return (
      <>
        {dates}
        <Empty title="Onboarding checklist unavailable" hint="You do not have access to this employee's checklist." />
      </>
    );
  if (!data?.length && !manage)
    return (
      <>
        {dates}
        <Empty title="No onboarding checklist" hint="HR can add checklist items for this employee." />
      </>
    );
  const items = data ?? [];
  const done = items.filter((x) => x.completed_at).length;
  return (
    <Card title={`Onboarding · ${done}/${items.length} complete`}>
      {dates}
      <div className="mb-4 h-2 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-volt" style={{ width: `${(done / data.length) * 100}%` }} />
      </div>
      {manage && (
        <form action={addOnboardingItem} className="mb-4 grid gap-2 sm:grid-cols-[1fr_160px_150px_auto]">
          <input type="hidden" name="employee_id" value={id} />
          <input className="input" name="title" placeholder="Add onboarding task" required minLength={2} />
          <select className="input" name="category">
            {["DOCUMENTS", "IT_ACCESS", "HR_ORIENTATION", "TEAM_SETUP", "GENERAL"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <input className="input" type="date" name="due_date" />
          <button className="btn-primary">Add item</button>
        </form>
      )}
      <ul className="divide-y divide-line">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <p className={item.completed_at ? "text-muted line-through" : "font-medium"}>{item.title}</p>
              <p className="text-xs text-muted">
                {item.category.replaceAll("_", " ")}
                {item.due_date ? ` · Due ${fmtDate(item.due_date)}` : ""}
              </p>
            </div>
            <form action={toggleOnboardingItem} className="flex items-center gap-2">
              <input type="hidden" name="id" value={item.id} />
              <input type="hidden" name="employee_id" value={id} />
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" name="completed" defaultChecked={!!item.completed_at} />
                {item.completed_at ? "Completed" : "Mark complete"}
              </label>
              <button className="btn-ghost">Save</button>
              {manage && (
                <button formAction={removeOnboardingItem} formMethod="post" name="id" value={item.id} className="btn-ghost text-danger">
                  Remove
                </button>
              )}
            </form>
          </li>
        ))}
      </ul>
    </Card>
  );
}

async function DocumentsTab({ sb, id, manage }: { sb: SB; id: string; manage: boolean }) {
  const { data, error } = await sb
    .from("employee_documents")
    .select("id,title,category,original_name,mime_type,size_bytes,expires_on,storage_path,created_at")
    .eq("employee_id", id)
    .order("created_at", { ascending: false });
  if (error) return <Empty title="Documents unavailable" hint="You do not have access to these employee documents." />;
  const [{ data: gws }, { data: copies }] = await Promise.all([
    sb.from("google_workspace_settings").select("drive_enabled, drive_folder_id").maybeSingle(),
    sb
      .from("google_drive_files")
      .select("employee_document_id, web_view_link")
      .in(
        "employee_document_id",
        (data ?? []).map((d) => d.id),
      ),
  ]);
  const driveOn = !!gws?.drive_enabled && !!gws.drive_folder_id;
  const drive: Record<string, string | null> = Object.fromEntries((copies ?? []).map((c) => [c.employee_document_id, c.web_view_link]));
  const docs = await Promise.all(
    (data ?? []).map(async (d) => {
      const { data: signed } = await sb.storage.from("employee-private").createSignedUrl(d.storage_path, 60 * 5);
      return { ...d, url: signed?.signedUrl ?? null };
    }),
  );
  return (
    <div className="space-y-4">
      {manage && (
        <Card title="Upload confidential document">
          <form action={uploadEmployeeDocument} encType="multipart/form-data" className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="employee_id" value={id} />
            <label>
              <span className="label">Document title</span>
              <input className="input" name="title" required minLength={2} maxLength={160} placeholder="PAN card / Degree certificate" />
            </label>
            <label>
              <span className="label">Category</span>
              <select className="input" name="category">
                {["IDENTITY", "EDUCATION", "EMPLOYMENT", "TAX", "BANK", "POLICY", "OTHER"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">Expiry date (optional)</span>
              <input className="input" type="date" name="expires_on" />
            </label>
            <label>
              <span className="label">File · max 10 MB</span>
              <input className="input" type="file" name="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx" required />
            </label>
            <div className="sm:col-span-2">
              <button className="btn-primary">Upload securely</button>
              <p className="mt-1 text-xs text-muted">Stored in a private bucket. Signed download links expire after five minutes.</p>
            </div>
          </form>
        </Card>
      )}
      <Card title={`Employee documents · ${docs.length}`}>
        {!docs.length ? (
          <Empty title="No documents uploaded" hint="HR can securely attach employee documents here." />
        ) : (
          <div className="divide-y divide-line">
            {docs.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium">{d.title}</p>
                  <p className="text-xs text-muted">
                    {d.category} · {d.original_name} · {(d.size_bytes / 1024).toFixed(0)} KB
                    {d.expires_on ? ` · Expires ${fmtDate(d.expires_on)}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {d.url ? (
                    <a className="btn-ghost" href={d.url} target="_blank" rel="noreferrer">
                      View / download ↗
                    </a>
                  ) : (
                    <Badge>Unavailable</Badge>
                  )}
                  {manage &&
                    driveOn &&
                    (drive[d.id] ? (
                      <a className="btn-ghost" href={drive[d.id]!} target="_blank" rel="noreferrer">
                        In Drive ↗
                      </a>
                    ) : (
                      <form action={copyDocumentToDrive}>
                        <input type="hidden" name="id" value={d.id} />
                        <input type="hidden" name="employee_id" value={id} />
                        <button className="btn-ghost">Copy to Drive</button>
                      </form>
                    ))}
                  {manage && (
                    <form action={deleteEmployeeDocument}>
                      <input type="hidden" name="id" value={d.id} />
                      <input type="hidden" name="employee_id" value={id} />
                      <button className="btn-ghost text-danger">Delete</button>
                    </form>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

async function LettersTab({ sb, id, manage }: { sb: SB; id: string; manage: boolean }) {
  const { data, error } = await sb
    .from("employee_letters")
    .select("id,letter_type,reference_no,issued_on,status")
    .eq("employee_id", id)
    .order("issued_on", { ascending: false });
  if (error) return <Empty title="Employment letters unavailable" />;
  return (
    <div className="space-y-4">
      {manage && (
        <Card title="Issue employment letter">
          <form action={issueEmployeeLetter} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="employee_id" value={id} />
            <label className="min-w-56 flex-1">
              <span className="label">Letter type</span>
              <select className="input" name="letter_type">
                {["OFFER", "APPOINTMENT", "EXPERIENCE", "RELIEVING"].map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn-primary">Generate letter</button>
          </form>
          <p className="mt-2 text-xs text-muted">
            The letter stores a dated employee-data snapshot. Open it and use Print → Save as PDF for a printable copy. Experience and
            relieving letters require EXITED status.
          </p>
        </Card>
      )}
      <Card title={`Issued letters · ${data?.length ?? 0}`}>
        {!data?.length ? (
          <Empty title="No employment letters issued" />
        ) : (
          <div className="divide-y divide-line">
            {data.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium">{l.letter_type.replaceAll("_", " ")}</p>
                  <p className="text-xs text-muted">
                    {l.reference_no} · {fmtDate(l.issued_on)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge>{l.status}</Badge>
                  {l.status === "ISSUED" && (
                    <Link className="btn-ghost" href={`/people/${id}/letters/${l.id}`}>
                      Open / print ↗
                    </Link>
                  )}
                  {manage && l.status === "ISSUED" && (
                    <form action={revokeEmployeeLetter}>
                      <input type="hidden" name="id" value={l.id} />
                      <input type="hidden" name="employee_id" value={id} />
                      <button className="btn-ghost text-danger">Revoke</button>
                    </form>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

async function ProbationTab({ sb, id, manage }: { sb: SB; id: string; manage: boolean }) {
  const { data, error } = await sb
    .from("probation_reviews")
    .select("id,due_date,reviewed_on,status,recommendation,comments,next_review_date,created_at")
    .eq("employee_id", id)
    .order("due_date", { ascending: false });
  if (error) return <Empty title="Probation reviews unavailable" />;
  return (
    <div className="space-y-4">
      {manage && (
        <Card title="Schedule probation review">
          <form action={createProbationReview} className="grid gap-3 sm:grid-cols-[180px_1fr_auto]">
            <input type="hidden" name="employee_id" value={id} />
            <label>
              <span className="label">Review due date</span>
              <input className="input" type="date" name="due_date" required />
            </label>
            <label>
              <span className="label">Initial notes</span>
              <input className="input" name="comments" maxLength={4000} placeholder="Objectives and review context" />
            </label>
            <div className="self-end">
              <button className="btn-primary">Create review</button>
            </div>
          </form>
        </Card>
      )}
      <Card title={`Probation review history · ${data?.length ?? 0}`}>
        {!data?.length ? (
          <Empty title="No probation reviews" hint="HR can schedule a review against the employee's probation period." />
        ) : (
          <div className="space-y-4">
            {data.map((r) => (
              <div key={r.id} className="rounded-xl border border-line p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <b>Due {fmtDate(r.due_date)}</b>
                  <Badge>{r.status}</Badge>
                </div>
                {r.recommendation && (
                  <p className="mt-2 text-sm">
                    Recommendation: <b>{r.recommendation}</b>
                    {r.next_review_date ? ` · Next review ${fmtDate(r.next_review_date)}` : ""}
                  </p>
                )}
                {r.comments && <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{r.comments}</p>}
                {manage && r.status === "DRAFT" && (
                  <form action={updateProbationReview} className="mt-3 space-y-2">
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="employee_id" value={id} />
                    <textarea className="input min-h-20" name="comments" defaultValue={r.comments ?? ""} placeholder="Review notes" />
                    <button className="btn-primary" name="review_action" value="SUBMIT">
                      Submit review
                    </button>
                  </form>
                )}
                {manage && r.status === "SUBMITTED" && (
                  <form action={updateProbationReview} className="mt-3 grid gap-2 sm:grid-cols-[1fr_180px_auto]">
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="employee_id" value={id} />
                    <input className="input" name="comments" defaultValue={r.comments ?? ""} placeholder="Final decision notes" />
                    <input className="input" type="date" name="next_review_date" />
                    <div className="flex flex-wrap gap-2 sm:col-span-3">
                      <button className="btn-primary" name="review_action" value="CONFIRM">
                        Confirm employment
                      </button>
                      <button className="btn-ghost" name="review_action" value="EXTEND">
                        Extend probation
                      </button>
                      <button className="btn-ghost text-danger" name="review_action" value="EXIT">
                        Move to notice
                      </button>
                    </div>
                  </form>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

async function ExitTab({ sb, id, manage }: { sb: SB; id: string; manage: boolean }) {
  const { data, error } = await sb
    .from("exit_clearance_items")
    .select("id,title,category,due_date,completed_at,notes")
    .eq("employee_id", id)
    .order("created_at");
  if (error) return <Empty title="Exit clearance unavailable" />;
  const items = data ?? [];
  const done = items.filter((x) => x.completed_at).length;
  return (
    <div className="space-y-4">
      {manage && (
        <Card title="Add clearance requirement">
          <form action={addExitClearanceItem} className="grid gap-2 sm:grid-cols-[150px_1fr_160px_auto]">
            <input type="hidden" name="employee_id" value={id} />
            <select className="input" name="category">
              {["MANAGER", "IT", "FINANCE", "HR", "ADMIN", "OTHER"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <input className="input" name="title" required minLength={2} placeholder="Return laptop, settle advance..." />
            <input className="input" type="date" name="due_date" />
            <button className="btn-primary">Add item</button>
          </form>
        </Card>
      )}
      <Card title={`Exit clearance · ${done}/${items.length} complete`}>
        {items.length > 0 && (
          <div className="mb-4 h-2 overflow-hidden rounded-full bg-line">
            <div className="h-full bg-volt" style={{ width: `${(done / items.length) * 100}%` }} />
          </div>
        )}
        {!items.length ? (
          <Empty
            title="No exit clearance items"
            hint="HR can add manager, IT, finance and HR clearance steps when an employee enters notice."
          />
        ) : (
          <ul className="divide-y divide-line">
            {items.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className={x.completed_at ? "line-through text-muted" : "font-medium"}>{x.title}</p>
                  <p className="text-xs text-muted">
                    {x.category}
                    {x.due_date ? ` · Due ${fmtDate(x.due_date)}` : ""}
                  </p>
                </div>
                {manage ? (
                  <form action={toggleExitClearanceItem} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={x.id} />
                    <input type="hidden" name="employee_id" value={id} />
                    <label className="text-xs">
                      <input type="checkbox" name="completed" defaultChecked={!!x.completed_at} /> Complete
                    </label>
                    <button className="btn-ghost">Save</button>
                  </form>
                ) : (
                  <Badge>{x.completed_at ? "Complete" : "Pending"}</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

async function AttendanceTab({ sb, id, start, end, tz }: { sb: SB; id: string; start: string; end: string; tz: string }) {
  const s = await loadAttendance(sb, id, start, end, tz);
  if (!s) return <Empty title="Attendance not visible" hint="You don't have attendance access for this employee." />;
  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Attendance · month" value={s.attendancePct === null ? "—" : `${s.attendancePct}%`} tone="volt" />
        <Stat label="Worked" value={minutesToHm(s.totalWorkedMinutes)} />
        <Stat label="Late" value={s.lateArrivals} />
        <Stat label="Loss of pay" value={`${s.lopDays}d`} />
      </div>
      <Link href={`/attendance?employee=${id}`} className="btn-ghost mt-4">
        Open full attendance →
      </Link>
    </>
  );
}

async function TasksTab({ sb, id, tz }: { sb: SB; id: string; tz: string }) {
  const { data } = await sb
    .from("tasks")
    .select("id, title, status, deadline, quality_score, project:projects(name)")
    .eq("assignee_id", id)
    .order("created_at", { ascending: false })
    .limit(30);
  if (!data?.length) return <Empty title="No visible tasks" />;
  return (
    <Card>
      <TableWrap>
        <table className="table min-w-[600px]">
          <thead>
            <tr>
              <th>Task</th>
              <th>Project</th>
              <th>Status</th>
              <th>Deadline</th>
              <th>Quality</th>
            </tr>
          </thead>
          <tbody>
            {data.map((t: any) => (
              <tr key={t.id}>
                <td>{t.title}</td>
                <td className="text-muted">{t.project?.name ?? "—"}</td>
                <td>
                  <Badge>{t.status}</Badge>
                </td>
                <td className="text-xs">{t.deadline ? fmtDateTime(t.deadline, tz) : "—"}</td>
                <td className="tabular-nums">{t.quality_score ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </Card>
  );
}

async function UpdatesTab({ sb, id }: { sb: SB; id: string }) {
  const { data } = await sb
    .from("daily_updates")
    .select("id, work_date, completed, blockers, minutes_spent, manager_comment")
    .eq("employee_id", id)
    .order("work_date", { ascending: false })
    .limit(20);
  if (!data?.length) return <Empty title="No daily updates" />;
  return (
    <div className="space-y-3">
      {data.map((u) => (
        <Card key={u.id} title={fmtDate(u.work_date)}>
          <p className="whitespace-pre-wrap text-sm">{u.completed}</p>
          {u.blockers && <p className="mt-2 text-sm text-ember">Blockers: {u.blockers}</p>}
          {u.manager_comment && <p className="mt-2 text-xs text-muted">Manager: {u.manager_comment}</p>}
        </Card>
      ))}
    </div>
  );
}

async function LeaveTab({ sb, id }: { sb: SB; id: string }) {
  const { data } = await sb
    .from("leave_requests")
    .select("id, start_date, end_date, half_day, status, reason, leave_type:leave_types(name)")
    .eq("employee_id", id)
    .order("start_date", { ascending: false })
    .limit(30);
  if (!data?.length) return <Empty title="No leave records" />;
  return (
    <Card>
      <TableWrap>
        <table className="table min-w-[560px]">
          <thead>
            <tr>
              <th>Type</th>
              <th>From</th>
              <th>To</th>
              <th>Status</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {data.map((l: any) => (
              <tr key={l.id}>
                <td>
                  {l.leave_type?.name}
                  {l.half_day ? " (½)" : ""}
                </td>
                <td>{fmtDate(l.start_date)}</td>
                <td>{fmtDate(l.end_date)}</td>
                <td>
                  <Badge>{l.status}</Badge>
                </td>
                <td className="text-muted">{l.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </Card>
  );
}

async function PerformanceTab({ sb, id, start, end, tz }: { sb: SB; id: string; start: string; end: string; tz: string }) {
  const [live, { data: snaps }] = await Promise.all([
    computeForEmployee(sb, id, start, end, tz),
    sb
      .from("performance_snapshots")
      .select("id, period_start, period_end, final_score, category, status")
      .eq("employee_id", id)
      .order("period_start", { ascending: false })
      .limit(12),
  ]);
  if (!live) return <Empty title="Performance not visible" />;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="This month (live)">
        <p className="display text-6xl">{live.result.score ?? "—"}</p>
        <p className="mt-1 text-xs text-muted">
          {live.result.score === null
            ? `Insufficient data · ${live.result.coverage}% coverage`
            : `${live.result.category?.replaceAll("_", " ")} · ${live.result.coverage}% coverage`}
        </p>
        <div className="mt-5 space-y-3">
          {live.result.components.map((c) => (
            <Meter key={c.key} label={`${c.label} · ${c.weight}%`} value={c.score} />
          ))}
        </div>
      </Card>
      <Card title="Snapshots">
        {!snaps?.length ? (
          <Empty title="No snapshots yet" />
        ) : (
          <ul className="divide-y divide-line">
            {snaps.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                <span>
                  {fmtDate(s.period_start)} – {fmtDate(s.period_end)}
                </span>
                <span className="flex items-center gap-2">
                  <b className="tabular-nums">{s.final_score ?? "—"}</b>
                  <Badge>{s.status}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

async function SalaryTab({ sb, id }: { sb: SB; id: string }) {
  const { data } = await sb
    .from("salary_structures")
    .select("id, effective_from, effective_to, pay_type, base_monthly, target_incentive, allowances")
    .eq("employee_id", id)
    .order("effective_from", { ascending: false });
  await sb.rpc("log_salary_access", { p_entity: "employee", p_entity_id: id, p_subject: id, p_purpose: "employee 360 salary tab" });
  if (!data?.length) return <Empty title="No salary structure" hint="Payroll admins add structures under Payroll → Structures." />;
  return (
    <Card title="Salary history (confidential)">
      <TableWrap>
        <table className="table min-w-[560px]">
          <thead>
            <tr>
              <th>Effective</th>
              <th>Type</th>
              <th>Base / month</th>
              <th>Allowances</th>
              <th>Target incentive</th>
            </tr>
          </thead>
          <tbody>
            {data.map((s: any) => (
              <tr key={s.id}>
                <td>
                  {fmtDate(s.effective_from)} → {s.effective_to ? fmtDate(s.effective_to) : "current"}
                </td>
                <td className="text-xs">{s.pay_type.replaceAll("_", " ")}</td>
                <td className="tabular-nums">{inr(s.base_monthly)}</td>
                <td className="tabular-nums">{inr((s.allowances ?? []).reduce((a: number, x: any) => a + Number(x.amount), 0))}</td>
                <td className="tabular-nums">{inr(s.target_incentive)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </Card>
  );
}

const KIND_TONE: Record<string, "green" | "amber" | "grey"> = { ATTENDANCE: "green", TASK: "green", LEAVE: "amber", AUDIT: "grey" };
async function ActivityTab({ sb, id, tz }: { sb: SB; id: string; tz: string }) {
  const { data, error } = await sb.rpc("employee_activity", { p_emp: id, p_limit: 120 });
  if (error) return <Empty title="Activity unavailable" hint={error.message} />;
  const rows = (data ?? []) as { at: string; kind: string; title: string; detail: string | null; actor: string | null }[];
  if (!rows.length) return <Empty title="No recorded activity yet" />;
  return (
    <Card title="Activity log" hint="Clock-ins, tasks, leave and every change made by or to this person. Newest first.">
      <ol className="relative ml-2 border-l border-line">
        {rows.map((a, i) => (
          <li key={i} className="mb-4 ml-4">
            <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-line" aria-hidden />
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={KIND_TONE[a.kind] ?? "grey"}>{a.kind}</Badge>
              <span className="text-sm font-medium">{a.title}</span>
              <span className="text-xs text-muted">{fmtDateTime(a.at, tz)}</span>
            </div>
            {(a.detail || a.actor) && (
              <p className="mt-0.5 text-xs text-muted">
                {a.detail}
                {a.actor ? ` · by ${a.actor}` : ""}
              </p>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}

async function EditTab({
  sb,
  e,
  assignable,
  canSalary,
}: {
  sb: SB;
  e: any;
  assignable: { role: Role; label: string }[];
  canSalary: boolean;
}) {
  const [{ data: depts }, { data: shifts }, { data: dir }, { data: posts }] = await Promise.all([
    sb.from("departments").select("id, name").order("name"),
    sb.from("shifts").select("id, name"),
    sb.from("employee_directory").select("id, full_name").order("full_name"),
    sb.from("designations").select("title").eq("is_active", true).order("sort"),
  ]);
  return (
    <Card title="Edit employee">
      <form action={updateEmployee} className="space-y-4">
        <input type="hidden" name="id" value={e.id} />
        <EmployeeFields
          e={e}
          departments={(depts ?? []) as any}
          managers={(dir ?? []).map((d) => ({ id: d.id, name: d.full_name }))}
          shifts={(shifts ?? []) as any}
          assignable={assignable}
          posts={(posts ?? []).map((x) => x.title)}
          canSetSalary={canSalary}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="label">Status</span>
            <select name="status" defaultValue={e.status} className="input">
              {["ACTIVE", "PROBATION", "NOTICE", "ON_LEAVE", "EXITED"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">Exit date</span>
            <input type="date" name="exit_date" defaultValue={e.exit_date ?? ""} className="input" />
          </label>
        </div>
        <button className="btn-primary">Save changes</button>
      </form>
    </Card>
  );
}

type CardData = {
  id: string;
  full_name: string;
  employee_code: string;
  designation: string | null;
  role: Role;
  is_owner: boolean;
  photo_url: string | null;
  official_email: string;
  status: string;
  work_location: string | null;
  joining_date: string | null;
  department: string | null;
  manager: { id: string; full_name: string } | null;
  teams: { name: string; role: string }[];
};
function ProfileCard({ card, self }: { card: CardData; self: boolean }) {
  const rows: [string, React.ReactNode][] = [
    [
      "Employee ID",
      <span key="c" className="font-mono font-semibold">
        {card.employee_code}
      </span>,
    ],
    ["Post", card.designation ?? ROLE_LABEL[card.role]],
    ["Department", card.department ?? "—"],
    ["Teams", card.teams.length ? card.teams.map((t) => t.name + (t.role === "LEAD" ? " (lead)" : "")).join(", ") : "—"],
    ["Reporting to", card.manager?.full_name ?? "—"],
    [
      "Work email",
      <a key="m" href={`mailto:${card.official_email}`} className="hover:text-volt">
        {card.official_email}
      </a>,
    ],
    ["Location", card.work_location ?? "—"],
    ["Joined", card.joining_date ? fmtDate(card.joining_date) : "—"],
  ];
  return (
    <>
      <PageHeader
        eyebrow={`${card.employee_code} · ${card.is_owner || card.role === "SUPER_ADMIN" ? "Owner" : (card.designation ?? ROLE_LABEL[card.role])}`}
        title={card.full_name}
      >
        {!self && (
          <form action={openDirectChat}>
            <input type="hidden" name="employee_id" value={card.id} />
            <button className="btn-primary">Message</button>
          </form>
        )}
      </PageHeader>
      <Card title="Profile" hint="The company profile everyone can see. Salary, documents and personal details stay private.">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="mt-0.5 text-sm">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </>
  );
}

async function AssetsTab({ sb, id, tz }: { sb: SB; id: string; tz: string }) {
  const [{ data: held }, { data: past }] = await Promise.all([
    sb.rpc("my_assets", { p_employee: id }),
    sb
      .from("asset_assignments")
      .select("id, issued_at, returned_at, condition_in, asset:assets!asset_id(id, asset_tag, name)")
      .eq("employee_id", id)
      .not("returned_at", "is", null)
      .order("returned_at", { ascending: false })
      .limit(30),
  ]);
  const list = (held ?? []) as any[];
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title={`Holding now (${list.length})`} hint="Everything here must come back before exit.">
        {!list.length ? (
          <Empty title="No company kit" />
        ) : (
          <ul className="space-y-2 text-sm">
            {list.map((i) => (
              <li key={i.assignment_id}>
                <Link href={`/assets/${i.asset_id}`} className="font-medium underline">
                  {i.asset_tag} · {i.name}
                </Link>
                <span className="text-xs text-muted">
                  {" "}
                  since {fmtDateTime(i.issued_at, tz)} · {i.acknowledged_at ? "receipt confirmed" : "not confirmed yet"}
                  {i.open_issues ? ` · ${i.open_issues} open issue(s)` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Returned">
        {!past?.length ? (
          <Empty title="Nothing returned yet" />
        ) : (
          <ul className="space-y-2 text-sm">
            {past.map((h: any) => (
              <li key={h.id}>
                <Link href={`/assets/${h.asset?.id}`} className="underline">
                  {h.asset?.asset_tag} · {h.asset?.name}
                </Link>
                <span className="text-xs text-muted">
                  {" "}
                  · back {fmtDateTime(h.returned_at, tz)} · {String(h.condition_in).toLowerCase()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

async function KycTab({ sb, id, self }: { sb: SB; id: string; self: boolean }) {
  const [{ data: k }, { data: docs }] = await Promise.all([
    sb.from("kyc_profiles").select("status, submitted_at, reviewed_at, review_note").eq("employee_id", id).maybeSingle(),
    sb.from("kyc_documents").select("doc_type, status").eq("employee_id", id).neq("status", "REPLACED"),
  ]);
  const verified = (docs ?? []).filter((d) => d.status === "VERIFIED").length;
  return (
    <Card title="KYC" hint="Personal details and identity documents, verified by HR.">
      <p className="text-sm">
        Status: <Badge>{k?.status ?? "NOT_STARTED"}</Badge>
        <span className="ml-3 text-muted">
          {(docs ?? []).length} documents uploaded · {verified} verified
        </span>
      </p>
      {k?.review_note && <p className="mt-2 text-sm text-muted">HR note: {k.review_note}</p>}
      <div className="mt-4 flex gap-2">
        {self ? (
          <Link className="btn-primary" href="/kyc">
            {k?.status === "VERIFIED" ? "View my KYC" : "Complete my KYC"}
          </Link>
        ) : (
          <Link className="btn-primary" href={`/people/kyc?e=${id}`}>
            Review KYC
          </Link>
        )}
      </div>
    </Card>
  );
}
