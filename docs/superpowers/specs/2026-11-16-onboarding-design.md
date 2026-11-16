# Sign-up with email code, setup wizard, currencies, languages, multiple owners — design

Date: 2026-11-16. The user asked to "make all those changes" (no further questions); the calls below are the implementer's, stated to the user before building.

## Why

Sign-up is stuck: Supabase has "Confirm email" on and the app has no confirmation step. The user is taking the AMS international (Kenya, Tanzania, Uganda, USD markets) and wants a guided owner setup and plan-based multiple owners.

## Flow

1. **Register** (agency name, your name, email, password, consent) → `supabase.auth.signUp`.
2. **Email code**: if no session comes back, show a 6-digit code screen → `supabase.auth.verifyOtp({ email, token, type: 'signup' })`. "Resend code" → `supabase.auth.resend({ type: 'signup', email })` (60 s cooldown). Signing in with an unconfirmed account (`Email not confirmed`) goes to the same screen. Requires the Supabase "Confirm signup" email template to include `{{ .Token }}` (user pastes it; see docs/LAUNCH.md).
3. After verification the app creates the agency (`create_agency_with_owner`, name kept from step 1 in sessionStorage) and opens **/onboarding**.
4. **Setup wizard** (Owner): Language → Currency → Plan. Language and currency saved with `complete_agency_setup(p_language, p_currency)` which sets `agencies.setup_completed_at`. Plan step embeds the plan picker; "Pay with Paystack" or "I'll pay later" (agency stays read-only, banner explains).
5. Owners whose agency has `setup_completed_at IS NULL` are redirected to /onboarding. Others are not affected.

## Currency

- `agencies.currency` in ('KES','TZS','UGX','USD'), default 'KES'. Every amount in the app is shown in the agency currency: `formatCurrency` reads the current agency currency (set by AuthContext), so the 46 call sites keep working. Hard-coded "KES" strings switch to the currency code.
- Amounts are stored as plain numbers; changing currency after data exists is not a conversion. Only allowed in setup (Settings shows it read-only with a note).
- Subscription prices stay in KES (Paystack Kenya). Shown as KES everywhere in Billing.

## Languages

- `users.language` (preferred) with `agencies.language` as the default for new members; codes 'en','sw','fr','pt','es','ar'. Arabic sets `dir="rtl"`.
- i18next + react-i18next; translations in `src/i18n/locales/<code>.json`. First pass translated: auth pages (login, register, code, forgot/reset, join), onboarding, sidebar navigation, billing, banner, common buttons. Other pages fall back to English (i18next fallback) and are translated in a follow-up.
- Language switcher in the sidebar user menu and in onboarding; saved to `users.language` via `set_my_language`.

## Multiple owners

- `subscription_tiers.max_owners`: Starter 1, Growth 2, Enterprise 3, Enterprise Plus NULL (unlimited). Owners count as members too.
- Owners can invite an Owner (`create_invite(email, 'owner')`) and promote/demote with `change_member_role` (roles owner/manager/agent), within the owner limit; comped agencies exempt. `agency_invites.role` allows 'owner'.
- The last active Owner cannot be demoted or removed. An Owner can remove another Owner.
- `subscription_check_tier` also checks owners. Reminder emails go to every active Owner.

## Not in scope

Billing in TZS/UGX/USD; translating every deep page now; currency conversion.
