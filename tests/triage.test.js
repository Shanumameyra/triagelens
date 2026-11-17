import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scoreIssue, bandFor, suggestAssignee } from '../src/triage.js';

const NOW = '2026-11-17T00:00:00.000Z';
const base = {
  priority: 'Medium',
  status: 'To Do',
  created: '2026-11-10T00:00:00.000Z',
  updated: '2026-11-16T00:00:00.000Z',
  comments: [],
  openBlockers: 0,
  linkedGoals: 0,
  assignee: { accountId: 'u1', displayName: 'Ana' },
  assigneeOpenItems: 2,
  now: NOW,
};

describe('bandFor', () => {
  it('maps thresholds', () => {
    assert.equal(bandFor(100), 'Critical');
    assert.equal(bandFor(75), 'Critical');
    assert.equal(bandFor(74), 'High');
    assert.equal(bandFor(55), 'High');
    assert.equal(bandFor(54), 'Medium');
    assert.equal(bandFor(35), 'Medium');
    assert.equal(bandFor(34), 'Low');
    assert.equal(bandFor(0), 'Low');
  });
});

describe('scoreIssue — priority', () => {
  it('Highest priority scores 30', () => {
    const r = scoreIssue({ ...base, priority: 'Highest' });
    assert.equal(r.breakdown.find((b) => b.label.startsWith('Priority')).points, 30);
  });
  it('Lowest priority scores 3', () => {
    const r = scoreIssue({ ...base, priority: 'Lowest' });
    assert.equal(r.breakdown.find((b) => b.label.startsWith('Priority')).points, 3);
  });
  it('unset priority scores 12', () => {
    const r = scoreIssue({ ...base, priority: null });
    assert.equal(r.breakdown.find((b) => b.label.startsWith('Priority')).points, 12);
  });
});

describe('scoreIssue — time signals', () => {
  it('stale 14+ days scores full 15', () => {
    const r = scoreIssue({ ...base, updated: '2026-11-01T00:00:00.000Z' });
    assert.equal(r.breakdown.find((b) => b.label.startsWith('No update')).points, 15);
    assert.match(r.reasons.join(' '), /No update for 16 days/);
  });
  it('fresh update scores 0 staleness', () => {
    const r = scoreIssue({ ...base, updated: '2026-11-17T00:00:00.000Z' });
    assert.equal(r.breakdown.find((b) => b.label.startsWith('No update')).points, 0);
  });
  it('age 30+ days scores full 10', () => {
    const r = scoreIssue({ ...base, created: '2026-10-01T00:00:00.000Z' });
    assert.equal(r.breakdown.find((b) => b.label.startsWith('Open for')).points, 10);
  });
  it('invalid dates do not crash and score 0', () => {
    const r = scoreIssue({ ...base, created: 'not-a-date', updated: 'also-bad' });
    assert.equal(r.breakdown.find((b) => b.label.startsWith('No update')).points, 0);
    assert.equal(r.breakdown.find((b) => b.label.startsWith('Open for')).points, 0);
  });
});

describe('scoreIssue — activity and blockers', () => {
  it('3+ recent comments score 10', () => {
    const comments = [15, 16, 16].map((d) => ({ created: `2026-11-${d}T00:00:00.000Z` }));
    const r = scoreIssue({ ...base, comments });
    assert.equal(r.breakdown.find((b) => b.label.includes('comment')).points, 10);
    assert.match(r.reasons.join(' '), /waiting on this/);
  });
  it('old comments do not count as recent', () => {
    const r = scoreIssue({ ...base, comments: [{ created: '2026-10-01T00:00:00.000Z' }] });
    assert.equal(r.breakdown.find((b) => b.label.includes('comment')).points, 0);
  });
  it('one open blocker adds 7, three add 15 (capped)', () => {
    assert.equal(scoreIssue({ ...base, openBlockers: 1 }).breakdown.find((b) => b.label.includes('blocker')).points, 7);
    assert.equal(scoreIssue({ ...base, openBlockers: 3 }).breakdown.find((b) => b.label.includes('blocker')).points, 15);
  });
  it('linked goal adds 5', () => {
    const r = scoreIssue({ ...base, linkedGoals: 2 });
    assert.equal(r.breakdown.find((b) => b.label.includes('goal')).points, 5);
  });
});

describe('scoreIssue — assignment', () => {
  it('unassigned adds 10 and suggests labels', () => {
    const r = scoreIssue({ ...base, assignee: null });
    assert.equal(r.breakdown.find((b) => b.label === 'Unassigned').points, 10);
    assert.ok(r.suggestedLabels.includes('triagelens:unassigned'));
    assert.match(r.reasons.join(' '), /Nobody is assigned/);
  });
  it('overloaded assignee (>8 open) subtracts 10', () => {
    const r = scoreIssue({ ...base, assigneeOpenItems: 12 });
    assert.equal(r.breakdown.find((b) => b.label.includes('Assignee has')).points, -10);
    assert.match(r.reasons.join(' '), /consider reassigning/);
  });
  it('8 open items is not overload', () => {
    const r = scoreIssue({ ...base, assigneeOpenItems: 8 });
    assert.equal(r.breakdown.find((b) => b.label.includes('Assignee has')).points, 0);
  });
});

describe('scoreIssue — bands and suggestions', () => {
  it('max-signal issue is Critical with Highest priority', () => {
    // Theoretical max is 95 (30+15+10+10+15+5+10); overload penalty never applies
    // when unassigned, so 100 is unreachable by design — the cap is a guard, not a target.
    const r = scoreIssue({
      ...base,
      priority: 'Highest',
      created: '2026-09-01T00:00:00.000Z',
      updated: '2026-10-01T00:00:00.000Z',
      comments: [15, 16, 16].map((d) => ({ created: `2026-11-${d}T00:00:00.000Z` })),
      openBlockers: 3,
      linkedGoals: 1,
      assignee: null,
    });
    assert.equal(r.score, 95);
    assert.equal(r.band, 'Critical');
    assert.equal(r.suggestedPriority, 'Highest');
    assert.ok(r.suggestedLabels.includes('triagelens:critical'));
    assert.ok(r.suggestedLabels.includes('triagelens:blocked'));
  });
  it('quiet low-priority issue is Low', () => {
    const r = scoreIssue({
      ...base,
      priority: 'Lowest',
      created: '2026-11-16T00:00:00.000Z',
      updated: '2026-11-17T00:00:00.000Z',
      assigneeOpenItems: 1,
    });
    assert.equal(r.band, 'Low');
    assert.equal(r.suggestedPriority, 'Low');
  });
  it('done issue always scores 0', () => {
    const r = scoreIssue({ ...base, priority: 'Highest', status: 'Done', openBlockers: 3 });
    assert.equal(r.score, 0);
    assert.equal(r.band, 'Low');
    assert.match(r.reasons.join(' '), /Status is Done/);
  });
  it('score never exceeds 100 or drops below 0', () => {
    const r = scoreIssue({ ...base, priority: 'Highest', openBlockers: 9, linkedGoals: 5, assigneeOpenItems: 50 });
    assert.ok(r.score >= 0 && r.score <= 100);
  });
  it('breakdown sums to the score', () => {
    const r = scoreIssue({ ...base, priority: 'High', openBlockers: 1, linkedGoals: 1 });
    const sum = r.breakdown.reduce((s, b) => s + b.points, 0);
    assert.equal(sum, r.score);
  });
});

describe('suggestAssignee', () => {
  it('picks the lightest load and excludes the current assignee', () => {
    const team = [
      { accountId: 'u1', displayName: 'Ana', openItems: 9 },
      { accountId: 'u2', displayName: 'Budi', openItems: 3 },
      { accountId: 'u3', displayName: 'Citra', openItems: 5 },
    ];
    assert.deepEqual(suggestAssignee(team, 'u1'), { accountId: 'u2', displayName: 'Budi', openItems: 3 });
  });
  it('returns null when nobody is available', () => {
    assert.equal(suggestAssignee([], null), null);
    assert.equal(suggestAssignee([{ accountId: 'u1', displayName: 'Ana', openItems: 1 }], 'u1'), null);
  });
});
