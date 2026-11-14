# Subscriptions and launch legal pages — design

Date: 2026-11-14. Status: approved 2026-11-14 ("make it live"); open items answered with placeholders until the user supplies them.

## Intent

Agencies pay to use the AMS. Every agency except ones we comp has a
paid-until date; while that date (plus a short grace) is in the future
the agency can work normally, otherwise it drops to read-only. Payment
is through Paystack (M-Pesa or card), one month or several at a time.
There is no free trial.

Alongside this, two things still missing for launch: a privacy notice
and terms page, linked from sign-up, with consent recorded.

Why now: launch is imminent and the schema's `subscription_tier` column
is a label nothing reads. Revenue needs a real paid-until date, a way to
pay, and enforcement.

## Goals

- An Owner can pay for a tier with M-Pesa or a card and the agency is
  unlocked within seconds of the payment.
- Limits per tier are enforced in the database, not only in the UI.
- A lapsed agency keeps read access to its data.
- Reminders before expiry so Owners don't get surprised.
- Legal pages exist and sign-up records consent.

## Non-goals

- Card auto-renew (Paystack Subscriptions). Approach C below; can be
  added later, it ends in the same `paid_until` date.
- A platform admin UI. Comping an agency is a SQL update for now.
- Annual discounts, coupons, VAT invoices, refunds.
- Per-seat or per-policy metered billing.

## Anti-goals

- Locking a lapsed agency out of its data. Read-only, never a wall.
- Trusting the browser about payment. Only the Paystack webhook (or a
  server-side verify) moves `paid_until`.
- Breaking the demo agency or any agency created before this ships.

## Constraints

- Stack: Supabase (Postgres 17, RLS, SECURITY DEFINER RPCs), React/Vite
  SPA, no app server. Paystack needs a server to hold the secret key, so
  this adds the project's first Supabase Edge Functions.
- Prices in KES; Paystack takes amounts in the smallest unit (cents).
- Paystack cannot re-charge an M-Pesa authorisation, so renewal is a
  payment the Owner makes each cycle.
- Reminder emails need an email sender. Decision: Resend HTTP API from an
  Edge Function (`RESEND_API_KEY` secret). The sender address must be on
  a domain verified in Resend.
- Times are Africa/Nairobi for day boundaries, as elsewhere in the app.

## Approaches considered

**A. Paystack Subscriptions (card auto-renew).** Cleanest billing, but
M-Pesa payers can't subscribe at all. Rejected: most Kenyan agencies pay
by M-Pesa.

**B. Monthly pay-to-renew (chosen).** Agency has `paid_until`; Owner pays
one or more months at a time through Paystack checkout; webhook extends
the date. Reminders before expiry, 3-day grace, then read-only. Smallest
thing that works for everyone.

**C. Both.** B plus A for card payers. Better experience, two billing
paths. Deferred; can be layered on B later.

The user chose B.

## Tiers

| key | Name | KES / month | members | active policies | extras |
|---|---|---|---|---|---|
| `starter` | Starter | 3,500 | 3 | 300 | |
| `growth` | Growth | 7,000 | 10 | unlimited | |
| `enterprise` | Enterprise | 15,000 | 25 | unlimited | |
| `enterprise_plus` | Enterprise Plus | 30,000 | unlimited | unlimited | priority support |

- "Members" counts active rows in `users` for the agency (Owner
  included). Pending invites count toward the limit so an Owner can't
  over-invite.
- "Active policies" counts `policies` with status `active` or `pending`.
- Tier definitions live in one place in SQL (`subscription_tiers` table)
  and are mirrored in `src/lib/subscription.ts` for display. The SQL
  table is the authority; the TS copy has a test that pins the same
  values so drift fails CI.
- Paying for several months at once is allowed: 1, 3, 6 or 12 months at
  the same per-month price (my call: cuts M-Pesa friction for Owners who
  want to pay less often; no discount keeps the maths simple).

## Agency subscription state

New columns on `agencies`:

| column | type | meaning |
|---|---|---|
| `subscription_tier` | existing, CHECK widened to the four keys; default `starter` | tier the agency last paid for |
| `paid_until` | `date`, null | last paid day (inclusive) |
| `complimentary_until` | `date`, null | comped through this day; null = not comped |
| `terms_accepted_at` | `timestamptz`, null | set at sign-up |

Derived, in SQL function `public.agency_access(p_agency_id uuid)` returning
`'active' | 'grace' | 'read_only'`:

- `active` if `complimentary_until >= today` or `paid_until >= today`
- `grace` if `paid_until` is within the last 3 days (today ≤ paid_until + 3)
- else `read_only` (includes new agencies that have never paid:
  `paid_until` null)

`grace` behaves as active for writes; it only changes the banner.

Existing agencies at migration time: the demo agency (`00ca4ec4-…`) gets
`complimentary_until = '2099-12-31'`. Any other existing agency gets
`complimentary_until = today + 30` so nobody is cut off by the deploy
(my call). Old tier values map `pro → growth`, `enterprise →
enterprise`, `starter → starter`.

A comped agency (`complimentary_until >= today`) is exempt from the
member and policy limits as well as from read-only; limits apply from
its first real payment, when the Owner picks a tier that fits (the
initialize function refuses a tier the agency already exceeds). This is
how existing agencies are grandfathered for 30 days.

## Enforcement

One trigger function `public.enforce_subscription()` (BEFORE INSERT OR
UPDATE OR DELETE, FOR EACH ROW) attached to every agency-scoped data
table: `clients`, `policies`, `commissions`, `insurers`, `product_lines`,
`transactions`, `insurer_receipts`, `statement_lines`,
`commission_allocations`, `agent_rates`, `agent_earnings`,
`agent_payouts`, `policy_renewals`, `renewal_activities`,
`agency_invites`, and any other table with an `agency_id` column that the
builder finds (grep the migrations). It raises
`subscription_read_only` (SQLSTATE `P0001`, message
"Subscription inactive: the agency is read-only until payment") when
`agency_access(NEW.agency_id or OLD.agency_id)` is `read_only`.

That list is a floor, not a ceiling: every table with an `agency_id`
column is guarded unless named below.

Not guarded: `agencies`, `users` (membership changes go through RPCs
that check separately), `subscription_payments`, `subscription_tiers`,
`reports`. The Owner can still edit agency settings and the Paystack
webhook can still write payments while read-only.

Trigger fires for RPC writes too (SECURITY DEFINER doesn't skip
triggers), so no RPC needs an extra check for read-only. Service-role
writes from Edge Functions bypass RLS but not triggers; the webhook only
touches unguarded tables, so that is fine.

**System-write bypass (my call).** Some writes must go through regardless
of subscription state: seeding product lines inside
`create_agency_with_owner` (a new agency is read-only until it pays),
`accept_invite`, and the cross-agency batch jobs
(`mark_overdue_commissions`, `auto_create_renewal_reminders`, the
renewal-reset trigger, derived-status triggers). The trigger skips its
check when `current_setting('ams.system_write', true) = 'on'`. Only
SECURITY DEFINER functions set it, with `PERFORM
set_config('ams.system_write', 'on', true)` (transaction-local), and only
the functions named here plus any trigger function that fires as a
side-effect of another write. User-facing RPCs (`renew_policy`,
`create_insurer_receipt`, …) must not set it. A lapsed agency's data
therefore keeps being maintained (overdue marking, renewal rows), but
nobody in the agency can add or change anything.

Why this is safe: browser clients reach Postgres only through PostgREST,
which exposes tables and the RPCs in `public`; `set_config` lives in
`pg_catalog` and is not callable through the API, so the only way to
set the GUC is from inside a function we wrote. The rule for the
builder: no function granted to `authenticated` or `anon` sets the GUC
except the ones named above, and the SQL test lists every function that
contains `ams.system_write` and asserts it is one of them.

Limits, checked where the count changes:

- `create_invite` raises `member_limit` ("Your plan allows N team
  members. Upgrade to add more.") when active users + pending invites ≥
  the tier's `max_members`.
- `accept_invite` re-checks the same (an invite may be accepted after a
  downgrade).
- `enforce_subscription` on `policies` INSERT, and on UPDATE to status
  `active`/`pending` from another status, raises `policy_limit` when the
  active/pending count ≥ the tier's `max_active_policies`. Renewal's
  `renew_policy` inserts a policy, so it hits the same check.

The frontend maps `subscription_read_only`, `member_limit` and
`policy_limit` messages to a toast with an "Upgrade" link to Billing
(Owner) or "Ask your Owner" (others). A small helper
`subscriptionErrorMessage(err)` in `src/lib/subscription.ts` does the
mapping; mutations already surface RPC errors through toasts.

## Paying

### Tables

`subscription_tiers(key text pk, name text, price_kes integer,
max_members integer null, max_active_policies integer null,
sort_order int)` seeded with the four rows. RLS: readable by
authenticated.

`subscription_payments(id uuid pk, agency_id uuid fk, tier text fk,
months int, amount_kes integer, paystack_reference text unique,
channel text, status text check in ('pending','paid','failed'),
paid_until_before date, paid_until_after date, created_at, paid_at,
raw jsonb)`. RLS: Owner of the agency can SELECT; no client writes.

### Edge Functions (Deno, `supabase/functions/`)

Secrets: `PAYSTACK_SECRET_KEY`, `RESEND_API_KEY`, `APP_URL`
(`https://insurance-management-system-ams.vercel.app`).

1. `paystack-initialize` — POST, needs the user's JWT. Body `{tier,
   months}`. Verifies caller is Owner of their agency (reads `users`
   with the caller's JWT), computes amount = price × months (upgrade
   maths below), inserts a `pending` payment row (service role), calls
   Paystack `POST /transaction/initialize` with `amount` in cents,
   `currency: 'KES'`, `email` = owner email, `channels: ['mobile_money',
   'card']`, `reference` = the payment row id, `callback_url` =
   `${APP_URL}/billing/return`, `metadata: {agency_id, tier, months}`.
   Returns `{authorization_url}`. Client redirects there.
2. `paystack-webhook` — POST, no JWT. Verifies `x-paystack-signature`
   (HMAC SHA-512 of the raw body with the secret key); rejects otherwise
   with 401. On `charge.success`: calls RPC
   `public.apply_subscription_payment(p_reference, p_channel, p_raw)`
   (service role). Returns 200 fast; other events are acknowledged and
   ignored.
3. `paystack-verify` — POST with JWT, body `{reference}`. Calls Paystack
   `GET /transaction/verify/:reference`; if `status = success`, calls the
   same `apply_subscription_payment`. This is the belt to the webhook's
   braces: the return page calls it so the Owner sees "paid" even if the
   webhook is a few seconds behind. Idempotent.
4. `subscription-reminders` — invoked daily by `pg_cron` + `pg_net` at
   06:00 Nairobi. Selects agencies whose `paid_until` is today + 7 or
   today + 1, or whose grace ends today (`paid_until = today − 3`), and
   emails the Owner through Resend. Templates in the function; plain
   text plus a button to `${APP_URL}/settings/billing`.

### `apply_subscription_payment(p_reference text, p_channel text, p_raw jsonb)`

SECURITY DEFINER, callable only by service role (revoke from
authenticated and anon). Locks the payment row; if already `paid`,
returns without change (idempotent). Otherwise, inside one transaction:

- base = greatest(`paid_until`, today)
- new `paid_until` = base + months × 1 month, except for an upgrade
  (below)
- set `subscription_tier` = payment.tier, mark payment `paid`, record
  `paid_until_before/after`, `paid_at = now()`, `channel`, `raw`.

### Upgrade, downgrade

- Upgrade mid-cycle (new tier price > current tier price and agency is
  `active` or `grace`): one checkout can both switch tier and extend.
  amount = (new − current) × remaining_days ÷ 30, rounded up to the next
  shilling, plus `months` × new price (months may be 0). On payment the
  tier switches and `paid_until` = base + months. The dialog shows the
  two lines ("Difference for the rest of this month" and "N more
  months") and the total.
- Downgrade: there is no scheduled downgrade. The Owner picks a lower
  tier when they next pay; `paystack-initialize` refuses if current
  active members or policies exceed the lower tier's limits
  ("Remove N members first").
- Paying the same tier while active just extends `paid_until`.

### Frontend

- `src/lib/subscription.ts`: tier table, `agencyAccess(agency)` mirror of
  the SQL function for display, `upgradeAmount(...)`, error mapping.
  Unit tests.
- `src/hooks/subscription.ts`: `usePayments()`, `useInitializePayment()`
  (calls the Edge Function with `supabase.functions.invoke`),
  `useVerifyPayment()`.
- Settings gets tabs; **Billing** is one of them, and `/settings/billing`
  is a route that opens Settings on that tab (so emails, the banner and
  the sign-up redirect have a stable link). Billing tab (Owner only): current tier, status
  (Active until d / In grace, expires d / Read-only), "Pay" button
  opening a dialog: tier radio with limits, months select (1/3/6/12),
  total, "Pay with Paystack". Upgrade dialog shows the pro-rated amount.
  Below: payments table (date, tier, months, amount, channel, status).
- Route `/billing/return`: reads `reference` from the query string,
  calls `useVerifyPayment`, shows "Payment received, you're active until
  d" or "We haven't seen the payment yet; it can take a minute", then
  links to the dashboard.
- Global banner in `AppLayout` (all roles): grace → amber "Subscription
  expires in N days"; read_only → red "Read-only: the agency's
  subscription has lapsed" with "Pay now" (Owner) or "Ask your Owner".
  Buttons that write stay enabled; the database refuses and the toast
  explains, so the UI has one source of truth.
- Sign-up: after `create_agency_with_owner` succeeds the new agency is
  `read_only` with no data. Register redirects to `/settings/billing`
  with a welcome state: "Pick a plan to start". Dashboard works
  read-only meanwhile. `isOwner` gating as today.
- `AuthContext` already loads `agency`; add the new columns to the
  `Agency` type.

## Legal pages and consent

- Routes `/privacy` and `/terms`, public (added to `isPublicAuthPath`),
  rendered from Markdown-ish constants in `src/legal/privacy.ts` and
  `src/legal/terms.ts` with the same `BrandLockup` header as login.
  Content covers Kenya's Data Protection Act 2019 basics: what we store
  (agency, staff, client and policy data), why, where (Supabase
  eu-west-1), retention (while the agency is a customer, deleted on
  request), rights (access, correction, deletion via the contact
  address), the agency as data controller and the AMS as processor.
  Terms: service, payment and read-only on lapse, data ownership,
  acceptable use, termination, governing law Kenya.
- The legal entity name and contact email are constants in
  `src/legal/entity.ts`. **Needs the user's answer** (see Open to the
  user). Until given, the builder uses `AMS` and `support@…` placeholders
  and the plan marks it as a launch blocker.
- Register and Join pages: a required checkbox "I agree to the Terms and
  the Privacy Notice" with links; `create_agency_with_owner` and
  `accept_invite` take `p_terms_accepted boolean` and refuse when false;
  `agencies.terms_accepted_at` is set on agency creation, and
  `users.terms_accepted_at` (new column) on both.
- Login page footer: links to Privacy and Terms.

## Testing

- SQL test `supabase/tests/015_subscriptions.sql` (BEGIN…ROLLBACK, prints
  ALL PASSED): access states (active, grace day 3, read-only day 4,
  complimentary, never-paid); trigger blocks insert/update/delete on a
  read-only agency and allows them on active; `apply_subscription_payment`
  extends from today when lapsed and from `paid_until` when active,
  idempotent on repeat, switches tier; upgrade keeps `paid_until`;
  member limit on invite and accept; policy limit on insert and on
  status change; `renew_policy` hits the policy limit; webhook RPC not
  callable as authenticated.
- Vitest: tier table matches SQL (snapshot of the four rows), access
  mirror, upgrade amount rounding, error mapping, months × price totals.
- Edge Functions: signature check unit-tested with Deno test (valid,
  tampered, missing).
- Manual: Paystack test keys, M-Pesa test number and test card through
  the real checkout on a Vercel preview; webhook pointed at the project's
  functions URL.

## Rollout

- Migration `015_subscriptions.sql`. Applied to ERP Demo through MCP as
  before. Demo agency comped; other existing agencies get 30 days.
- Edge Functions deployed with `supabase functions deploy`; secrets set
  with `supabase secrets set` (the user holds the Paystack and Resend
  keys; the builder never commits them).
- Paystack dashboard: webhook URL set to
  `https://frzjhknbocuaduuduxkk.supabase.co/functions/v1/paystack-webhook`
  (test and live). The user does this; the plan lists it.
- `pg_cron` schedule created in the migration, calling the reminders
  function through `pg_net` with the service key stored in Vault.

The reminders function ships with the migration, but the `pg_cron` job
is created disabled and switched on only once the sender address exists
(my call). Launch without reminders is acceptable: the in-app banner
still warns everyone who signs in.

## Open to the user

1. Legal entity name and the contact email for data requests (needed
   before launch; placeholders until then).
2. Sender address for reminder emails (a domain verified in Resend).
3. A Paystack business registered in Kenya with M-Pesa enabled, with
   test and live secret keys. Without M-Pesa live, launch relies on cards
   and comping.

## Left to the builder

- Exact wording of the legal pages beyond the points listed.
- Edge Function error handling and logging detail.
- Which `agency_id` tables exist beyond the list above (grep).
- Rounding in `upgradeAmount` beyond "round up to the shilling".
