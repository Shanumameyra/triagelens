import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { load as yamlLoad } from 'js-yaml';

const root = path.dirname(fileURLToPath(import.meta.url));
const manifest = yamlLoad(readFileSync(path.join(root, '..', 'manifest.yml'), 'utf8'));

describe('manifest.yml', () => {
  it('declares the Jira issue panel with UI Kit + resolver', () => {
    const panel = manifest.modules['jira:issuePanel'][0];
    assert.equal(panel.key, 'triagelens-panel');
    assert.equal(panel.render, 'native');
    assert.equal(panel.resolver.function, 'panel-resolver');
    assert.equal(panel.resource, 'main');
  });
  it('declares the Rovo agent with a name of at most 30 characters', () => {
    const agent = manifest.modules['rovo:agent'][0];
    assert.ok(agent.name.length <= 30, `agent name is ${agent.name.length} chars`);
    assert.equal(agent.actions.length, 3);
    assert.ok(existsSync(path.join(root, '..', 'prompts', 'prompt.md')));
  });
  it('declares the MCP module with the triage tool', () => {
    const mcp = manifest.modules['rovo:mcp'][0];
    assert.deepEqual(mcp.tools, ['get-issue-triage']);
  });
  it('every action has a matching function handler', () => {
    const fnKeys = new Set(manifest.modules.function.map((f) => f.key));
    for (const action of manifest.modules.action) {
      assert.ok(fnKeys.has(action.function), `action ${action.key} references missing function ${action.function}`);
    }
    for (const [name, modules] of Object.entries(manifest.modules)) {
      if (name === 'function' || name === 'action') continue;
      for (const m of modules) {
        if (m.resolver?.function) assert.ok(fnKeys.has(m.resolver.function), `${name} resolver missing function`);
      }
    }
  });
  it('declares all required scopes (Jira + Teamwork Graph)', () => {
    const scopes = manifest.permissions.scopes;
    for (const s of ['read:jira-work', 'write:jira-work', 'read:jira-user']) {
      assert.ok(scopes.includes(s), `missing scope ${s}`);
    }
    for (const s of ['read:graph:issue:jira', 'read:graph:issue-status:jira', 'read:graph:issue-comment:jira', 'read:graph:user:atlassian', 'read:graph:team:atlassian', 'read:graph:goal:atlassian']) {
      assert.ok(scopes.includes(s), `missing scope ${s}`);
    }
    assert.ok(scopes.length <= 50, 'Forge caps an app at 50 scopes');
  });
  it('uses a supported Node runtime and has a placeholder app id to replace', () => {
    assert.match(manifest.app.runtime.name, /^nodejs(22|24)\.x$/);
    assert.match(manifest.app.id, /^ari:cloud:ecosystem::app\//);
  });
  it('frontend entry and agent prompt files exist', () => {
    assert.ok(existsSync(path.join(root, '..', 'src', 'frontend', 'index.jsx')));
    assert.ok(existsSync(path.join(root, '..', 'src', 'index.js')));
  });
});
