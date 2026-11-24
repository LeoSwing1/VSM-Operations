# Block 28 — Profile fix, owners, who-can-add-whom, KYC, instant chat

## Run on live
1. SQL Editor → `supabase/repair/catch_up.sql`, then `health_check.sql` (`0035 owners & KYC` = ok).
2. Redeploy. To pick your co-owner: open the co-owner's profile (role must be **Admin**) and click **Make co-owner**. You must be signed in as the Super Admin.

## Fixed
- **Profile "Not here" (404):** the profile query joined departments ambiguously (an employee's department *and* a department's head both link the two tables). The link is now named in all 6 places that had it, including the welcome email, payslips and the people list. A real query error now shows as an error instead of a 404.
- **Mobile menu clipped behind the top bar:** the menu is now rendered at page level.
- **Clock hydration warning:** the dashboard clock, sidebar clock and task timer now start ticking only in the browser.

## Who can do what
| Who | Can add | Notes |
|---|---|---|
| Owners (max 2: Super Admin + 1 co-owner) | Everyone | Full access, in every group chat. Only the Super Admin picks or removes the co-owner. |
| Admin | Everyone below Admin | In every group chat |
| HR Manager | Managers, leads, executives, interns | Verifies KYC |
| HR (post "HR Executive") | Executives, employees, interns | Can't add managers; can't see KYC unless given `kyc.verify` by the Super Admin |
| Managers / Team leads / Project managers | Executives, employees, interns **who report to them**, into their own team | |
| Executives, interns | Nobody | |

- Nobody can delete an employee from the app; people are exited instead, so records stay for payroll, audit and law.
- An employee can delete nothing except their own notification, push and WhatsApp settings. A test tries a delete on every table as an employee to check this.

## New joiner flow
1. HR or a manager adds the person. The welcome email (now the default) carries their **Employee ID, login email and a temporary password**, which they change at first sign-in.
2. The person who added them automatically sends a **chat message** listing exactly what to submit, plus a notification.
3. The employee fills **My KYC** (`/kyc`):
   - **Details:** DOB, father's name, phone, addresses, emergency contact, blood group, qualification, PAN, Aadhaar last 4, and bank details.
   - **Documents:** photo, masked Aadhaar, PAN, address proof, bank proof and highest qualification are required; experience, relieving and other are optional.
   - Then **Submit**.
4. HR checks each submission in **KYC verification** (`/people/kyc`):
   - Opens each document through a 60-second private link; every view is audited.
   - Verifies or rejects each document, then **Verifies the KYC** or **asks for changes** with a note.
   - On verification, PAN and bank details are copied into payroll where they're still empty.
- Only the full **Aadhaar number is never stored** — just the last 4 digits. Ask for the masked Aadhaar PDF from UIDAI.
- Managers and colleagues can't see KYC.

## Chat
- Messages now send instantly: they appear at once, the box clears, Enter sends and Shift+Enter adds a new line.
- Every name links to that person's profile. Colleagues without HR access see a **profile card** (ID, post, team, manager, work email) with a **Message** button, never salary or documents.

## Verified here
- tsc 0 · Prettier ✓ · next build ✓ · Vitest 164/164 · Playwright 16/16 public
- PostgreSQL **414/414** in normal and strict-grant mode. The 33 new checks cover:
  - owners
  - who-can-add-whom
  - no deletes
  - groups
  - KYC privacy and the review flow
  - profile cards
  - the delete sweep
- Simulated live upgrade from 0034: applies, a re-run is a no-op, and the health check is clean.

**Not verified:** the profile fix against your real Supabase (I couldn't run the database API here), real uploads to storage, and the signed-in screens.
