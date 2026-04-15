# AGENTS_BACKEND.md

## 适用范围

- 当前模块 worktree 根目录：`C:\project\damage_backend_dev`
- 默认 Git 分支前缀：`backend/`；兼容 `server/`
- 这是同一 monorepo 下的后端专用 Git worktree，不是独立拆仓；仓内仍包含 `web/`、`wasm/`、`文档记录/` 等目录，但默认不要把它们当作当前任务的主写入范围。
- 如果任务落在 `server/data_manage/**`，除本文件外，启动时继续优先读取同目录下最近的 `server/data_manage/AGENTS.md`。

## 默认写入范围

1. `server/**`
2. `db/**`
3. `接口/**`
4. `tools/**` 中与后端、导入、任务治理直接相关的脚本
5. `文档记录/**` 中与后端接口、数据库、发布链直接相关的文档

## 默认只读参考

1. `web/**`
2. `wasm/**`
3. `demo/**`
4. `最小验证/**` 中与后端主链无直接关系的内容

## 启动时优先读取的上下文

1. `C:\project\obsidian-game\ai-remember\后端专用\00-项目索引.md`
2. `C:\project\obsidian-game\ai-remember\后端专用\01-当前上下文.md`
3. 与当前任务直接相关的后端专用专题页、任务页、会话记录页
4. 只有当任务需要历史决策或任务归属时，再读取 `后端专用\02-决策日志.md` 和 `后端专用\03-任务地图.md`
5. 只有当任务明确跨模块时，再回看 Vault 根目录共享页和 `上下文/Server-后端上下文.md`
6. 如果目标是 `server/data_manage/**`，继续读取：
	- `server/data_manage/README.md`
	- `server/data_manage/AGENTS.md`
	- `server/data_manage/src/main/resources/application.yml`

## 默认回写边界

1. 会话记录默认写入 `C:\project\obsidian-game\ai-remember\后端专用\会话记录\`
2. 不直接改 Vault 根目录的共享页，除非当前会话被明确指定为汇总/收口会话
3. 如果当前讨论同时影响 `web / server / wasm` 边界，先写后端专用会话记录页，再由汇总会话决定是否同步共享页

## 后端实现约定

1. 优先保证 `server/**` 在当前 monorepo worktree 中可单独构建、单独运行、单独验证。
2. 不要重新引入新的强耦合跨目录依赖，尤其不要让后端构建或运行继续直接依赖 `web/**` 或 `wasm/**` 的源码目录。
3. 变更数据库结构时，至少同时检查 `server/**`、`db/**`、`接口/**` 与相关文档口径是否一致。
4. 配置优先使用环境变量或外部配置，不把真实数据库连接、Redis 配置、JWT 密钥回写到仓库。
5. 需要跨模块改动时，只做支撑当前后端任务所必需的最小变更，并在会话记录中注明原因。

## 后端入口地图

1. `server/data_manage/src/main/java/xyz/game/datamanage/DataManageApplication.java`：Spring Boot 启动入口。
2. `server/data_manage/src/main/resources/application.yml`：本地默认配置、缓存、JWT 与依赖探测开关。
3. `server/data_manage/src/main/java/xyz/game/datamanage/controller/publicapi/**`：公共读取接口。
4. `server/data_manage/src/main/java/xyz/game/datamanage/controller/adminapi/**`：后台写接口与发布接口。
5. `server/data_manage/src/main/java/xyz/game/datamanage/service/GameDataService.java`：核心聚合服务。
6. `server/data_manage/src/main/java/xyz/game/datamanage/service/PostgresReadStore.java` / `PostgresWriteStore.java`：读写存储与发布链路。

## 默认验证与完成定义

1. 只改 `README.md`、`AGENTS*.md` 等文档时，可不跑构建，但要自检入口、命令、路径和验证说明是否仍与代码一致。
2. 修改 `controller/**`、`service/**`、`mapper/**`、`support/**` 时，默认至少运行 `mvn test`。
3. 修改 `pom.xml`、`application.yml`、缓存/JWT/启动依赖配置，或引入新的构建依赖时，默认再运行 `mvn package`。
4. 涉及发布链、缓存、版本读取、Bundle 组装或数据库结构时，至少补充或执行以下回归口径：
	- `current version` 读取
	- `bundle` 读取
	- Admin 资源增删改查
	- 发布后缓存与 bundle hash 行为
5. 任务完成前，确认文档、接口、SQL 与实现口径没有分叉；若无法在当前会话补齐，必须在会话记录页注明缺口与风险。

## SQLite 任务治理

1. 当前 worktree 的 `db/task_doc_governance/task_rules.json` 仍是任务映射真源。
2. 治理元数据变化后，运行 `node tools/task-governance/cli.mjs rebuild` 重建 SQLite。
3. 不要直接手改 `db/task_doc_governance/task_doc_governance.sqlite`。
