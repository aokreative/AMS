import { addDays, addYears, format, parseISO } from 'date-fns';
import i18n from '@/i18n';
import type { LostReason, RenewalChannel, RenewalStage, UserRole } from './types';

export const RENEWAL_STAGES: RenewalStage[] = ['to_contact', 'contacted', 'quoted', 'renewed', 'lost'];
export const OPEN_STAGES: RenewalStage[] = ['to_contact', 'contacted', 'quoted'];
export const RENEWAL_CHANNELS: RenewalChannel[] = ['phone', 'whatsapp', 'sms', 'email', 'in_person'];
export const LOST_REASONS: LostReason[] = ['price', 'competitor', 'no_longer_needed', 'no_response', 'other'];

// Labels come from the 'policies' translation section in the interface language.
export const stageLabel = (s: RenewalStage): string => i18n.t(`policies.stage.${s}`, { defaultValue: s });
export const channelLabel = (c: RenewalChannel): string => i18n.t(`policies.channel.${c}`, { defaultValue: c });
export const lostReasonLabel = (r: LostReason): string => i18n.t(`policies.lostReason.${r}`, { defaultValue: r });

/** New term: starts the day after the old expiry, ends one year later less a day. */
export function defaultRenewalDates(oldExpiry: string): { start: string; expiry: string } {
  const start = addDays(parseISO(oldExpiry), 1);
  // A year after 29 Feb is 1 Mar (date-fns would clamp to 28 Feb), so the term ends 28 Feb.
  const isLeapDay = start.getMonth() === 1 && start.getDate() === 29;
  const nextYear = isLeapDay ? new Date(start.getFullYear() + 1, 2, 1) : addYears(start, 1);
  const expiry = addDays(nextYear, -1);
  return { start: format(start, 'yyyy-MM-dd'), expiry: format(expiry, 'yyyy-MM-dd') };
}

/** Renewed ÷ (renewed + lost) as a percentage with one decimal; null when nothing closed. */
export function renewalRate(renewed: number, lost: number): number | null {
  const total = renewed + lost;
  if (total === 0) return null;
  return Math.round((renewed * 1000) / total) / 10;
}

/** Mirrors the database rule: Owner/Manager always; Agent on own policies while the agency allows it. */
export function canUpdateRenewals(
  role: UserRole | undefined | null,
  agentsManage: boolean,
  isOwnPolicy: boolean,
): boolean {
  if (role === 'owner' || role === 'manager') return true;
  if (role === 'agent') return agentsManage && isOwnPolicy;
  return false;
}
