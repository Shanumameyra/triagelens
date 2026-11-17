# TEST-REPORT — TriageLens (Codegeist 2026)

**Date:** 17 Nov 2026 · **Command:** `npm test` (`node --test tests/*.test.js`, Node 24.22.1)
**Result: 50/50 PASS, 0 fail** (duration ~5.9 s)

| Suite | Tests | Pass |
|---|---|---|
| triage engine (`tests/triage.test.js`) | 24 | 24 |
| Teamwork Graph client (`tests/twg.test.js`) | 11 | 11 |
| Jira helpers (`tests/jira.test.js`) | 8 | 8 |
| manifest structure (`tests/manifest.test.js`) | 7 | 7 |
| **Total** | **50** | **50** |

## Fixes found by the tests (both fixed, re-run green)
1. Max-signal fixture expected 100 but the engine's theoretical max is 95
   (30+15+10+10+15+5+10; overload never applies when unassigned). Test corrected to 95.
2. `js-yaml` 5.x has no default ESM export — test now imports `{ load }`.

## Static validation (no Atlassian login available)
- `node --check`: `src/index.js`, `src/triage.js`, `src/twg.js`, `src/jira.js` — all OK.
- `esbuild --bundle` on `src/frontend/index.jsx` — exit 0, no warnings (JSX valid,
  `@forge/react` / `@forge/bridge` imports resolve).
- Versions: `@forge/api` 8.4.0, `@forge/react` 12.5.0, `@forge/resolver` 2.0.2,
  `@forge/bridge` 7.3.0, `react` 18.3.1, Forge CLI 15.1.0.

## Demo fixture run (realistic issues, 17 Nov 2026)
| Issue | Score | Band | Suggested priority |
|---|---|---|---|
| PROJ-101 login crash (Highest, stale 15d, 3 recent comments, 1 blocker) | 76/100 | Critical | Highest |
| PROJ-102 docs typo (Low, fresh, assigned) | 8/100 | Low | Low |
| PROJ-103 payment outage (High, unassigned, open 47d) | 66/100 | High | High |

## NOT yet verified (needs Romi's Atlassian account — see PLAN.md)
- `forge lint` / `forge deploy` / `forge install` — all require `forge login`.
- App running on a real Jira site (panel render, Rovo chat, MCP tool call).
- Installation link for judges (Distribution → Sharing in the developer console).
- Demo video recording (needs the app running on a real site).
