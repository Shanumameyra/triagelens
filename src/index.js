// TriageLens — Forge backend: Jira issue panel resolver, Rovo agent actions, MCP tool.
// Production wiring only. All testable logic lives in triage.js / twg.js / jira.js.
import api, { route } from '@forge/api';
import Resolver from '@forge/resolver';
import { createTwgClient, Q, userAri, workItemAri } from './twg.js';
import { createJiraClient, openBlockersOf } from './jira.js';
import { scoreIssue, suggestAssignee } from './triage.js';

const log = (event, data) => console.log(JSON.stringify({ triagelens: event, ...data }));

// ---- transports (as the user, so results respect their own permissions) ----
const jiraRequest = (path, options) => api.asUser().requestJira(route`${path}`, options);
const twgRequest = (text, variables, operationName) =>
  api.asUser().requestTeamworkGraph(text, variables, operationName);

// ---- shared triage brief: issue + comments + goals + assignee load -> score ----
export async function buildTriageBrief({ issueKey, cloudId }) {
  const t0 = Date.now();
  const notes = [];
  const jira = createJiraClient(jiraRequest);
  const twg = createTwgClient(twgRequest);

  const key = String(issueKey || '').trim().toUpperCase();
  if (!key) return { error: 'Which work item? Give me a key such as PROJ-123.' };

  const { issue, error } = await jira.getIssue(key);
  if (error) return { error };

  const fields = issue.fields || {};
  const assignee = fields.assignee ? { accountId: fields.assignee.accountId, displayName: fields.assignee.displayName } : null;

  const [commentsRes, goalsRes, loadRes] = await Promise.all([
    jira.getIssueComments(key, 20),
    (async () => {
      if (!cloudId) return { nodes: [], ok: false, error: 'no-cloud-id' };
      const ari = workItemAri(cloudId, issue.id);
      return twg.twgAll('workItemGoals', Q.workItemGoals, { id: ari }, 'jiraWorkItemGoals');
    })(),
    (async () => {
      if (!assignee) return { total: 0 };
      return jira.countOpenAssigned(assignee.accountId);
    })(),
  ]);
  if (commentsRes.error) notes.push(`Comments could not be read: ${commentsRes.error}`);
  if (goalsRes.error) notes.push(`Goals could not be read: ${goalsRes.error}`);
  if (loadRes.error) notes.push(`Assignee workload could not be read: ${loadRes.error}`);

  const triage = scoreIssue({
    priority: fields.priority?.name || null,
    status: fields.status?.name || null,
    created: fields.created,
    updated: fields.updated,
    comments: commentsRes.comments || [],
    openBlockers: openBlockersOf(issue),
    linkedGoals: (goalsRes.nodes || []).length,
    assignee,
    assigneeOpenItems: loadRes.total || 0,
  });

  log('triage-brief', { key, ms: Date.now() - t0, score: triage.score, band: triage.band, notes: notes.length });
  return {
    key,
    summary: fields.summary || '',
    status: fields.status?.name || null,
    issueType: fields.issuetype?.name || null,
    assignee: assignee?.displayName || null,
    assigneeAccountId: assignee?.accountId || null,
    reporter: fields.reporter?.displayName || null,
    triage,
    goals: (goalsRes.nodes || []).map((g) => ({ name: g.name, url: g.url })),
    notes,
  };
}

// ---- Rovo agent action 1: full triage brief for one issue ----
export async function triageBrief(payload) {
  const key = String(payload?.issueKey || payload?.context?.jira?.issueKey || '').trim();
  return buildTriageBrief({ issueKey: key, cloudId: payload?.context?.cloudId });
}

// ---- Rovo agent action 2: who is involved in one issue ----
export async function issuePeople(payload) {
  const t0 = Date.now();
  const notes = [];
  const jira = createJiraClient(jiraRequest);
  const twg = createTwgClient(twgRequest);
  const key = String(payload?.issueKey || payload?.context?.jira?.issueKey || '').trim().toUpperCase();
  if (!key) return { error: 'Which work item? Give me a key such as PROJ-123.' };

  const { issue, error } = await jira.getIssue(key);
  if (error) return { error };
  const fields = issue.fields || {};
  const cloudId = payload?.context?.cloudId;

  const [commentsRes, goalsRes] = await Promise.all([
    (async () => {
      if (!cloudId) return { nodes: [], ok: false, error: 'no-cloud-id' };
      const ari = workItemAri(cloudId, issue.id);
      return twg.twgAll('workItemComments', Q.workItemComments, { id: ari, since: 'P90D' }, 'jiraWorkItemComments');
    })(),
    (async () => {
      if (!cloudId) return { nodes: [], ok: false, error: 'no-cloud-id' };
      const ari = workItemAri(cloudId, issue.id);
      return twg.twgAll('workItemGoals', Q.workItemGoals, { id: ari }, 'jiraWorkItemGoals');
    })(),
  ]);
  if (!commentsRes.ok) notes.push(`Comments could not be read: ${commentsRes.error}`);
  if (!goalsRes.ok) notes.push(`Goals could not be read: ${goalsRes.error}`);

  const byAuthor = new Map();
  for (const c of commentsRes.nodes || []) {
    const name = c.author?.name || 'unknown';
    const row = byAuthor.get(name) || { name, comments: 0, lastAt: null };
    row.comments += 1;
    if (!row.lastAt || c.createdAt > row.lastAt) row.lastAt = c.createdAt;
    byAuthor.set(name, row);
  }

  log('issue-people', { key, ms: Date.now() - t0, commenters: byAuthor.size, notes: notes.length });
  return {
    key,
    summary: fields.summary || '',
    status: fields.status?.name || null,
    assignee: fields.assignee?.displayName || null,
    reporter: fields.reporter?.displayName || null,
    commenters: [...byAuthor.values()].sort((a, b) => b.comments - a.comments),
    goals: (goalsRes.nodes || []).map((g) => ({ name: g.name, url: g.url })),
    notes,
  };
}

// ---- Rovo agent action 3: team workload — who has room for more work ----
export async function teamLoad(payload) {
  const t0 = Date.now();
  const notes = [];
  const jira = createJiraClient(jiraRequest);
  const twg = createTwgClient(twgRequest);
  const askerId = payload?.context?.accountId || null;

  const teamsRes = askerId
    ? await twg.twgAll('userTeams', Q.userTeams, { userId: userAri(askerId) }, 'atlassianUserInTeams')
    : { ok: false, nodes: [], error: 'unknown-asker' };
  if (!teamsRes.ok) notes.push(`Teams could not be read: ${teamsRes.error}`);
  const team = (teamsRes.nodes || [])[0];
  if (!team) return { error: 'I could not find a team for you.', notes };

  const membersRes = await twg.twgAll('teamMembers', Q.teamMembers, { teamAri: team.id }, 'atlassianTeamMembers');
  if (!membersRes.ok) notes.push(`Team members could not be read: ${membersRes.error}`);
  const members = membersRes.nodes || [];

  const rows = [];
  for (const m of members) {
    const work = await twg.twgAll('assignedWork', Q.assignedWork, { userId: userAri(m.accountId) }, 'atlassianUserAssignedJiraWorkItems', 1);
    if (!work.ok) notes.push(`Work for ${m.name} could not be read: ${work.error}`);
    const items = (work.nodes || []).map((n) => ({ key: n.key, summary: n.summary, status: n.status?.name || null, webUrl: n.webUrl }));
    const open = items.filter((w) => w.status && !/^(done|closed|resolved)$/i.test(w.status));
    rows.push({ accountId: m.accountId, name: m.name, openItems: open.length, open });
  }
  rows.sort((a, b) => a.openItems - b.openItems);
  const lightest = rows[0] || null;

  log('team-load', { team: team.displayName, ms: Date.now() - t0, members: rows.length, notes: notes.length });
  return {
    team: team.displayName,
    members: rows,
    lightestLoad: lightest ? { name: lightest.name, openItems: lightest.openItems } : null,
    notes,
  };
}

// ---- MCP tool: same triage brief, callable by third-party agents ----
export async function getIssueTriage(payload) {
  const key = String(payload?.issueKey || payload?.context?.jira?.issueKey || '').trim();
  const brief = await buildTriageBrief({ issueKey: key, cloudId: payload?.context?.cloudId });
  if (brief.error) return brief.error;
  const t = brief.triage;
  return `${brief.key}: "${brief.summary}" — triage ${t.score}/100 (${t.band}). ` +
    `Suggested priority: ${t.suggestedPriority}. ` +
    `Reasons: ${t.reasons.join(' ') || 'No strong signals.'}` +
    (brief.notes.length ? ` Note: ${brief.notes.join(' ')}` : '');
}

// ---- Jira issue panel resolver ----
const panelResolver = new Resolver();
panelResolver.define('getTriage', async (req) => {
  const key = req.payload?.issueKey || req.context?.extension?.issue?.key;
  const brief = await buildTriageBrief({ issueKey: key, cloudId: req.context?.cloudId });
  if (brief.error) return { error: brief.error };
  // Suggest the least-loaded teammate as an assignment candidate.
  let suggestedAssignee = null;
  {
    const askerId = req.context?.accountId || null;
    const twg = createTwgClient(twgRequest);
    const teamsRes = askerId
      ? await twg.twgAll('userTeams', Q.userTeams, { userId: userAri(askerId) }, 'atlassianUserInTeams')
      : { ok: false, nodes: [] };
    const team = (teamsRes.nodes || [])[0];
    if (team) {
      const membersRes = await twg.twgAll('teamMembers', Q.teamMembers, { teamAri: team.id }, 'atlassianTeamMembers');
      const members = membersRes.nodes || [];
      const loads = [];
      for (const m of members) {
        const work = await twg.twgAll('assignedWork', Q.assignedWork, { userId: userAri(m.accountId) }, 'atlassianUserAssignedJiraWorkItems', 1);
        loads.push({ accountId: m.accountId, displayName: m.name, openItems: (work.nodes || []).length });
      }
      suggestedAssignee = suggestAssignee(loads, brief.assigneeAccountId);
    }
  }
  return { ...brief, suggestedAssignee };
});
panelResolver.define('applyPriority', async (req) => {
  const { issueKey, priority } = req.payload || {};
  if (!issueKey || !priority) return { error: 'issueKey and priority are required.' };
  const jira = createJiraClient(jiraRequest);
  return jira.updateIssue(issueKey, { priority: { name: priority } });
});
panelResolver.define('applyLabels', async (req) => {
  const { issueKey, labels } = req.payload || {};
  if (!issueKey || !Array.isArray(labels)) return { error: 'issueKey and labels are required.' };
  const jira = createJiraClient(jiraRequest);
  const { issue, error } = await jira.getIssue(issueKey);
  if (error) return { error };
  const existing = (issue.fields?.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
  const merged = [...new Set([...existing, ...labels])];
  return jira.updateIssue(issueKey, { labels: merged.map((name) => ({ name })) });
});

export const panelHandler = panelResolver.getDefinitions();
