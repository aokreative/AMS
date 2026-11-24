# Leads pipeline and redesign: design

Status: approved in chat 2026-11-24.

## Part 1: Leads pipeline

### Purpose
Agents track prospective clients from first enquiry to a paid policy, log every contact and the figures discussed, and turn a paid lead into a client and policy in one step.

### Stages
`new → contacted → quoted → won → paid`, plus `lost`, which can be reached from any open stage.
- Open stages are new, contacted, quoted and won. Paid and lost are closed.
- Moves are explicit. The one automatic move: logging the first contact on a `new` lead moves it to `contacted`.
- A lead can only move forward one or more steps. A lost or paid lead can be reopened, which returns it to the stage before it closed.
- Lost needs a reason: `price`, `went_elsewhere`, `no_response`, `not_eligible` or `other`. A note is optional.

### Data
`leads(id, agency_id, full_name, phone, email, interest (free text, e.g. "Motor – private car"), product_line_id?, insurer_id?, source (referral|walk_in|phone|whatsapp|social|website|other), stage, previous_stage, quoted_premium numeric(12,2)?, next_follow_up date?, lost_reason?, assigned_agent_id → users, client_id?, policy_id?, notes?, closed_at?, created_by, created_at, updated_at, last_activity_at)`

`lead_activities(id, agency_id, lead_id, kind (contact|stage|lost|reopened|converted), occurred_on date, channel (call|whatsapp|sms|email|visit)?, premium?, next_follow_up?, from_stage?, to_stage?, note?, created_by, created_at)`

- A contact sets `leads.quoted_premium` when it carries a premium, and `leads.next_follow_up` when it carries a date. The latest values win.
- Every stage change writes a `stage` activity, so a lead's history shows contacts and moves on one timeline.

### Access
- Agents see and work leads where `assigned_agent_id = me`.
- Owners and managers see all leads in their agency, can reassign them, and can delete them.
- Writes go only through SECURITY DEFINER RPCs. Each RPC checks the agency and role, and the tables have no direct write grants.
- `enforce_subscription` is attached to both tables, so unpaid and suspended agencies can't write leads. Its trigger carries the demo-reset guard. The demo copy is saved again, so the reset covers leads.

### RPCs
- `create_lead(p jsonb) → uuid`. The lead is assigned to the caller, or to `p.assigned_agent_id` when the caller is an owner or manager.
- `update_lead(id, p jsonb)` changes details only: name, phone, email, interest, product line, insurer, source, notes.
- `log_lead_contact(id, occurred_on, channel, note, premium, next_follow_up)`.
- `move_lead(id, to_stage)` moves forward only, among open stages and to paid. It refuses lost (use `mark_lead_lost`) and refuses moving backwards.
- `mark_lead_lost(id, reason, note)` and `reopen_lead(id)`.
- `assign_lead(id, agent_id)`: owners and managers only.
- `delete_lead(id)`: owners and managers only.
- `convert_lead(id, p jsonb) → policy_id`. Allowed only when the lead is paid and not yet converted. It creates a client (or uses `p.client_id`) and a **pending** policy from `p`, pre-filled in the UI. It then sets `client_id` and `policy_id` on the lead and logs a `converted` activity. Policy fields follow the existing policies insert rules.

Errors are short and human-readable: `Lead not found`, `Pick a stage`, `That stage is behind the current one`, `Pick a reason`, `Only owners and managers can do that`, `Lead is not paid yet`, `Already converted`.

### Screens
- **/leads**
  - A stage bar shows the count and quoted value for each stage. Overdue follow-ups are flagged.
  - Filters: agent (owners and managers), search, and "follow-up due".
  - From md width up there's a board view with one column per stage, where leads can be dragged forward. Below md, a list for the selected stage.
- **Lead drawer:** the lead's details, stage actions (Contacted / Quoted / Won / Paid / Lost / Reopen), a "Log contact" form and a timeline of contacts and moves. On a paid lead: **Create client & policy**.
- **Navigation:** "Leads" goes after Clients.

## Part 2: Redesign

### Tokens
| Role | Light | Dark |
|---|---|---|
| background | #F6F6FA | #121120 |
| surface (cards) | #FFFFFF | #1B1A2D |
| ink (text) | #1C1A33 | #ECEBF5 |
| muted text | #6B6884 | #A3A0BC |
| brand (primary) | #5B3FD9 | #8C76F0 |
| money / paid | #0E8F7E | #3CC7B2 |
| due soon | #C98A0B | #F0B43C |
| overdue / lost | #C93A57 | #F07089 |

- Sidebar: deep indigo `#1F1B3D` in both themes, with violet for the active item.
- Type: Bricolage Grotesque (600/700) for headings and big figures; Figtree (400/500/600) for body text. Figures use `tabular-nums`. Montserrat stays for the logo only.
- Radii: 14px for page panels, 10px for inputs and buttons, full for pills. Only panels get shadows, and they're soft and tinted indigo.

### Theme
- A light/dark/system toggle sits in the top bar and the sidebar footer. It's stored in localStorage as `ams.theme` and applied as the `.dark` class on `<html>` before first paint (inline script), so the page never flashes the wrong theme.
- Default: system.

### Sidebar
- From md width up, a « / » button switches between a 256px sidebar and a 72px icon rail. In rail mode, names show as tooltips. The choice is stored as `ams.sidebar`.
- Mobile keeps the slide-out menu.

### Dashboard
1. Greeting and month.
2. **Pipeline ribbon:** one horizontal bar split by stage counts with labels, plus the total quoted value. Clicking a stage goes to /leads at that stage. This is the single bold element.
3. **Today:** follow-ups due or overdue, renewals due this week, overdue commissions, and payouts to approve (owners and managers). Each item links to the relevant page.
4. **This month:** premiums written; commission received against expected, as one bar; active policies.
5. Upcoming renewals and recent policies, as compact lists.

Agents see their own figures, as today.

### Out of scope
- Restyling every page beyond what the shared tokens, fonts and sidebar change.
- Lead import.
- Reminders sent by SMS or email.
