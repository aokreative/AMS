import { describe, expect, it } from 'vitest';
import { LEAD_STAGES, OPEN_STAGES, followUpState, nextStages, pipelineSummary, quickFollowUps, stageLabel } from './leads';

describe('lead stages', () => {
  it('runs new → contacted → quoted → won → paid, with lost aside', () => {
    expect(LEAD_STAGES).toEqual(['new', 'contacted', 'quoted', 'won', 'paid']);
    expect(OPEN_STAGES).toEqual(['new', 'contacted', 'quoted', 'won']);
    expect(stageLabel('won')).toBe('Won');
    expect(stageLabel('lost')).toBe('Lost');
  });
  it('offers only forward moves from an open stage', () => {
    expect(nextStages('new')).toEqual(['contacted', 'quoted', 'won', 'paid']);
    expect(nextStages('quoted')).toEqual(['won', 'paid']);
    expect(nextStages('won')).toEqual(['paid']);
  });
  it('offers no moves from a closed stage', () => {
    expect(nextStages('paid')).toEqual([]);
    expect(nextStages('lost')).toEqual([]);
  });
});

describe('followUpState', () => {
  const today = '2026-11-24';
  it('overdue before today, due today, upcoming after', () => {
    expect(followUpState({ next_follow_up: '2026-11-20', stage: 'contacted' }, today)).toBe('overdue');
    expect(followUpState({ next_follow_up: today, stage: 'contacted' }, today)).toBe('due');
    expect(followUpState({ next_follow_up: '2026-11-30', stage: 'contacted' }, today)).toBe('upcoming');
  });
  it('none without a date or once the lead is closed', () => {
    expect(followUpState({ next_follow_up: null, stage: 'new' }, today)).toBe('none');
    expect(followUpState({ next_follow_up: '2026-11-20', stage: 'paid' }, today)).toBe('none');
    expect(followUpState({ next_follow_up: '2026-11-20', stage: 'lost' }, today)).toBe('none');
  });
});

describe('quickFollowUps', () => {
  it('today, tomorrow, in 3 days and next week from today', () => {
    expect(quickFollowUps('2026-11-24')).toEqual([
      { label: 'Today', date: '2026-11-24' },
      { label: 'Tomorrow', date: '2026-11-25' },
      { label: 'In 3 days', date: '2026-11-27' },
      { label: 'Next week', date: '2026-12-01' },
    ]);
  });
  it('rolls over month and year ends', () => {
    expect(quickFollowUps('2026-12-30').map((q) => q.date)).toEqual(['2026-12-30', '2026-12-31', '2027-01-02', '2027-01-06']);
  });
});

describe('pipelineSummary', () => {
  it('fills every stage, totals open quotes', () => {
    const s = pipelineSummary([
      { stage: 'new', count: 3, quoted_total: 0 },
      { stage: 'quoted', count: 2, quoted_total: 90000 },
      { stage: 'paid', count: 1, quoted_total: 42000 },
      { stage: 'lost', count: 4, quoted_total: 10000 },
    ]);
    expect(s.stages.map((x) => [x.stage, x.count])).toEqual([
      ['new', 3], ['contacted', 0], ['quoted', 2], ['won', 0], ['paid', 1],
    ]);
    expect(s.lost).toBe(4);
    expect(s.openQuoted).toBe(90000);
    expect(s.openCount).toBe(5);
  });
});
