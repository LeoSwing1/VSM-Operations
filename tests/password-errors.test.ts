import { describe, expect, it } from "vitest";
import { passwordUpdateMessage as m } from "@/lib/password-errors";

describe("password update errors are explained, not all called 'link expired'", () => {
  it("same password", () => {
    expect(m({ code: "same_password", message: "New password should be different from the old password." })).toMatch(/current password/);
    expect(m({ message: "New password should be different from the old password." })).toMatch(/current password/);
  });
  it("weak or leaked password", () => {
    expect(m({ code: "weak_password", reasons: ["pwned"] })).toMatch(/data leak/);
    expect(m({ code: "weak_password", reasons: ["characters"] })).toMatch(/upper- and lower-case/);
  });
  it("needs a fresh sign-in", () => expect(m({ code: "reauthentication_needed" })).toMatch(/sign in again/));
  it("session gone", () => {
    expect(m({ code: "session_not_found" })).toMatch(/new reset link/);
    expect(m({ name: "AuthSessionMissingError", message: "Auth session missing!" } as never)).toMatch(/new reset link/);
  });
  it("anything else shows the real reason", () =>
    expect(m({ message: "Database error" })).toBe("Couldn’t update the password: Database error"));
});
