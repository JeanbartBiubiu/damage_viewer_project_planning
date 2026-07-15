---
name: writing-skills
description: Use when creating, editing, or verifying Codex/project skills under .agents/skills.
---

# Writing Skills (Codex-native)

Writing a skill is TDD for process docs: observe baseline behavior, write the smallest skill that corrects it, verify compliance, then close loopholes.

**Core principle:** If you did not watch failure (or reuse a documented observed failure) before editing, you do not know the skill teaches the right thing.

## When to create

**Create when:** the technique is non-obvious, reusable across sessions, and needs judgment (not a regex/CI check).

**Do not create for:** one-offs, well-documented standards, or project conventions that belong in `AGENTS.md`.

## Skill types

| Type | RED evidence | GREEN check |
|------|--------------|-------------|
| **Discipline** | Pressure scenarios (time, sunk cost, “just this once”) | Agent complies under the same pressures |
| **Reference** | Retrieval / application / gap probes | Agent finds and applies the right section |

## Minimum reusable observed-failure evidence

An existing failure may replace a fresh RED baseline **only** when all four are recorded and reusable:

1. **Scenario / input** — what the agent was asked to do (concrete prompt or situation)
2. **Expected behavior** — what the skill should enforce
3. **Actual behavior** — what happened (verbatim rationalizations when possible)
4. **Repeatable GREEN probe** — the same scenario re-runnable with the skill available

If any item is missing or too vague to re-run, run a **fresh baseline** before editing. Do not invent ceremony baselines when a complete observed failure already exists.

## Workflow (RED → GREEN → REFACTOR)

1. **Baseline before edit** — Read the current skill (if any), `AGENTS.md`, and nearby related skills. Capture failing behavior via a Codex-native subagent probe, or cite a prior failure that meets the minimum evidence above.
2. **Plan** — Use `update_plan` for the skill edit steps. Keep write scope to the skill tree you own.
3. **Write minimal skill** — Address the recorded failures only. `description` is trigger-only (start with `Use when...`); body stays compact and actionable.
4. **GREEN** — Re-run the same probe with the skill available; confirm compliance or correct retrieval.
5. **REFACTOR** — Plug new rationalizations; re-verify. Do not broaden into unrelated polish.

## Codecs / tools

- Prefer **Codex-native subagents** for independent baseline/GREEN probes. Do not fan out trivial sequential checks.
- Subagents default to exploration/review; give an explicit non-overlapping write set only when the parent must let them edit, and only if repo workflow allows that artifact type.
- Do **not** depend on `superpowers:*`, `TodoWrite`, `CLAUDE.md`, forced deletion of existing/user-modified skills, or mandatory commit/push.
- Optional Anthropic/historical files under this skill directory may remain for reference; they are **not** required by the active workflow. Active companion: `testing-skills-with-subagents.md`.

## Canonical copy vs sibling worktrees

- Project `.agents/skills` on **planning/`master`** is the canonical shared copy.
- Canonical-on-master does **not** authorize automatic writes into sibling worktrees.
- Before any deliberate mechanical sync, inspect each target worktree `git status` / `git diff`, obtain an **explicit bounded sync scope** from the user/driving model, and never overwrite user changes outside that scope.

## SKILL.md shape

```text
---
name: skill-name
description: Use when <trigger conditions only>
---
# Title
## Rules / Workflow  (short)
## Verification       (how to know it worked)
```

Flat layout: `SKILL.md` plus supporting files only when heavy reference or scripts are needed.

## Verification

Before finishing: description is trigger-only; body matches RED findings; GREEN evidence recorded; minimum observed-failure evidence complete (or a fresh baseline was run); no hard dependency on Claude-only tooling; no automatic sibling-worktree overwrite.
