# Block 32 — Archived chats, 10 GB files, WhatsApp-style previews, Save to device (migration 0044)

- **Archived chats** (`/chat/archived`):
  - Archived conversations used to disappear completely. Now members, moderators, admins, owners and the Super Admin can open their read-only history, including files.
  - The channel owner or a chat manager can **Restore** a chat. Nobody can post into an archived chat.
- **Big files**:
  - Chat files can be up to **10 GB**. Anything above 6 MB uploads in resumable 6 MB chunks (Supabase TUS), so a dropped connection resumes instead of failing.
  - Needs Supabase **Pro** plus Storage → Settings → **Global file size limit ≥ 10 GB** (the Free plan caps every file at 50 MB).
- **Previews**:
  - Photos and videos show blurred with a progress ring (with cancel) while uploading, then turn sharp with a ✓ when ready.
  - Documents show a file card (PDF / extension badge) with the same ring and a bar.
- **Quality**: files are never resized or re-encoded. Photos open full-size in an in-app viewer.
- **Save to device**: every attachment has a **⬇ Save** button that downloads the original file with its name, including in archived chats.
