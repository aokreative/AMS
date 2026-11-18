# Superadmin — design

Status: approved in chat 2026-11-18.

## Purpose

The AMS operator (ANDO KREATIVE) needs one place to supervise every agency on the platform and to act on its subscription: suspend or reactivate it, give it a special price, free time or a plan change. Referral commission is out of scope: partners are sales accounts in the operator's CRM, and their commission is tracked there. This superadmin covers AMS only; Duka POS is a separate system.

## Who gets in

- Table `platform_admins(user_id → auth.users, created_at)`. No client access: no RLS policies, all privileges revoked.
- `is_platform_admin()` (SECURITY DEFINER, granted to `authenticated`) returns whether `auth.uid()` is listed.
- A superadmin is an **admin-only account**: an auth user that belongs to no agency. The operator creates it in Supabase → Authentication → Add user (auto-confirm), and it is added to `platform_admins` by SQL. No UI to add admins.
- In the app, a signed-in superadmin with no agency profile is sent to `/admin` instead of `/register`. `/admin` shows "Not found" to anyone else. Every admin RPC checks `is_platform_admin()` and raises `Only a superadmin can do that` (42501).

## What the superadmin sees (`/admin`)

- **Totals:** agencies by status; expected monthly revenue (sum of the monthly price of every active or grace agency that is not comped or suspended, using the custom price where set); revenue paid this calendar month (Nairobi).
- **Status** of an agency, in this order: `suspended` (suspended_at set) → `comped` (complimentary_until ≥ today) → `active` (paid_until ≥ today) → `grace` (paid_until + 3 ≥ today) → `unpaid`.
- **Agency table**, searchable by agency name or Owner name/email and filterable by status: name, status, plan, monthly price (custom marked), paid-until, members (active), active policies, Owners (name, email, phone), last paid payment, created date.
- **Agency detail** (side panel): the same facts, its subscription payments (newest first, all statuses), and the admin log for that agency.

## What the superadmin can do

Each action requires a note (non-empty after trim; error `Add a note`), and writes one row to `admin_actions(id, agency_id, admin_id, action, before jsonb, after jsonb, note, created_at)`. The log is readable only through the detail RPC.

| Action | Effect | Errors |
|---|---|---|
| Suspend | `suspended_at = now()`, `suspended_reason = note` | already suspended → `Already suspended` |
| Reactivate | clears both | not suspended → `Not suspended` |
| Custom price | `custom_price_kes` = whole KES > 0, or NULL to clear | ≤ 0 → `Enter a price above 0` |
| Free time | `complimentary_until` = date ≥ today, or NULL to remove | past date → `Pick today or a later date` |
| Set paid-until | `paid_until` = date (any; used after cash/bank payments or to correct) | NULL → `Pick a date` |
| Change plan | `subscription_tier` = key | unknown → `Pick a plan` |

Plan changes don't check limits. An agency over the new plan's limits keeps what it has but can't add more, because the existing limit checks still run.

## Suspension

- `agency_access()` returns `suspended` first. `enforce_subscription` refuses every write for a suspended agency with `This account is suspended` (HINT `account_suspended`). The read-only exception that lets an unpaid agency cancel policies doesn't apply to a suspended one.
- `paystack-initialize` refuses with 403 `This account is suspended`.
- In the app, every member of a suspended agency sees a full-screen "This account is suspended" with the reason and a Sign out button. This takes priority over the pay screen.

## Custom price

- `agencies.custom_price_kes` replaces the monthly price of the agency's **current** plan. Other plans keep their standard prices.
- Shared helper `withCustomPrice(tiers, currentTier, customPriceKes)` returns the tier list with that one price replaced. Both `paystack-initialize` (server, the source of truth) and `PlanPicker` (display) price through it. Pro-rated upgrades therefore measure from the custom price.
- A payment already open when the price changes is charged at the price it was opened with.

## Not in this version

- Custom limits per agency.
- Signing in as an agency (impersonation).
- Admin management UI.
- Partner commission.
- Duka POS.
