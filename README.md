# Damage Viewer — repository router

Monorepo planning root and cross-worktree collaboration hub. Module commands live in each module README — do not duplicate them here.

## Worktrees / modules

| Area | Worktree (typical) | Start here |
|------|--------------------|------------|
| Planning / governance | `C:\project\damage_viewer_project_planning` (`master`) | `AGENTS.md`, `项目设计说明书/README.md` |
| Backend | `C:\project\damage_backend_dev` | `server/data_manage/README.md`, `server/data_manage/AGENTS.md` |
| Web | `C:\project\damage_web_dev` | `web/README.md`, `web/AGENTS.md` |
| Wasm / TinyGo V2 | `C:\project\damage_wasm_dev` | `wasm/tinygo_engine_v2/README.md`, `wasm/tinygo_engine_v2/AGENTS.md` |

先按工作树根目录路由，再参考分支前缀。细则见根 `AGENTS.md` §4。

**共享真源：** planning/`master` 保存根 `AGENTS.md`、`.agents/skills/**`、治理工具和 `task_rules.json`。共享变更在该分支验证、提交并推送；模块分支自行 `fetch` 后按既定策略合入，不跨工作树手工复制。

## Rule precedence

These layers answer different questions; do not treat root README as overriding `AGENTS.md`:

1. **Nearest `AGENTS.md`** overrides broader/parent `AGENTS.md` for module-local process rules.
2. **Module README / code / tests** describe current technical facts and commands for that module.
3. **根 `AGENTS.md`** 定义跨工作树协作流程、按风险评审和代理职责。
4. **`db/task_doc_governance/task_rules.json`** owns task↔doc mapping and task status.

Implementation narrative lives under `文档记录/**`. Obsidian / Codex Memory are secondary memory only — never a competing task map.

## 治理检查

任务状态、文档映射或文档头变化时运行第一项；共享规则发布前可运行第二项查看其他分支尚未合入的漂移。两项命令都不复制共享文件。

```powershell
node tools/task-governance/cli.mjs check
node tools/agent-governance/cli.mjs check
```

开发流程见根 `AGENTS.md` §2。Cursor 为可选工具，仅实际调用时读取 `.agents/skills/cursor-local-agent/SKILL.md`；工具说明见 `文档记录/详细设计/Cursor协同开发流程说明.md`。
