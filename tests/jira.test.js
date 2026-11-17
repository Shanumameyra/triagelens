import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createJiraClient, openBlockersOf } from '../src/jira.js';

const okRes = (body, status = 200) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

describe('openBlockersOf', () => {
  const issueWith = (links) => ({ fields: { issuelinks: links } });
  const link = (status, inward = true) => ({
    type: { name: 'Blocks' },
    ...(inward ? { inwardIssue: { fields: { status: { name: status } } } } : { outwardIssue: { fields: { status: { name: status } } } }),
  });
  it('counts an open inward Blocks link', () => {
    assert.equal(openBlockersOf(issueWith([link('To Do')])), 1);
  });
  it('ignores a done blocker', () => {
    assert.equal(openBlockersOf(issueWith([link('Done')])), 0);
  });
  it('ignores outward links (this issue blocks someone else)', () => {
    assert.equal(openBlockersOf(issueWith([link('To Do', false)])), 0);
  });
  it('ignores non-Blocks link types', () => {
    const l = { type: { name: 'Relates' }, inwardIssue: { fields: { status: { name: 'To Do' } } } };
    assert.equal(openBlockersOf(issueWith([l])), 0);
  });
  it('handles missing fields without crashing', () => {
    assert.equal(openBlockersOf({}), 0);
    assert.equal(openBlockersOf({ fields: {} }), 0);
    assert.equal(openBlockersOf({ fields: { issuelinks: null } }), 0);
  });
});

describe('createJiraClient', () => {
  it('getIssue returns the issue on success', async () => {
    const client = createJiraClient(async (path) => {
      assert.match(path, /\/rest\/api\/3\/issue\/PROJ-1\?fields=/);
      return okRes({ key: 'PROJ-1', fields: { summary: 'Fix login' } });
    });
    const { issue, error } = await client.getIssue('PROJ-1');
    assert.equal(error, undefined);
    assert.equal(issue.key, 'PROJ-1');
  });
  it('getIssue reports a friendly error on 404', async () => {
    const client = createJiraClient(async () => ({ status: 404, ok: false, json: async () => ({}) }));
    const { error } = await client.getIssue('NOPE-1');
    assert.match(error, /does not exist or you cannot see it/);
  });
  it('searchUser rejects ambiguous names', async () => {
    const client = createJiraClient(async () => okRes([
      { accountId: 'a', displayName: 'Ana', accountType: 'atlassian', active: true },
      { accountId: 'b', displayName: 'Anas', accountType: 'atlassian', active: true },
    ]));
    const { error } = await client.searchUser('Ana');
    assert.match(error, /matches 2 people/);
  });
  it('searchUser ignores inactive and non-atlassian accounts', async () => {
    const client = createJiraClient(async () => okRes([
      { accountId: 'a', displayName: 'Bot', accountType: 'app', active: true },
      { accountId: 'b', displayName: 'Ana', accountType: 'atlassian', active: false },
      { accountId: 'c', displayName: 'Ana', accountType: 'atlassian', active: true },
    ]));
    const res = await client.searchUser('Ana');
    assert.equal(res.accountId, 'c');
  });
  it('countOpenAssigned reads total from JQL search', async () => {
    const client = createJiraClient(async (path) => {
      assert.match(path, /search\/jql\?jql=/);
      return okRes({ total: 7, issues: [] });
    });
    const { total } = await client.countOpenAssigned('u1');
    assert.equal(total, 7);
  });
  it('getIssueComments maps authors', async () => {
    const client = createJiraClient(async () => okRes({
      comments: [
        { created: '2026-11-16T00:00:00.000Z', author: { displayName: 'Ana' } },
        { created: '2026-11-15T00:00:00.000Z', author: null },
      ],
    }));
    const { comments } = await client.getIssueComments('PROJ-1');
    assert.equal(comments.length, 2);
    assert.equal(comments[0].author, 'Ana');
    assert.equal(comments[1].author, 'unknown');
  });
});
