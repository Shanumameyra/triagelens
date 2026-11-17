# TriageLens — See what matters in every Jira issue

**Codegeist 2026 entry** (Atlassian, Devpost) — Category: **Apps for Software Teams**
Bonus prizes targeted: **Best Agents (Rovo)** · **Best app with Atlassian MCP** · **Best apps with Teamwork Graph integration**

Dev teams drown in backlogs. Nobody can tell which issue to work on first, who is
overloaded, or what is blocking what — the context is scattered across issues,
comments, and goals. TriageLens puts that context in one place.

## What it does

1. **Jira issue panel** — every issue gets a triage score (0–100) with a transparent,
   itemised breakdown, a suggested priority, labels, the least-loaded teammate, and
   linked goals. Two clicks apply the suggested priority and labels.
2. **Rovo agent — "TriageLens Guide"** — chat with it in Jira:
   - "What should I work on first?"
   - "Who is involved in PROJ-123?"
   - "Who on my team has room for more work?"
3. **MCP server — "TriageLens MCP"** — exposes a `get-issue-triage` tool so
   third-party agents can call the same triage engine.

## How the score works (deterministic, no external AI)

| Signal | Max points |
|---|---|
| Priority as set on the issue | 30 |
| Days since last update | 15 |
| Days since created | 10 |
| Comments in the last 7 days | 10 |
| Open blockers | 15 |
| Linked to a goal | 5 |
| Unassigned | 10 |
| Assignee overload (>8 open items) | −10 |

Bands: **Critical ≥75 · High 55–74 · Medium 35–54 · Low <35**.
Done issues always score 0. Every point is explained in the panel — no black box.

Teamwork Graph (Preview) supplies the connected context: assigned work, issue
comments, linked goals, team members — read as the user, paged 25 rows at a time,
with retries. If a source cannot be read, the app says so instead of pretending
there is nothing there.

## Tech

- Atlassian Forge (`nodejs24.x`), UI Kit (`@forge/react`), `@forge/api` 8.4.0
- `src/triage.js` — pure triage engine (fully unit-tested, no Forge runtime needed)
- `src/twg.js` — Teamwork Graph client (curated GraphQL, operation naming, paging, retry)
- `src/jira.js` — Jira REST helpers (injected transport, fully testable)
- `src/index.js` — panel resolver, Rovo actions, MCP tool
- `src/frontend/index.jsx` — issue panel UI

## Tests

```
npm test   # node --test, 50 tests
```

**50/50 pass** (see [TEST-REPORT.md](TEST-REPORT.md)): triage engine 24, Teamwork
Graph client 11, Jira helpers 8, manifest structure 7.

## Setup (for judges)

1. Install the app from the installation link on the Devpost submission.
2. Approve the scopes (Jira read/write, Jira users, Teamwork Graph read scopes).
   Installing the Teamwork Graph scopes needs an organisation admin.
3. Open any Jira issue — the **TriageLens** panel shows the triage score.
4. In Rovo chat, ask the **TriageLens Guide** agent: "What should I work on first?"
5. Note: Rovo is available on Standard/Premium/Enterprise plans (or a trial of one);
   the issue panel works on any Jira Cloud site.

## Status

Built November 2026 for Codegeist 2026. The app is new, created for this hackathon.
`forge deploy` / `forge install` and the public installation link are created after
Atlassian login (see [PLAN.md](../PLAN.md)).
