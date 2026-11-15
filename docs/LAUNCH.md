# Go-live checklist

Everything in the code is done; these steps need your accounts and keys. Work top to bottom.

## 1. Legal pages (blocker)

- [ ] Edit `artifacts/ams/src/legal/entity.ts`: set `LEGAL_ENTITY_NAME` (your registered business name) and `DATA_CONTACT_EMAIL` (an inbox you read). Read through `/privacy` and `/terms` and adjust anything that doesn't match how you run the business. Have a lawyer glance at them if you can.

## 2. Supabase → Authentication

- [ ] **URL Configuration:** Site URL `https://insurance-management-system-ams.vercel.app`; add Redirect URL `https://insurance-management-system-ams.vercel.app/reset-password`.
- [ ] **Attack Protection:** turn on leaked password protection.
- [ ] **Emails → SMTP:** connect your email provider (e.g. Resend: host `smtp.resend.com`, port `465`, user `resend`, password = API key, sender on a verified domain).

## 3. Paystack

- [ ] Kenyan business account with **M-Pesa** enabled for KES.
- [ ] Supabase → Edge Functions → Secrets: `PAYSTACK_SECRET_KEY` = your **test** key (`sk_test_…`), `APP_URL` = `https://insurance-management-system-ams.vercel.app`.
- [ ] Paystack dashboard → Settings → API Keys & Webhooks → Webhook URL: `https://frzjhknbocuaduuduxkk.supabase.co/functions/v1/paystack-webhook`.
- [ ] Test: register a throwaway agency, pay 1 month of Starter with Paystack's test M-Pesa number and a test card. The return page should say "Payment received" and the banner should disappear.
- [ ] Switch `PAYSTACK_SECRET_KEY` to the **live** key (and set the live webhook URL to the same address).

## 4. Reminder emails (optional at launch)

- [ ] Secrets: `RESEND_API_KEY`, `REMINDER_FROM` (e.g. `AMS <billing@yourdomain.co.ke>`).
- [ ] SQL editor: `select vault.create_secret('<service role key>', 'service_role_key');`
- [ ] SQL editor: `select cron.alter_job((select jobid from cron.job where jobname = 'subscription_reminders_daily'), active := true);`

Without this, the in-app banner still warns everyone when a plan is about to lapse.

## 5. Smoke test

- [ ] Sign in as Owner, Manager and Agent; click through each main page.
- [ ] As a new agency before paying: confirm you can browse but adding a client is refused with the read-only message.
