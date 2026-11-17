// Jira REST helpers. The transport is injected so the logic stays testable:
//   createJiraClient(requestJira) where requestJira(path) returns a Response-like
//   object ({ status, ok, json() }). Production wiring lives in index.js
//   (api.asUser().requestJira(route`...`)).

export function createJiraClient(requestJira) {
  async function getIssue(key) {
    const res = await requestJira(
      `/rest/api/3/issue/${key}?fields=summary,status,priority,assignee,reporter,created,updated,issuetype,labels,issuelinks`,
    );
    if (res.status === 404) return { error: `${key} does not exist or you cannot see it.` };
    if (!res.ok) return { error: `Could not read ${key} (HTTP ${res.status}).` };
    const issue = await res.json();
    return { issue };
  }

  async function getIssueComments(key, maxResults = 20) {
    const res = await requestJira(`/rest/api/3/issue/${key}/comment?maxResults=${maxResults}&orderBy=-created`);
    if (!res.ok) return { error: `Could not read comments for ${key} (HTTP ${res.status}).`, comments: [] };
    const body = await res.json();
    return { comments: (body.comments || []).map((c) => ({ created: c.created, author: c.author?.displayName || 'unknown' })) };
  }

  async function searchUser(text) {
    const res = await requestJira(`/rest/api/3/user/search?query=${encodeURIComponent(text)}&maxResults=5`);
    if (!res.ok) return { error: `User search failed (HTTP ${res.status}).` };
    const users = (await res.json()).filter((u) => u.accountType === 'atlassian' && u.active);
    if (users.length === 0) return { error: `No active person matches "${text}".` };
    if (users.length > 1) {
      return { error: `"${text}" matches ${users.length} people: ${users.map((u) => u.displayName).join(', ')}. Ask which one.` };
    }
    return { accountId: users[0].accountId, displayName: users[0].displayName };
  }

  async function getUser(accountId) {
    const res = await requestJira(`/rest/api/3/user?accountId=${encodeURIComponent(accountId)}`);
    if (!res.ok) return { displayName: accountId };
    return await res.json();
  }

  // Count open items assigned to one person (JQL, capped at 100).
  async function countOpenAssigned(accountId) {
    const jql = `assignee = ${accountId} AND statusCategory != Done`;
    const res = await requestJira(`/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=100&fields=key`);
    if (!res.ok) return { error: `Could not count open work (HTTP ${res.status}).`, total: 0 };
    const body = await res.json();
    return { total: body.total ?? (body.issues || []).length };
  }

  async function updateIssue(key, fields) {
    const res = await requestJira(`/rest/api/3/issue/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    if (res.status === 204 || res.ok) return { ok: true };
    return { error: `Could not update ${key} (HTTP ${res.status}).` };
  }

  return { getIssue, getIssueComments, searchUser, getUser, countOpenAssigned, updateIssue };
}

// Open blockers of an issue, from its issuelinks.
// A "Blocks" link with an inwardIssue means THIS issue is blocked by that issue.
export function openBlockersOf(issue) {
  const links = issue?.fields?.issuelinks || [];
  return links.filter((l) => {
    if ((l.type?.name || '').toLowerCase() !== 'blocks') return false;
    const blocker = l.inwardIssue;
    if (!blocker) return false; // outwardIssue = this issue blocks someone else, not a blocker of it
    const status = blocker.fields?.status?.name || '';
    return !/^(done|closed|resolved|cancelled)$/i.test(status);
  }).length;
}
