# Agency Management System (AMS)

A multi-tenant SaaS platform for Kenyan insurance agencies. Agencies manage clients, policies, commissions, and renewal tracking — all scoped per-agency with Supabase RLS.

## Run & Operate

- `pnpm install` — install dependencies (pnpm only; npm/yarn are blocked)
- `pnpm --filter @workspace/ams run dev` — frontend dev server on http://localhost:5173
- `pnpm --filter @workspace/ams run build` — production build to `artifacts/ams/dist/public`
- `pnpm run typecheck` — typecheck all packages
- `npx -y pnpm@10.28.0 --filter @workspace/ams run test` — frontend unit tests

Create `artifacts/ams/.env.local` with:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

## Stack

- **Frontend:** React + Vite + Tailwind (`artifacts/ams`), routing with wouter
- **Backend:** Supabase only (Postgres + RLS + Auth + RPC functions) — there is no API server
- **State:** React Query wrapping Supabase client calls directly
- **Hosting:** Vercel (static build), project root `artifacts/ams`

## Where things live

- `artifacts/ams/src/` — React frontend
  - `contexts/AuthContext.tsx` — session, profile, agency state; `refreshProfile()` for post-signup reload
  - `lib/supabase.ts` — Supabase client (anon key)
  - `lib/types.ts` — TypeScript types for all DB tables
  - `hooks/queries.ts` — React Query hooks wrapping Supabase
  - `pages/` — all pages
  - `layouts/AppLayout.tsx` — persistent sidebar layout
- `artifacts/ams/vercel.json` — Vercel output directory + SPA rewrite
- `supabase/migrations/` — SQL migrations, run in order

## Architecture decisions

- Supabase RLS enforces multi-tenancy at the DB layer; every table has `agency_id` with the `current_user_agency_id()` helper
- Privileged operations are Postgres functions called with `supabase.rpc(...)`, not a server:
  - `create_agency_with_owner` — signup: creates agency + owner row + seeds default Kenyan product lines
  - `generate_monthly_report` — owner/manager only; computes the month's metrics and stores a `reports` row (runs under the caller's RLS)
- Signup flow: `supabase.auth.signUp` → `rpc('create_agency_with_owner')` → `refreshProfile()` — avoids the race where `SIGNED_IN` fires before the `users` row exists
- Access is role-scoped in the database (RLS + checked RPCs), not just in the UI; see "Roles & access" below
- Team RPCs (all `SECURITY DEFINER`, role-checked inside): `create_invite`, `revoke_invite`, `get_invite_preview` (anon, by code), `accept_invite`, `reassign_client`, `change_member_role`, `remove_member`
- Staff join by invite link (`/join?code=...`); the code is stored only as a sha256 hash and expires after 7 days

## Roles & access

Three fixed roles, enforced by Postgres RLS and role-checked RPCs. An Agent calling the API directly with their own token cannot see other agents' data either.

| | Owner | Manager | Agent |
|---|---|---|---|
| Clients | All, full edit | All, full edit | Only clients assigned to them; no delete |
| Policies | All, full edit | All, full edit | Only their own; no delete |
| Commissions | All; mark received | All; mark received | Read only, on own policies |
| Renewal pipeline | Any policy; reopen lost | Any policy; reopen lost | Own policies, when the agency allows it |
| Billing (plan, payments) | Yes | No | No |
| Invite / promote Owners | Yes (within plan) | No | No |
| Reports & company totals | Read, generate | Read, generate | None |
| Insurers, product lines | Edit | Edit | Read |
| Team list | All members | All members | Own row only |
| Agency settings | Edit | Read | Read |
| Agent rates | Edit | View | Own only |
| Agents-update-renewals switch | Edit | Read | Read |
| Invite staff | Managers and agents | Agents only | No |
| Change roles, remove staff | Yes | No | No |

Each agency has exactly one Owner. Removing a member deactivates them (history is kept) and moves their clients and active/pending policies to another member. Full design: `docs/superpowers/specs/2026-11-01-team-access-control-design.md`.

Demo logins exist for the demo agency: `demo@ams.co.ke` (Owner), `manager@ams.co.ke` (Manager), `agent@ams.co.ke` (Agent). Passwords are held by the project owner.

## Database

Supabase project: **ERP Demo** (`frzjhknbocuaduuduxkk`). Migrations 001–016 are applied
(`006a` is its own file and must be run after 006; `007a` and `008a` were live follow-ups folded into `007` and `008`; `009a`, `010a` and `010b` were live follow-ups folded into `009` and `010`).
New migrations go in `supabase/migrations/` and should be applied in order.

| Migration | Adds |
|---|---|
| 001 | Initial schema and RLS |
| 002 | Auto renewal reminders |
| 003 | Agent-scoped commission RLS |
| 004 | `generate_monthly_report` |
| 005 | Lock down `SECURITY DEFINER` functions |
| 006 | Team access control: roles, client assignment, role-scoped RLS, deactivation |
| 006a | Guard: only owners/managers can change `policies.commission_received` |
| 007 | Agency invites and invite RPCs |
| 008 | Team management RPCs (reassign, change role, remove) |
| 009 | Reconciliation schema: insurer receipts, statement lines, commission allocations, derived commission status, per-premium commissions |
| 010 | Reconciliation RPCs: `create_insurer_receipt`, `link_statement_line`, `undo_commission_allocation`, `delete_insurer_receipt` (drops `mark_overdue_commissions`) |
| 011 | Opening balances for commissions received before the system |
| 012 | Reconciliation follow-ups: monthly report by receipt date, undo unmatches the line, apply_receipt_allocations |
| 013 | Agent commission & payouts: rates, earnings ledger, payouts |
| 013a | Payout follow-ups: expected-total guard on create_agent_payout, reversal/adjustment dating (Africa/Nairobi), rates for removed members, remove_member clears rates |
| 014 | Renewal pipeline: stages, history, renew_policy, agents switch, policy numbers unique only among active terms, placeholder reminders retired, renewal figures in the monthly report |
| 015 | Subscriptions: tiers, paid-until / comp dates, read-only trigger on every agency table, member and policy limits, Paystack payment RPCs, consent recorded at sign-up and join, daily reminder cron job (off until set up) |
| 015a | Subscription review fixes: billing columns locked, stale payments held for review, lapsed agencies can reduce usage |
| 016 | Onboarding: agency currency and language, setup_completed_at, user language, owners per plan, multiple owners |
| 018 | Superadmin: platform_admins, admin_actions log, agency suspension / custom price columns, admin_* RPCs gated by is_platform_admin(), suspended agencies refused every write |
| 018a | Superadmin review fixes: a plan change clears the custom price; suspension also blocks agency profile/settings, member records, settings history and receipt file uploads/deletes |

### Running the database tests

`supabase/tests/` holds one script per feature (`006` to `015`: team access, invites, team management, reconciliation schema, reconciliation RPCs, opening balances, reconciliation follow-ups, agent payouts, payout follow-ups, renewal pipeline, subscriptions). Test fixtures comp their agencies so the subscription trigger doesn't block them. Paste each file into the Supabase SQL editor, or run it through the Supabase MCP `execute_sql`. Each runs inside a transaction that is always rolled back (nothing is saved) and prints `ALL PASSED`; a failed assertion aborts the batch with the reason.

## Receipts & reconciliation

A **receipt** is one payment from an insurer (date, amount, bank reference, optional statement file). It may carry **statement lines** (policy number, client, premium, commission, period). Lines that match a policy are applied to that policy's outstanding commissions; a lump-sum receipt is allocated to chosen commissions directly. Money that is not allocated stays on the receipt as **unapplied** and can be linked later to an unmatched line, or applied to outstanding commissions from the receipt page ("Apply unapplied money").

- Commission status is derived: `pending` (nothing received), `part-paid`, `received`. **Overdue** is computed from the expected date, not stored.
- Per-premium (e.g. life) policies get a new statement-sourced commission for each line.
- Owners and Managers record receipts, link lines and undo allocations or delete receipts. Agents cannot; they see the received amounts on their own commissions.
- Full design: `docs/superpowers/specs/2026-11-03-statement-reconciliation-design.md`.

## Agent commission & payouts

Agents earn their rate x the commission actually received from the insurer (not on expected commission).

- Each agent has a default rate plus optional product-line overrides (Owner edits, Manager views). The rate is locked on each earning when it is created, so later rate changes do not alter past earnings.
- Owners and Managers pay per agent up to a chosen date, by M-Pesa, bank or cash, with a reference.
- Reversals (e.g. an undone receipt) are deducted from the agent's next payout.
- Owners can add adjustments and void payouts.
- Printable statements per payout.
- Agents see only "My earnings" (their own earnings and payouts).

## Renewal pipeline

Every active policy expiring within 90 days (or already expired) is in the pipeline: **To contact → Contacted → Quoted → Renewed / Lost**. Nobody has to add it by hand.

- **Log contact** (phone, WhatsApp, SMS, email, in person), **Record quote** (insurer + premium; a newer quote replaces the old) and **Mark lost** (reason: price, went to another agent/insurer, no longer needs cover, no response, other) are kept as a history per renewal.
- **Renew** creates the next-term policy in one step (same client and agent, pre-filled dates, insurer and premium from the latest quote), links it, marks the old policy expired, and the new policy's expected commission is created as usual. Deleting that new policy puts the renewal back where it was.
- A renewed term may keep the old policy number: numbers are unique only among active/pending policies, and statement matching picks the term that still has commission outstanding.
- Owners and Managers can update any renewal and reopen lost ones. Agents can update renewals of their own policies while **Settings → Agency → Agents can update their own renewals** is on (Owner switch, on by default). Enforced in the database.
- The Renewals page shows due in 30 days, overdue, renewal rate (renewed ÷ renewed + lost, by month closed) and premium renewed; the monthly report adds `renewals_renewed`, `renewals_lost` and `renewal_rate`.
- The old auto-scheduled 90/60/30-day placeholder reminders were never sent, so migration 014 removed them; manually logged reminders were copied into the renewal history. Automatic WhatsApp/email reminders belong to the automated-reports phase.
- Full design: `docs/superpowers/specs/2026-11-11-renewal-pipeline-design.md`.

## Subscriptions

| Plan | KES / month | Team members | Active policies |
|---|---|---|---|
| Starter | 3,500 | 3 | 300 |
| Growth | 7,000 | 10 | unlimited |
| Enterprise | 15,000 | 25 | unlimited |
| Enterprise Plus | 30,000 | unlimited | unlimited |

- No free trial and no read-only mode: **pay to access**. A new agency sees only the pay screen until the Owner's first payment goes through. A public `/demo` page (linked from sign-in and sign-up) lets anyone try the setup steps with sample data.
- Pay-to-renew: the Owner pays 1, 3, 6 or 12 months through Paystack (M-Pesa or card); time adds on to the current paid period. Upgrading mid-period charges the pro-rated difference for the days left, optionally plus more months.
- 3 days of grace after `paid_until` (full access, warning banner), then **access stops**: everyone sees the pay screen instead of the app (Owners can pay there and download clients and policies as CSV; others are asked to get an Owner to renew). The database trigger still refuses every write while unpaid, as a backstop.
- Limits are enforced in the database: invites count pending invites; adding or re-activating a policy counts active/pending policies; renewing a term doesn't add one.
- Comp an agency (partner, pilot): `update agencies set complimentary_until = '2027-06-30' where id = '…';` Comped agencies have no limits. The demo agency is comped to 2099.
- Paystack and the reminder emails run as Supabase Edge Functions; see `supabase/functions/README.md` for secrets and setup, and `docs/LAUNCH.md` for the go-live checklist.

## Sign-up, setup, languages and currencies

- **Sign-up:** details → 6-digit email code (Supabase "Confirm signup" template must contain `{{ .Token }}`; see `docs/LAUNCH.md`) → agency created → **setup wizard** at `/onboarding`: language → currency → plan (pay with Paystack; payment is required to open the agency; clicking a plan shows who it suits, its limits and what it adds). Owners of an agency whose setup isn't finished are sent back to the wizard. Signing in with an unconfirmed email asks for a code too.
- **Currencies:** each agency works in KES, TZS, UGX or USD (`agencies.currency`, chosen once in setup). Every amount in the app shows in it (`formatCurrency` → `lib/money.ts`). Plans are still billed in KES.
- **Languages:** English, Kiswahili, French, Portuguese, Spanish, Arabic (right-to-left). Per person (`users.language`, switcher in the sidebar and on sign-in pages). Translations live in `artifacts/ams/src/i18n/locales/*.json`; a test checks every language has every key. Sign-in, sign-up, code, setup, menus, plans and the banner are translated; other pages fall back to English for now.
- **Owners per plan:** Starter 1, Growth 2, Enterprise 3, Enterprise Plus unlimited. Owners can invite an Owner or promote a member; the last Owner can't be demoted, and nobody can remove themselves. Reminder emails go to every Owner.

## Superadmin

- `/admin` is for platform superadmins only (everyone else gets Not found). A superadmin is an **admin-only account** that belongs to no agency; after sign-in it lands on `/admin`.
- Shows every agency with status (active / grace / unpaid / free / suspended), plan, price, paid-until, members, active policies, Owners and last payment, plus totals: expected monthly revenue and money paid this month.
- Actions (each needs a note and is logged in `admin_actions` with before/after): **suspend / reactivate**, **custom monthly price** (replaces the price of the agency's current plan; Paystack charges it), **free time** (`complimentary_until`), **set paid-until** (cash/bank payments), **change plan** (no payment).
- A suspended agency's members all see "This account is suspended" with the reason; the database refuses every write and `paystack-initialize` refuses payment.
- **Add a superadmin:** create the user in Supabase → Authentication → Add user (auto-confirm, an email not used by any agency), then run
  `insert into platform_admins (user_id) select id from auth.users where email = '<that email>';`
- Referral partner commission is not tracked here (it lives in the CRM).

## Deploying (Vercel)

Project `insurance-management-system-ams`, root directory `artifacts/ams`. Pushing to `main` deploys.
Required env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

## Phase build plan

- ✅ Phase 1: Foundation — schema + RLS + auth + all core pages
- 🔲 Phase 2: Core CRUD (clients, policies, insurers, product lines — UI built, backend integration next)
- 🔲 Phase 3: Commission & renewal tracking
- 🔲 Phase 4: Reporting dashboard with Recharts
- 🔲 Phase 5: Automated monthly reports (PDF + email/WhatsApp)
- ✅ Team & access control: Owner / Manager / Agent roles, invites, team management, role-based views
- ✅ Statement reconciliation: insurer receipts, statement lines, applied/unapplied money, part-paid commissions
- ✅ Agent commission & payouts: agent rates, earnings ledger, payouts, statements, My earnings
- ✅ Renewal pipeline: contacted → quoted → renewed/lost, one-step renew, lost reasons, renewal rate
- ✅ Subscriptions & launch: Paystack plans, pay to access (3-day grace), plan limits, privacy notice and terms with consent
- 🔲 Phase 6: Polish (mobile-first, onboarding flow)

## Gotchas

- Disable email confirmation in Supabase Auth settings, or users won't get a session on `signUp`
- `refreshProfile()` must be called after agency setup completes, before navigating to a protected route
- The free-tier Supabase project pauses after ~1 week idle; restore it from the dashboard
