export type LeadStage = 'new' | 'contacted' | 'quoted' | 'won' | 'paid' | 'lost';
export type OpenStage = 'new' | 'contacted' | 'quoted' | 'won';
export type LeadChannel = 'call' | 'whatsapp' | 'sms' | 'email' | 'visit';
export type LostReason = 'price' | 'went_elsewhere' | 'no_response' | 'not_eligible' | 'other';
export type LeadSource = 'referral' | 'walk_in' | 'phone' | 'whatsapp' | 'social' | 'website' | 'other';

/** The forward path, in order (lost sits to the side). */
export const LEAD_STAGES: Exclude<LeadStage, 'lost'>[] = ['new', 'contacted', 'quoted', 'won', 'paid'];
export const OPEN_STAGES: OpenStage[] = ['new', 'contacted', 'quoted', 'won'];

const LABELS: Record<LeadStage, string> = {
  new: 'New',
  contacted: 'Contacted',
  quoted: 'Quoted',
  won: 'Won',
  paid: 'Paid',
  lost: 'Lost',
};
export const stageLabel = (s: LeadStage) => LABELS[s];

export const CHANNELS: { value: LeadChannel; label: string }[] = [
  { value: 'call', label: 'Call' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'sms', label: 'SMS' },
  { value: 'email', label: 'Email' },
  { value: 'visit', label: 'Visit' },
];

export const LOST_REASONS: { value: LostReason; label: string }[] = [
  { value: 'price', label: 'Price' },
  { value: 'went_elsewhere', label: 'Went elsewhere' },
  { value: 'no_response', label: 'No response' },
  { value: 'not_eligible', label: 'Not eligible' },
  { value: 'other', label: 'Other' },
];

export const SOURCES: { value: LeadSource; label: string }[] = [
  { value: 'referral', label: 'Referral' },
  { value: 'walk_in', label: 'Walk-in' },
  { value: 'phone', label: 'Phone call' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'social', label: 'Social media' },
  { value: 'website', label: 'Website' },
  { value: 'other', label: 'Other' },
];

/** Stages a lead can move forward to (none once paid or lost). */
export function nextStages(stage: LeadStage): Exclude<LeadStage, 'new' | 'lost'>[] {
  const i = LEAD_STAGES.indexOf(stage as Exclude<LeadStage, 'lost'>);
  if (i < 0 || stage === 'paid') return [];
  return LEAD_STAGES.slice(i + 1) as Exclude<LeadStage, 'new' | 'lost'>[];
}

export type FollowUpState = 'overdue' | 'due' | 'upcoming' | 'none';

export function followUpState(lead: { next_follow_up: string | null; stage: LeadStage }, today: string): FollowUpState {
  if (!lead.next_follow_up || lead.stage === 'paid' || lead.stage === 'lost') return 'none';
  if (lead.next_follow_up < today) return 'overdue';
  if (lead.next_follow_up === today) return 'due';
  return 'upcoming';
}

export interface PipelineRow {
  stage: LeadStage;
  count: number;
  quoted_total: number | string;
}

/** Every forward stage with its count (0 when absent), plus lost and the value still being quoted. */
export function pipelineSummary(rows: PipelineRow[]) {
  const by = new Map(rows.map((r) => [r.stage, r]));
  const stages = LEAD_STAGES.map((stage) => ({
    stage,
    count: by.get(stage)?.count ?? 0,
    quoted: Number(by.get(stage)?.quoted_total ?? 0),
  }));
  const open = stages.filter((s) => (OPEN_STAGES as string[]).includes(s.stage));
  return {
    stages,
    lost: by.get('lost')?.count ?? 0,
    openCount: open.reduce((n, s) => n + s.count, 0),
    openQuoted: open.reduce((n, s) => n + s.quoted, 0),
  };
}

export interface Lead {
  id: string;
  agency_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  interest: string | null;
  product_line_id: string | null;
  insurer_id: string | null;
  source: LeadSource | null;
  stage: LeadStage;
  previous_stage: OpenStage | null;
  quoted_premium: number | null;
  next_follow_up: string | null;
  lost_reason: LostReason | null;
  assigned_agent_id: string;
  client_id: string | null;
  policy_id: string | null;
  notes: string | null;
  closed_at: string | null;
  last_activity_at: string | null;
  created_at: string;
  agent?: { id: string; full_name: string } | null;
  product_line?: { id: string; name: string } | null;
}

export interface LeadActivity {
  id: string;
  kind: 'contact' | 'stage' | 'lost' | 'reopened' | 'converted' | 'assigned';
  occurred_on: string;
  channel: LeadChannel | null;
  premium: number | null;
  next_follow_up: string | null;
  from_stage: LeadStage | null;
  to_stage: LeadStage | null;
  note: string | null;
  created_at: string;
  author?: { full_name: string } | null;
}
