# Superadmin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A superadmin area at `/admin` to supervise every agency and suspend/reactivate, custom-price, comp, set paid-until, or change plan, all logged.

**Architecture:** Postgres holds the admin list, the action log and SECURITY DEFINER RPCs gated by `is_platform_admin()`. Suspension and custom price are agency columns enforced in the existing trigger and in `paystack-initialize`. The React app adds an admin route, an admin page, and a suspended screen.

**Tech Stack:** Supabase Postgres 17, Deno Edge Functions, React + Vite + wouter + React Query, Vitest.

**Spec:** docs/superpowers/specs/2026-11-18-superadmin-design.md

## Global Constraints

- Every function `SECURITY DEFINER SET search_path = public`. REVOKE EXECUTE from PUBLIC, anon; GRANT to authenticated only where the app calls it.
- Admin error text exactly: `Only a superadmin can do that` (42501), `Add a note`, `Already suspended`, `Not suspended`, `Enter a price above 0`, `Pick today or a later date`, `Pick a date`, `Pick a plan`, `This account is suspended`.
- "Today" = `(now() AT TIME ZONE 'Africa/Nairobi')::date`.
- SQL tests are BEGIN…ROLLBACK scripts that print `ALL PASSED`.
- Commits: aokreative, with the Co-Authored-By line.

## Review Focus

1. An agency Owner calling admin RPCs directly (raw supabase-js) must be refused.
2. A suspended agency must not be able to write through the read-only "cancel policy" exception or start a Paystack payment.
3. The custom price must be what Paystack charges (server-side), not only what the UI shows.
4. An admin-only account (no `users` row) must land on `/admin`, never loop through `/register`.
5. A superadmin with an agency profile is not supported. Admin RPCs still work for such an account, but the app routes it as an agency member.

---

### Task 1: Database (migration 018 + SQL test)

**Files:** Create `supabase/migrations/018_superadmin.sql`, `supabase/tests/018_superadmin.sql`

**Produces:**
- tables `platform_admins`, `admin_actions`
- columns `agencies.suspended_at timestamptz`, `suspended_reason text`, `custom_price_kes integer check (> 0)`
- `is_platform_admin() → boolean`
- `admin_overview() → jsonb {counts:{active,grace,unpaid,comped,suspended,total}, expected_mrr_kes, revenue_this_month_kes}`
- `admin_list_agencies() → setof jsonb`, one object per agency: id, name, status, tier, price_kes, custom_price_kes, paid_until, complimentary_until, suspended_at, suspended_reason, members, active_policies, owners[{full_name,email,phone}], last_paid_at, last_paid_kes, created_at
- `admin_agency_detail(p_agency_id uuid) → jsonb {payments:[…], actions:[{action,before,after,note,created_at,admin_email}]}`
- `admin_suspend(p_agency_id, p_note)`, `admin_reactivate(p_agency_id, p_note)`, `admin_set_custom_price(p_agency_id, p_price_kes integer, p_note)`, `admin_set_comp(p_agency_id, p_until date, p_note)`, `admin_set_paid_until(p_agency_id, p_until date, p_note)`, `admin_set_tier(p_agency_id, p_tier text, p_note)`; all return void
- `agency_access()` returns `'suspended'` first
- `enforce_subscription` raises `This account is suspended` for suspended agencies before the read-only branch

- [ ] Write the test. Assertions:
  - (a) a non-admin calling each admin RPC gets 42501;
  - (b) an admin can suspend, and a second suspend raises `Already suspended`;
  - (c) an insert into clients by a member of a suspended agency raises `This account is suspended`, and so does a policy cancel;
  - (d) reactivate clears both columns, and reactivating again raises `Not suspended`;
  - (e) an empty note raises `Add a note`;
  - (f) custom price 0 is refused, 2500 is set, NULL clears it;
  - (g) comp in the past is refused;
  - (h) unknown tier is refused;
  - (i) each successful action writes one `admin_actions` row with before/after;
  - (j) `admin_overview` counts the suspended agency under suspended, and `admin_list_agencies` returns it with status `suspended`;
  - (k) an authenticated user cannot SELECT `platform_admins` or `admin_actions`.
- [ ] Run it on the live DB: it fails because the functions don't exist yet.
- [ ] Write the migration and apply it (MCP `apply_migration`).
- [ ] Run the test: `ALL PASSED`. Re-run regression tests 015, 015a, 016a and 017: `ALL PASSED`.
- [ ] Commit.

### Task 2: Custom price + suspension in payments

**Files:** Modify `supabase/functions/_shared/billing.ts`, `supabase/functions/paystack-initialize/index.ts`. Test `artifacts/ams/src/lib/billing-shared.test.ts` (or the existing test that imports `_shared/billing`).

**Produces:** `withCustomPrice(tiers: Tier[], currentTier: string, customPriceKes: number | null): Tier[]`

- [ ] Test:
  - NULL returns the same prices;
  - 2500 on starter changes only starter;
  - `paymentAmountKes(withCustomPrice(TIERS,'starter',2500),'starter','starter',3,null,today).total === 7500`;
  - upgrading starter→growth while paid up measures from 2500.
- [ ] Run: FAIL. Implement. Run: PASS.
- [ ] `paystack-initialize`: select `custom_price_kes`, `suspended_at`; 403 `This account is suspended`; price via `withCustomPrice`. Deploy the function.
- [ ] Commit.

### Task 3: App

**Files:**
- Create `src/pages/admin.tsx`, `src/hooks/admin.ts`, `src/components/SuspendedScreen.tsx`, `src/lib/admin.test.ts`.
- Modify `src/lib/types.ts` (Agency: `suspended_at`, `suspended_reason`, `custom_price_kes`), `src/contexts/AuthContext.tsx` (`isPlatformAdmin`), `src/App.tsx` (admin route; suspended before paywall; admin with no profile → `/admin`), and `src/components/billing/PlanPicker.tsx` (prices through `withCustomPrice`, custom price marked).

**Produces:**
- `src/lib/admin.ts`:
  - `adminStatus(a, today): 'suspended'|'comped'|'active'|'grace'|'unpaid'`, same order as the spec;
  - `matchesSearch(row, q)` over name and Owner name/email.

- [ ] Tests for `adminStatus` (each state plus suspended-beats-comped) and `matchesSearch`: RED → GREEN.
- [ ] Hooks: `useAdminOverview`, `useAdminAgencies`, `useAdminAgencyDetail(id)`, `useAdminAction()`. The last calls one of the six RPCs by name and invalidates the admin queries.
- [ ] Admin page:
  - header (brand, "Superadmin", sign out);
  - totals cards;
  - status filter tabs;
  - search;
  - table;
  - row → Sheet with facts, an actions form (each action has its input plus a required note, and errors show inline), payments, and the log.
- [ ] Routing:
  - `/admin` renders the page if `isPlatformAdmin`, `NotFound` if not, and `/login` when signed out;
  - in ProtectedRoute, a signed-in admin with no profile redirects to `/admin`;
  - a suspended agency renders `SuspendedScreen`.
- [ ] Typecheck clean; Vitest all pass. Check in the browser: `/admin` signed out → `/login`. Signed-in admin views are checked only if the user provides the admin login.
- [ ] Commit.

### Task 4: Finish

- [ ] README: the superadmin section, the 018 row, and how to add an admin (SQL insert after creating the auth user). Update memory.
- [ ] Final whole-branch review (fresh reviewer, most capable model). Fix Critical/Important findings with RED→GREEN tests.
- [ ] Push and open the PR.
