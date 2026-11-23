import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Enqueue scheduled SLA events with stable keys; service role is only used by the secret-protected cron. */
export async function scanBusinessSla(now = new Date()) {
  const sb = supabaseAdmin();
  const soon = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const [dueSoon, overdue, staleTimesheets, oldClockIns] = await Promise.all([
    sb
      .from("tasks")
      .select("id,org_id,title,assignee_id,deadline")
      .not("assignee_id", "is", null)
      .gt("deadline", now.toISOString())
      .lte("deadline", soon)
      .not("status", "in", "(COMPLETED,CANCELLED)")
      .limit(500),
    sb
      .from("tasks")
      .select("id,org_id,title,assignee_id,deadline")
      .not("assignee_id", "is", null)
      .lte("deadline", now.toISOString())
      .not("status", "in", "(COMPLETED,CANCELLED)")
      .limit(500),
    sb
      .from("task_time_entries")
      .select("id,org_id,employee_id,work_date,created_at")
      .eq("status", "PENDING")
      .not("ended_at", "is", null)
      .lte("created_at", new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString())
      .limit(500),
    sb
      .from("attendance_events")
      .select("id,org_id,employee_id,occurred_at")
      .eq("event_type", "CLOCK_IN")
      .lte("occurred_at", new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString())
      .gte("occurred_at", new Date(now.getTime() - 36 * 60 * 60 * 1000).toISOString())
      .limit(500),
  ]);
  for (const q of [dueSoon, overdue, staleTimesheets, oldClockIns]) if (q.error) throw new Error(`SLA scan failed: ${q.error.message}`);
  let enqueued = 0,
    incompleteAttendance = 0;
  const enqueue = async (orgId: string, eventKey: string, key: string, actorId: string, payload: Record<string, unknown>) => {
    const { data: rules, error } = await sb
      .from("workflow_rules")
      .select("id")
      .eq("org_id", orgId)
      .eq("event_key", eventKey)
      .eq("enabled", true);
    if (error) throw error;
    for (const rule of rules ?? []) {
      const { data: inserted, error: insertError } = await sb
        .from("workflow_runs")
        .upsert(
          {
            org_id: orgId,
            rule_id: rule.id,
            event_key: eventKey,
            idempotency_key: `${rule.id}:${key}`,
            payload: { ...payload, actor_employee_id: actorId },
          },
          { onConflict: "org_id,idempotency_key", ignoreDuplicates: true },
        )
        .select("id");
      if (insertError) throw insertError;
      enqueued += inserted?.length ?? 0;
    }
  };
  for (const t of dueSoon.data ?? [])
    if (t.assignee_id)
      await enqueue(t.org_id, "task.due_soon", `task:${t.id}:due-soon:${t.deadline}`, t.assignee_id, {
        task_id: t.id,
        target_employee_id: t.assignee_id,
        title: t.title,
        deadline: t.deadline,
      });
  for (const t of overdue.data ?? [])
    if (t.assignee_id)
      await enqueue(t.org_id, "task.overdue", `task:${t.id}:overdue:${t.deadline}`, t.assignee_id, {
        task_id: t.id,
        target_employee_id: t.assignee_id,
        title: t.title,
        deadline: t.deadline,
      });
  for (const t of staleTimesheets.data ?? [])
    await enqueue(t.org_id, "timesheet.overdue", `timesheet:${t.id}:pending-48h`, t.employee_id, {
      time_entry_id: t.id,
      target_employee_id: t.employee_id,
      work_date: t.work_date,
    });
  for (const punch of oldClockIns.data ?? []) {
    const { data: later } = await sb
      .from("attendance_events")
      .select("id")
      .eq("org_id", punch.org_id)
      .eq("employee_id", punch.employee_id)
      .eq("event_type", "CLOCK_OUT")
      .gt("occurred_at", punch.occurred_at)
      .limit(1);
    if (!later?.length) {
      incompleteAttendance++;
      await enqueue(punch.org_id, "attendance.incomplete", `attendance:${punch.id}:missing-clock-out`, punch.employee_id, {
        attendance_event_id: punch.id,
        target_employee_id: punch.employee_id,
        clock_in_at: punch.occurred_at,
      });
    }
  }
  return {
    dueSoon: dueSoon.data?.length ?? 0,
    overdue: overdue.data?.length ?? 0,
    staleTimesheets: staleTimesheets.data?.length ?? 0,
    incompleteAttendance,
    enqueued,
  };
}

/** Escalate overdue workflow approvals up the configured manager chain, at most three levels. */
export async function escalateWorkflowApprovals(now = new Date()) {
  const sb = supabaseAdmin();
  const { data: cases, error } = await sb
    .from("workflow_approval_cases")
    .select("id,org_id,requester_id,approver_id,subject,escalation_level")
    .eq("status", "PENDING")
    .lte("due_at", now.toISOString())
    .lt("escalation_level", 3)
    .limit(200);
  if (error) throw new Error(`approval escalation scan failed: ${error.message}`);
  let escalated = 0;
  for (const item of cases ?? []) {
    const { data: current } = await sb
      .from("employees")
      .select("manager_id")
      .eq("id", item.approver_id)
      .eq("org_id", item.org_id)
      .maybeSingle();
    const nextId = current?.manager_id;
    if (!nextId || nextId === item.approver_id) continue;
    const { data: next } = await sb
      .from("employees")
      .select("id")
      .eq("id", nextId)
      .eq("org_id", item.org_id)
      .neq("status", "EXITED")
      .maybeSingle();
    if (!next) continue;
    const { error: updateError } = await sb
      .from("workflow_approval_cases")
      .update({
        approver_id: next.id,
        status: "ESCALATED",
        escalation_level: item.escalation_level + 1,
        due_at: new Date(now.getTime() + 24 * 3600000).toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("id", item.id)
      .eq("status", "PENDING");
    if (updateError) throw updateError;
    const { error: noticeError } = await sb.from("notifications").upsert(
      {
        org_id: item.org_id,
        recipient_id: next.id,
        category: "APPROVALS",
        title: `Escalated approval: ${item.subject}`,
        body: "An approval exceeded its response deadline and has been escalated to you.",
        link: "/approvals",
        dedupe_key: `approval-escalation:${item.id}:${item.escalation_level + 1}`,
      },
      { onConflict: "recipient_id,dedupe_key", ignoreDuplicates: true },
    );
    if (noticeError) throw noticeError;
    escalated++;
    // Return to PENDING so the new approver can act in the normal inbox.
    await sb.from("workflow_approval_cases").update({ status: "PENDING" }).eq("id", item.id).eq("approver_id", next.id);
  }
  return { escalated };
}

/** Executes only the explicit action registry. No dynamic code, SQL, or URL fetching. */
export async function drainWorkflowRuns(limit = 30) {
  const sb = supabaseAdmin();
  const { data: runs, error } = await sb.rpc("claim_workflow_runs", { p_limit: Math.max(1, Math.min(100, limit)) });
  if (error) throw new Error(`workflow claim failed: ${error.message}`);
  let succeeded = 0,
    failed = 0,
    skipped = 0;
  for (const run of runs ?? []) {
    try {
      const { data: rule, error: ruleError } = await sb
        .from("workflow_rules")
        .select("id,org_id,enabled,actions")
        .eq("id", run.rule_id)
        .eq("org_id", run.org_id)
        .maybeSingle();
      if (ruleError) throw ruleError;
      if (!rule || !rule.enabled) {
        await sb.rpc("finish_workflow_run", {
          p_id: run.id,
          p_status: "CANCELLED",
          p_result: { reason: "rule_missing_or_disabled" },
          p_error: null,
        });
        skipped++;
        continue;
      }
      const actorId = typeof run.payload?.actor_employee_id === "string" ? run.payload.actor_employee_id : "";
      const { data: actor } = actorId
        ? await sb.from("employees").select("id").eq("id", actorId).eq("org_id", run.org_id).neq("status", "EXITED").maybeSingle()
        : { data: null };
      if (!actor) throw new Error("Event actor is missing, inactive or outside the organisation");
      const results: Record<string, unknown>[] = [];
      for (const action of Array.isArray(rule.actions) ? rule.actions : []) {
        if (!(["notify_actor", "notify_target", "notify_manager", "create_approval"] as string[]).includes(action?.type))
          throw new Error("Unsupported workflow action; execution stopped safely");
        if (action.type === "create_approval") {
          const { data: requester } = await sb
            .from("employees")
            .select("id,manager_id")
            .eq("id", actor.id)
            .eq("org_id", run.org_id)
            .maybeSingle();
          if (!requester?.manager_id) throw new Error("Approval requester has no configured manager");
          const { data: approver } = await sb
            .from("employees")
            .select("id")
            .eq("id", requester.manager_id)
            .eq("org_id", run.org_id)
            .neq("status", "EXITED")
            .maybeSingle();
          if (!approver) throw new Error("Approval manager is inactive or outside the organisation");
          const hours = Math.max(1, Math.min(720, Number(action.sla_hours) || 24));
          const { error: approvalError } = await sb.from("workflow_approval_cases").upsert(
            {
              org_id: run.org_id,
              workflow_run_id: run.id,
              subject: String(action.subject).slice(0, 180),
              details: String(action.details ?? "").slice(0, 2000),
              requester_id: actor.id,
              approver_id: approver.id,
              due_at: new Date(Date.now() + hours * 3600000).toISOString(),
            },
            { onConflict: "workflow_run_id", ignoreDuplicates: true },
          );
          if (approvalError) throw approvalError;
          const { error: noticeError } = await sb.from("notifications").upsert(
            {
              org_id: run.org_id,
              recipient_id: approver.id,
              category: "APPROVALS",
              title: `Approval required: ${String(action.subject).slice(0, 100)}`,
              body: String(action.details ?? "A workflow approval requires your attention.").slice(0, 1000),
              link: "/approvals",
              dedupe_key: `workflow-approval:${run.id}`,
            },
            { onConflict: "recipient_id,dedupe_key", ignoreDuplicates: true },
          );
          if (noticeError) throw noticeError;
          results.push({
            type: action.type,
            created: true,
            approver_id: approver.id,
            due_at: new Date(Date.now() + hours * 3600000).toISOString(),
          });
          continue;
        }
        const title = String(action.title ?? "").slice(0, 120),
          body = String(action.body ?? "").slice(0, 1000),
          link = String(action.link ?? "/notifications");
        if (!title || !body || !link.startsWith("/")) throw new Error("Invalid notification action configuration");
        let recipientId = actor.id;
        if (action.type === "notify_target") {
          const targetId = typeof run.payload?.target_employee_id === "string" ? run.payload.target_employee_id : "";
          const { data: target } = targetId
            ? await sb.from("employees").select("id").eq("id", targetId).eq("org_id", run.org_id).neq("status", "EXITED").maybeSingle()
            : { data: null };
          if (!target) throw new Error("Workflow target is missing, inactive or outside the organisation");
          recipientId = target.id;
        } else if (action.type === "notify_manager") {
          const { data: manager } = await sb
            .from("employees")
            .select("manager_id")
            .eq("id", actor.id)
            .eq("org_id", run.org_id)
            .maybeSingle();
          const { data: validManager } = manager?.manager_id
            ? await sb
                .from("employees")
                .select("id")
                .eq("id", manager.manager_id)
                .eq("org_id", run.org_id)
                .neq("status", "EXITED")
                .maybeSingle()
            : { data: null };
          if (!validManager) throw new Error("Event actor has no active same-organisation manager");
          recipientId = validManager.id;
        }
        const { error: insertError } = await sb.from("notifications").upsert(
          {
            org_id: run.org_id,
            recipient_id: recipientId,
            category: "WORKFLOW",
            title,
            body,
            link,
            dedupe_key: `workflow:${run.id}:${results.length}`,
          },
          { onConflict: "recipient_id,dedupe_key", ignoreDuplicates: true },
        );
        if (insertError) throw insertError;
        results.push({ type: action.type, delivered: true, recipient_id: recipientId });
      }
      const { error: finishError } = await sb.rpc("finish_workflow_run", {
        p_id: run.id,
        p_status: "SUCCEEDED",
        p_result: { actions: results },
        p_error: null,
      });
      if (finishError) throw finishError;
      succeeded++;
    } catch (e) {
      await sb.rpc("finish_workflow_run", { p_id: run.id, p_status: "FAILED", p_result: {}, p_error: (e as Error).message.slice(0, 1000) });
      failed++;
    }
  }
  return { claimed: (runs ?? []).length, succeeded, failed, skipped };
}
