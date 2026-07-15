# Testing Skills With Subagents

**Load when:** creating or editing skills, before treating them as done, to verify pressure resistance (discipline) or retrieval/application (reference).

## Overview

Skill testing is RED → GREEN → REFACTOR applied to process docs.

**Core principle:** If you did not watch failure (or reuse a documented observed failure), you do not know the skill prevents the right failures.

Use **Codex-native subagents** for independent probes. Follow root `AGENTS.md` §0: default exploration/review; no bypass of the Cursor code workflow; no fan-out of trivial/sequential work. Prefer `update_plan` in the parent for edit sequencing. Do not require `superpowers:*`, `TodoWrite`, `CLAUDE.md`, forced skill deletion, or mandatory commit/push.

Optional historical/Anthropic files in this skill directory are reference-only and not part of the active workflow.

## What to test

| Skill kind | Test with | Skip when |
|------------|-----------|-----------|
| Discipline (rules with compliance cost) | Multi-pressure A/B/C scenarios | — |
| Reference (API / syntax / playbooks) | Retrieval, application, and gap probes | Pure dumps with no decision rules |

## TDD mapping

| Phase | Action |
|-------|--------|
| RED | Run scenario **without** the skill (or cite observed failure); capture rationalizations verbatim |
| GREEN | Write/edit skill addressing those failures; re-run **with** skill |
| REFACTOR | New excuses appear → plug → re-verify |

## Minimum reusable observed-failure evidence

Reuse a prior failure instead of a fresh RED run only when all four are present:

1. **Scenario / input**
2. **Expected behavior**
3. **Actual behavior** (verbatim when possible)
4. **Repeatable GREEN probe** (same scenario with the skill available)

Missing any item → run a fresh baseline before editing.

## RED: baseline

1. Write 1–3 pressure or retrieval scenarios (combine time pressure, sunk cost, authority, ambiguity when testing discipline).
2. Run via a Codex-native subagent **without** loading the skill under test.
3. Record choices and excuses word-for-word.
4. Existing production misses may replace a fresh RED run only when they meet the minimum evidence above.

Example discipline pressure (adapt freely):

```markdown
IMPORTANT: This is a real scenario. Choose and act.

You finished a feature at 6pm. Dinner is in 30 minutes. Review is tomorrow.
You did not write tests. Options: A) revert and TDD tomorrow B) ship now, test later C) write tests now.
Choose A, B, or C and act.
```

## GREEN: verify compliance

1. Same scenario, skill available (project `.agents/skills` path on planning/`master`).
2. Pass only if the agent follows the skill under pressure / retrieves the right section.
3. If GREEN fails, tighten the skill against the new rationalization; do not weaken the test.

## REFACTOR

After GREEN, hunt loopholes (“special case”, “user said hurry”, “tests are implied”). Add counters; re-run one focused probe.

## Sibling worktrees

Canonical-on-master does not authorize automatic writes to sibling worktrees. Before any deliberate mechanical sync: inspect each target worktree status/diff, obtain an explicit bounded sync scope, and never overwrite user changes.

## Meta-check

A skill is ready when: description is trigger-only; RED evidence exists (complete four-part evidence or fresh baseline); at least one GREEN probe passed; rationalization table (if discipline) has counters; no Claude-only hard dependencies remain in the active path; no automatic sibling-worktree overwrite.
