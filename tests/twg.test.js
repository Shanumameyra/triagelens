import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTwgClient, Q, userAri, workItemAri, PAGE_SIZE } from '../src/twg.js';

const okRes = (data) => ({ status: 200, json: async () => ({ data }) });
const errRes = (message) => ({ status: 200, json: async () => ({ errors: [{ message }] }) });

describe('ARI helpers', () => {
  it('builds user and work-item ARIs', () => {
    assert.equal(userAri('abc'), 'ari:cloud:identity::user/abc');
    assert.equal(workItemAri('cloud-1', '10001'), 'ari:cloud:jira:cloud-1:issue/10001');
  });
  it('page size is 25 (API cap)', () => {
    assert.equal(PAGE_SIZE, 25);
  });
});

describe('twg()', () => {
  it('renames the operation to triagelens_<op> and returns data', async () => {
    let seen;
    const client = createTwgClient(async (text) => {
      seen = text;
      return okRes({ atlassianUserInTeams: { edges: [], pageInfo: { hasNextPage: false } } });
    });
    const r = await client.twg('userTeams', Q.userTeams, { userId: 'x' });
    assert.equal(r.ok, true);
    assert.match(seen, /query triagelens_userTeams/);
  });
  it('treats HTTP 200 with errors as failure (DataFetchingException gotcha)', async () => {
    const client = createTwgClient(async () => errRes('DataFetchingException: bad operation name'));
    const r = await client.twg('userTeams', Q.userTeams, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /DataFetchingException/);
  });
  it('retries transient errors then succeeds', async () => {
    let calls = 0;
    const client = createTwgClient(async () => {
      calls += 1;
      if (calls < 3) return errRes('RATE_LIMIT_EXCEEDED: slow down');
      return okRes({ ok: true });
    });
    const r = await client.twg('userTeams', Q.userTeams, {});
    assert.equal(r.ok, true);
    assert.equal(calls, 3);
  });
  it('gives up after retries on persistent transient errors', async () => {
    let calls = 0;
    const client = createTwgClient(async () => {
      calls += 1;
      return { status: 503, json: async () => ({}) };
    });
    const r = await client.twg('userTeams', Q.userTeams, {});
    assert.equal(r.ok, false);
    assert.equal(calls, 4); // first try + 3 retries
  });
  it('never throws when the transport throws', async () => {
    const client = createTwgClient(async () => {
      throw new Error('network down');
    });
    const r = await client.twg('userTeams', Q.userTeams, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /network down/);
  });
});

describe('twgAll()', () => {
  it('pages through connections until hasNextPage is false', async () => {
    const pages = [
      { edges: [{ node: { key: 'A-1' } }, { node: { key: 'A-2' } }], pageInfo: { hasNextPage: true, endCursor: 'c1' } },
      { edges: [{ node: { key: 'A-3' } }], pageInfo: { hasNextPage: false, endCursor: null } },
    ];
    let calls = 0;
    const client = createTwgClient(async (text, variables) => {
      const page = pages[calls];
      calls += 1;
      assert.equal(variables.first, 25);
      if (calls === 2) assert.equal(variables.after, 'c1');
      return okRes({ atlassianUserAssignedJiraWorkItems: page });
    });
    const r = await client.twgAll('assignedWork', Q.assignedWork, { userId: 'u' }, 'atlassianUserAssignedJiraWorkItems');
    assert.equal(r.ok, true);
    assert.equal(r.complete, true);
    assert.deepEqual(r.nodes.map((n) => n.key), ['A-1', 'A-2', 'A-3']);
  });
  it('reports incomplete when a page fails after some nodes', async () => {
    let calls = 0;
    const client = createTwgClient(async () => {
      calls += 1;
      if (calls === 1) {
        return okRes({ atlassianUserAssignedJiraWorkItems: { edges: [{ node: { key: 'A-1' } }], pageInfo: { hasNextPage: true, endCursor: 'c1' } } });
      }
      return errRes('THROTTLED');
    });
    const r = await client.twgAll('assignedWork', Q.assignedWork, { userId: 'u' }, 'atlassianUserAssignedJiraWorkItems');
    assert.equal(r.ok, true); // partial data is still usable
    assert.equal(r.complete, false);
    assert.equal(r.nodes.length, 1);
  });
  it('stops after maxPages', async () => {
    const client = createTwgClient(async () => okRes({
      atlassianUserAssignedJiraWorkItems: { edges: [{ node: { key: 'A-1' } }], pageInfo: { hasNextPage: true, endCursor: 'c1' } },
    }));
    const r = await client.twgAll('assignedWork', Q.assignedWork, { userId: 'u' }, 'atlassianUserAssignedJiraWorkItems', 2);
    assert.equal(r.complete, false);
    assert.equal(r.error, 'stopped-after-max-pages');
    assert.equal(r.nodes.length, 2);
  });
});
