// TriageLens triage engine — pure, deterministic, no external calls.
// Scores a Jira issue 0-100 so a team can see what matters first.
// Every point is explainable: the breakdown lists each contributing factor.
//
// Inputs (all optional except where noted):
//   {
//     priority: 'Highest'|'High'|'Medium'|'Low'|'Lowest'|null,
//     status: string (e.g. 'To Do', 'In Progress', 'Done'),
//     created: ISO date string, updated: ISO date string,
//     comments: [{ created: ISO date string }],   // recent comments only
//     openBlockers: number,                       // open issues blocking this one
//     linkedGoals: number,                        // goals linked via Teamwork Graph
//     assignee: { accountId, displayName } | null,
//     assigneeOpenItems: number,                  // assignee's other open items
//     now: ISO date string (defaults to new Date(); injectable for tests)
//   }
//
// Output:
//   { score, band, breakdown: [{label, points, max}], reasons: [string],
//     suggestedPriority, suggestedLabels: [string] }

export const BANDS = [
  { min: 75, name: 'Critical' },
  { min: 55, name: 'High' },
  { min: 35, name: 'Medium' },
  { min: 0, name: 'Low' },
];

const PRIORITY_POINTS = { Highest: 30, High: 24, Medium: 15, Low: 8, Lowest: 3 };
const DONE_STATUS = /^(done|closed|resolved|cancelled)$/i;

const daysBetween = (fromIso, toDate) => {
  const from = Date.parse(fromIso);
  if (Number.isNaN(from)) return 0;
  return Math.max(0, (toDate.getTime() - from) / 86400000);
};

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export function bandFor(score) {
  for (const b of BANDS) if (score >= b.min) return b.name;
  return 'Low';
}

export function scoreIssue(input = {}) {
  const now = input.now ? new Date(input.now) : new Date();
  const breakdown = [];
  const reasons = [];

  // 1. Priority as set on the issue (max 30)
  const priority = input.priority || null;
  const priorityPts = priority ? (PRIORITY_POINTS[priority] ?? 12) : 12;
  breakdown.push({ label: `Priority: ${priority || 'unset'}`, points: priorityPts, max: 30 });
  if (priority === 'Highest' || priority === 'High') {
    reasons.push(`Marked ${priority} priority.`);
  }

  // 2. Staleness — days since last update (max 15, full at 14 days)
  const staleDays = daysBetween(input.updated, now);
  const stalePts = Math.round(clamp((staleDays / 14) * 15, 0, 15));
  breakdown.push({ label: `No update for ${Math.floor(staleDays)} day(s)`, points: stalePts, max: 15 });
  if (staleDays >= 7) reasons.push(`No update for ${Math.floor(staleDays)} days.`);

  // 3. Age — days since created (max 10, full at 30 days)
  const ageDays = daysBetween(input.created, now);
  const agePts = Math.round(clamp((ageDays / 30) * 10, 0, 10));
  breakdown.push({ label: `Open for ${Math.floor(ageDays)} day(s)`, points: agePts, max: 10 });
  if (ageDays >= 30) reasons.push(`Open for ${Math.floor(ageDays)} days.`);

  // 4. Recent discussion — comments in the last 7 days (max 10)
  const comments = Array.isArray(input.comments) ? input.comments : [];
  const recent = comments.filter((c) => daysBetween(c.created, now) <= 7).length;
  const commentPts = recent === 0 ? 0 : recent === 1 ? 4 : recent === 2 ? 7 : 10;
  breakdown.push({ label: `${recent} comment(s) in the last 7 days`, points: commentPts, max: 10 });
  if (recent >= 3) reasons.push(`${recent} comments in the last 7 days — people are waiting on this.`);

  // 5. Blocked by open blockers (max 15)
  const blockers = Math.max(0, input.openBlockers || 0);
  const blockerPts = Math.min(15, blockers * 7);
  breakdown.push({ label: `${blockers} open blocker(s)`, points: blockerPts, max: 15 });
  if (blockers > 0) reasons.push(`Blocked by ${blockers} open issue(s).`);

  // 6. Linked to a goal — the work has visible purpose (max 5)
  const goals = Math.max(0, input.linkedGoals || 0);
  const goalPts = goals > 0 ? 5 : 0;
  breakdown.push({ label: goals > 0 ? `Linked to ${goals} goal(s)` : 'No goal linked', points: goalPts, max: 5 });

  // 7. Unassigned work drifts (max 10)
  const hasAssignee = Boolean(input.assignee && input.assignee.accountId);
  const unassignedPts = hasAssignee ? 0 : 10;
  breakdown.push({ label: hasAssignee ? `Assigned to ${input.assignee.displayName || 'someone'}` : 'Unassigned', points: unassignedPts, max: 10 });
  if (!hasAssignee) reasons.push('Nobody is assigned yet.');

  // 8. Assignee overload penalty (max -10)
  const load = Math.max(0, input.assigneeOpenItems || 0);
  const overloadPts = hasAssignee && load > 8 ? -10 : 0;
  breakdown.push({ label: hasAssignee ? `Assignee has ${load} open item(s)` : 'Assignee load: n/a', points: overloadPts, max: 0 });
  if (overloadPts < 0) reasons.push(`Assignee already has ${load} open items — consider reassigning.`);

  const raw = breakdown.reduce((sum, b) => sum + b.points, 0);
  const score = clamp(raw, 0, 100);
  const band = bandFor(score);

  if (DONE_STATUS.test(String(input.status || ''))) {
    // Done work is never urgent, whatever its history says.
    return {
      score: 0,
      band: 'Low',
      breakdown: breakdown.map((b) => ({ ...b, points: 0 })),
      reasons: [`Status is ${input.status} — nothing to triage.`],
      suggestedPriority: 'Low',
      suggestedLabels: [],
    };
  }

  const suggestedPriority = band === 'Critical' ? 'Highest' : band === 'High' ? 'High' : band === 'Medium' ? 'Medium' : 'Low';
  const suggestedLabels = [`triagelens:${band.toLowerCase()}`];
  if (!hasAssignee) suggestedLabels.push('triagelens:unassigned');
  if (blockers > 0) suggestedLabels.push('triagelens:blocked');

  return { score, band, breakdown, reasons, suggestedPriority, suggestedLabels };
}

// Pick the teammate with the lightest open load (excluding `excludeAccountId`).
// teammates: [{ accountId, displayName, openItems }]
export function suggestAssignee(teammates = [], excludeAccountId = null) {
  const candidates = teammates
    .filter((t) => t && t.accountId && t.accountId !== excludeAccountId)
    .sort((a, b) => (a.openItems || 0) - (b.openItems || 0));
  if (candidates.length === 0) return null;
  const best = candidates[0];
  return { accountId: best.accountId, displayName: best.displayName, openItems: best.openItems || 0 };
}
