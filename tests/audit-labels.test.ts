import { describe, expect, it } from "vitest";
import { areaFilter, areaOf, AREAS, describeEvent, entityLabel, sourceLabel } from "@/lib/audit-labels";

describe("audit labels", () => {
  it("singularises table names", () => {
    expect(entityLabel("leave_requests")).toBe("leave request");
    expect(entityLabel("project_milestones")).toBe("project milestone");
    expect(entityLabel("lead_activities")).toBe("lead activity");
    expect(entityLabel("payroll_statutory_settings")).toBe("payroll statutory setting");
  });
  it("describes generic and special events in plain English", () => {
    expect(describeEvent("tasks.created", "tasks", { title: "Shoot reel", status: "TODO" })).toBe("added task: Shoot reel (status todo)");
    expect(describeEvent("leave_requests.updated", "leave_requests", { changed: ["status"], status: "APPROVED" })).toBe(
      "changed leave request (status approved · fields: status)",
    );
    expect(describeEvent("auth.sign_in", "employee", {})).toBe("signed in");
    expect(describeEvent("chat_messages.created", "chat_messages", {})).toBe("sent a chat message");
  });
  it("maps events to areas and builds filters", () => {
    expect(areaOf("chat_messages.created", "chat_messages")?.key).toBe("chat");
    expect(areaOf("auth.sign_in", "employee")?.key).toBe("auth");
    expect(areaOf("email_outbox.updated", "email_outbox")?.key).toBe("integrations");
    const chat = AREAS.find((a) => a.key === "chat")!;
    expect(areaFilter(chat)).toMatch(/^entity\.in\.\(chat_channels,.*\),action\.like\.chat\.\*/);
  });
  it("labels who did it", () => {
    expect(sourceLabel({ source: "integration" }, false)).toBe("Integration");
    expect(sourceLabel({ source: "user" }, true)).toBe("Person");
    expect(sourceLabel({ source: "system" }, false)).toBe("System");
  });
});
