# Edge Functions (subscriptions)

| Function | JWT | What it does |
|---|---|---|
| `paystack-initialize` | Owner's JWT | `POST {tier, months}` → checks the agency fits the tier, records a pending payment, starts a Paystack checkout (M-Pesa or card, KES). Returns `{authorization_url, reference}`. |
| `paystack-webhook` | none (signature) | Paystack calls this. Verifies `x-paystack-signature` (HMAC-SHA512 with the secret key), checks amount and currency match the pending payment, then `apply_subscription_payment`. |
| `paystack-verify` | Owner's JWT | `POST {reference}` → asks Paystack directly and applies the payment if the webhook hasn't yet. Used by `/billing/return`. |
| `subscription-reminders` | service-role bearer | Daily via pg_cron: emails Owners 7 days and 1 day before `paid_until`, and when grace ends (via Resend). |

`_shared/billing.ts` (amount maths, signature check) is also imported by the web app and tested by Vitest.

## Secrets (Supabase → Edge Functions → Secrets)

- `PAYSTACK_SECRET_KEY` — test key first (`sk_test_…`), live key at launch.
- `APP_URL` — `https://insurance-management-system-ams.vercel.app`
- `RESEND_API_KEY`, `REMINDER_FROM` (e.g. `AMS <billing@yourdomain.co.ke>`, on a domain verified in Resend) — reminders only.

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided by Supabase.

## Paystack dashboard

Settings → API Keys & Webhooks → Webhook URL (test and live):
`https://frzjhknbocuaduuduxkk.supabase.co/functions/v1/paystack-webhook`

## Turning on reminders

1. Vault: create a secret named `service_role_key` holding the project's service-role key (SQL: `select vault.create_secret('<key>', 'service_role_key');`).
2. Activate the job:
   `select cron.alter_job((select jobid from cron.job where jobname = 'subscription_reminders_daily'), active := true);`

## Deploy

Deployed with the Supabase MCP / CLI: `supabase functions deploy <name>` (`--no-verify-jwt` for `paystack-webhook` and `subscription-reminders`).
