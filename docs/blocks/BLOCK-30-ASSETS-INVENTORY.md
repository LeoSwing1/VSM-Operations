# Block 30 — Assets & inventory (migration 0041) + fixed salary date (0042)

## Assets
- **Register** (`/assets`, permission `assets.view` / `assets.manage`; Admin, HR Manager and Operations Manager get both):
  - laptops, phones, SIMs, cameras, lenses, lights, audio, storage, furniture, vehicles, licences
  - automatic `AST-0001` tags; serial numbers must be unique
  - search and filters, CSV download (the purchase columns appear only for asset managers and finance)
- **Issue / take back**:
  - Issue to a person with a condition and an optional return date. They get a notification and confirm receipt in **My assets**.
  - A damaged return goes to repair and opens a ticket; "Lost" marks the asset LOST. A note is required for both.
- **Repairs & servicing**:
  - The holder (or a manager) reports a problem, and asset managers are notified.
  - Ticket flow: sent for repair → done or cancelled. Closing the last open ticket puts the asset back in stock, or back with its holder.
- **Purchase & value**: cost, vendor and invoice sit in a separate table that only asset managers and finance can read. The straight-line book value is a management estimate, not the tax WDV block.
- **Exit**:
  - Moving someone to NOTICE adds an IT clearance item per asset they hold; taking the asset back ticks it.
  - Nobody can be marked EXITED while still holding kit.
- **Safety**:
  - Nothing is deleted (assets are retired instead).
  - The holder and status change only through Issue / Return / Repair.
  - Every change is audited.
  - Employees see only their own kit; managers see their team's.

## Salary date (0042)
- The add-employee form needs a joining date and fills in the salary date as joining + 7 days, live (1 Jan → 8th).
- HR can change the salary date there. It is then **saved for that person** and does not move if the joining date is edited later.
- Only HR (post), HR Manager, owners, admins and the Super Admin can change it (`people.salary_day`). Everyone else sees it read-only, and the database refuses the change.
