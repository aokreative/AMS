# Leads + Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A leads pipeline with a contact log and conversion to a client and policy; a redesigned look with a light/dark toggle, a collapsible sidebar and a new dashboard.

**Architecture:** Two new agency tables, written only through SECURITY DEFINER RPCs (the same pattern as renewals in 014). The React pages use React Query hooks. The redesign is token-level CSS plus new layout and dashboard components.

**Tech Stack:** Supabase Postgres 17, React + Vite + Tailwind v4 (CSS variables), shadcn/ui, wouter, React Query, Vitest.

**Spec:** docs/superpowers/specs/2026-11-24-leads-and-redesign-design.md

## Global Constraints
- Functions use `SECURITY DEFINER SET search_path = public`, REVOKE from PUBLIC and anon, and GRANT to authenticated only when the app calls them.
- New table triggers include `WHEN (current_setting('ams.demo_restore', true) IS DISTINCT FROM 'on')`. After the tables exist, the migration runs `SELECT public._demo_save_snapshot();`.
- "Today" means `(now() AT TIME ZONE 'Africa/Nairobi')::date`.
- SQL tests run as BEGIN…ROLLBACK and print ALL PASSED.

## Review Focus
1. An agent reading, changing or converting a lead assigned to someone else.
2. Writes to leads by an unpaid or suspended agency.
3. A demo reset after migration 020: leads must be restored, not left over.
4. Theme flash on load, and dark-mode contrast for the status colours.
5. The collapsed sidebar on md widths: tooltips, keyboard focus, and the active state.

### Task 1: Database (migration 020 and test 020)
**Files:** `supabase/migrations/020_leads.sql`, `supabase/tests/020_leads.sql`

**Produces:**
- tables `leads` and `lead_activities` (see the spec);
- view `lead_pipeline` (`stage`, `count`, `quoted_total`) under RLS (security_invoker);
- RPCs `create_lead`, `update_lead`, `log_lead_contact`, `move_lead`, `mark_lead_lost`, `reopen_lead`, `assign_lead`, `delete_lead`, `convert_lead`.

- [ ] Test:
  - an agent can't see or change another agent's lead;
  - the first contact moves new → contacted;
  - a contact with a premium sets `quoted_premium`, and one with a date sets `next_follow_up`;
  - moving backwards is refused;
  - lost without a reason is refused;
  - reopening returns the lead to its previous stage;
  - converting before paid is refused;
  - converting creates a client and a pending policy and links them, and a second convert is refused;
  - only owners and managers can assign or delete;
  - an unpaid agency can't create leads;
  - anon has no access.
- [ ] Run it to watch it fail, apply the migration, run it again to see it pass, then re-run 019.
- [ ] Commit.

### Task 2: Leads screens
**Files:**
- Create: `src/hooks/leads.ts`, `src/lib/leads.ts` (+ test), `src/pages/leads.tsx`, `src/components/leads/LeadDrawer.tsx`, `src/components/leads/LeadForm.tsx`.
- Modify: `App.tsx` (route), `AppLayout.tsx` (navigation), `src/i18n/locales/*` (nav label).

**Produces:** `LEAD_STAGES`, `nextStages(stage)`, `isFollowUpDue(lead, today)` and `stageLabel`, all tested.

- [ ] Tests for the lib helpers, RED then GREEN. Build the pages. Typecheck and run Vitest. Check in the browser at phone and desktop widths if a sign-in is available.
- [ ] Commit.

### Task 3: Redesign
**Files:** `index.html` (fonts and the no-flash theme script), `src/index.css` (tokens for light and dark), `src/lib/theme.ts` (+ test), `src/components/ThemeToggle.tsx`, `src/layouts/AppLayout.tsx` (collapsible rail and toggles), `src/pages/dashboard.tsx` (ribbon, Today, This month), `src/components/dashboard/*`.

**Produces:** `resolveTheme(pref, systemDark)`, `readTheme()`, `writeTheme()`, `readSidebar()`, `writeSidebar()`.

- [ ] Tests for the theme helpers, RED then GREEN. Build. Check public pages in both themes at 375 and 1280px. Typecheck and run Vitest.
- [ ] Commit.

### Task 4: Finish
- [ ] README (020, leads, theme). Memory.
- [ ] Final review by a fresh reviewer; fix Critical and Important findings test-first.
- [ ] Push and open the PR.
