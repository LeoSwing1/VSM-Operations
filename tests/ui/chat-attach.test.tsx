// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/supabase/browser", () => ({
  openChannel: () => () => {},
  getAccessToken: vi.fn(async () => "tok"),
}));
vi.mock("@/app/(app)/chat/actions", () => ({
  addChatReaction: vi.fn(),
  postChatMessage: vi.fn(async () => ({ ok: true })),
  reportChatMessage: vi.fn(),
  sendChatMessage: vi.fn(),
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

class FakeXHR {
  static all: FakeXHR[] = [];
  upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
  status = 0;
  responseText = "";
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  constructor() {
    FakeXHR.all.push(this);
  }
  open() {}
  setRequestHeader() {}
  send() {}
  abort() {
    this.onabort?.();
  }
}

beforeEach(() => {
  FakeXHR.all = [];
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcd1234.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ messages: [], members: [] }))),
  );
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
  Element.prototype.scrollTo = function () {} as never;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function pick(file: File) {
  const { ChatRoom } = await import("@/components/chat/chat-room");
  render(<ChatRoom channelId="c1" employeeId="e1" employeeName="Kevin" orgId="o1" />);
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
}

describe("attaching a file in chat", () => {
  it("reacts the instant a file is picked, before the upload starts", async () => {
    const mod = await import("@/lib/supabase/browser");
    let release: (t: string) => void = () => {};
    vi.mocked(mod.getAccessToken).mockImplementationOnce(() => new Promise<string>((r) => (release = r)));
    await pick(new File(["x"], "IMG-1.jpg", { type: "image/jpeg" }));
    expect(screen.getByText("Preparing IMG-1.jpg…")).toBeTruthy();
    await act(async () => release("tok"));
    expect(await screen.findByText(/Uploading…? 0%/)).toBeTruthy();
  });

  it("shows the photo preview with upload progress straight after selecting it", async () => {
    await pick(new File(["x".repeat(2048)], "IMG-20241022.jpg", { type: "image/jpeg" }));
    expect(await screen.findByText("IMG-20241022.jpg")).toBeTruthy();
    expect(screen.getByText(/Uploading…? 0%/)).toBeTruthy();
    expect(document.querySelector('img[src="blob:preview"]')).toBeTruthy();
    await act(async () => {
      FakeXHR.all[0]!.upload.onprogress!({ lengthComputable: true, loaded: 1024, total: 2048 });
    });
    expect(screen.getByText(/Uploading…? 50%/)).toBeTruthy();
    await act(async () => {
      FakeXHR.all[0]!.status = 200;
      FakeXHR.all[0]!.onload!();
    });
    expect(await screen.findByText(/Ready to send/)).toBeTruthy();
  });

  it("shows a visible error next to the message box when the upload fails", async () => {
    await pick(new File(["x"], "doc.pdf", { type: "application/pdf" }));
    await act(async () => {
      FakeXHR.all[0]!.status = 403;
      FakeXHR.all[0]!.responseText = JSON.stringify({ message: "new row violates row-level security policy" });
      FakeXHR.all[0]!.onload!();
    });
    expect(await screen.findByText(/row-level security/)).toBeTruthy();
  });

  it("shows why when the login can't be confirmed (instead of doing nothing)", async () => {
    const mod = await import("@/lib/supabase/browser");
    vi.mocked(mod.getAccessToken).mockRejectedValueOnce(new Error("Your session expired — refresh the page and sign in again."));
    await pick(new File(["x"], "a.png", { type: "image/png" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert").textContent).toMatch(/Couldn't attach "a.png": Your session expired/);
  });
});
