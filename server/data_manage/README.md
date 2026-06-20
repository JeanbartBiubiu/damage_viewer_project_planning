# Damage Viewer Backend

`server/data_manage` 是 Damage Viewer 的 Java / Spring Boot 后端，负责承接游戏数据管理、版本发布、公共读取接口、Bundle 组装与后台写接口。

它在整条链路里的位置是：

1. 从 `db/**` 定义的 PostgreSQL 结构中读取和写入草稿数据。
2. 对外提供 `games / current version / bundle / owner-categories / images` 等公共读取接口。
3. 对内提供 `versions publish`、`heroes`、`skills`、`items`、`formula-profiles`、`formula-bindings`、`attribute-definitions`、`coefficient-buckets`、`types`、`type-relations`、`status-action-control-rules`、`status-definitions`、`control-state-profiles`、`status-modifier-groups`、`status-attribute-modifiers`、`status-periodic-hp-effects`、`images`、`progression-schema` 等 Admin 接口。
4. 为前端工作台和 Wasm 模拟提供发布后的稳定数据来源。

## 开发范围

这个模块默认主写入范围：

- `server/data_manage/**`
- `db/**`
- `接口/**`
- 与后端直接相关的 `tools/**`

默认只读参考：

- `web/**`
- `wasm/**`
- `文档记录/**` 中与后端直接相关的设计说明

## 当前主要入口

- 启动入口：`src/main/java/xyz/game/datamanage/DataManageApplication.java`
- 默认配置：`src/main/resources/application.yml`
- 公共读取控制器：`src/main/java/xyz/game/datamanage/controller/publicapi/**`
- Admin 控制器：`src/main/java/xyz/game/datamanage/controller/adminapi/**`
- 核心服务：`src/main/java/xyz/game/datamanage/service/GameDataService.java`
- Bundle 读取组装：`src/main/java/xyz/game/datamanage/service/PostgresReadStore.java`
- 发布写入与校验：`src/main/java/xyz/game/datamanage/service/PostgresWriteStore.java`
- 启动依赖探测：`src/main/java/xyz/game/datamanage/config/StartupDependencyVerifier.java`

如果你是 agent 或首次进入当前目录，先读同目录的 `AGENTS.md`，再开始修改。

## 本地开发

### 前置要求

- JDK `21`
- Maven `3.9+`
- PostgreSQL
- Redis

默认端口沿用 Spring Boot 默认值：`8080`。

### 常用命令

| 命令 | 用途 | 备注 |
| --- | --- | --- |
| `mvn spring-boot:run` | 启动本地开发服务 | 默认读取 `src/main/resources/application.yml` |
| `mvn test` | 运行测试与基础回归 | 改 `controller/service/mapper/support` 时默认至少执行 |
| `mvn package` | 打包校验 | 改 `pom.xml`、配置、依赖或发布链时建议执行 |

### SQL 兼容迁移

`db/game_manage/schema.sql` 适用于新库初始化；已有库不会因为 `CREATE TABLE IF NOT EXISTS` 自动调整列宽。
如果已有环境的 `game_versions.version_code` 或 `published_bundle_snapshots.version_code` 仍是 `varchar(32)`，先执行 `db/game_manage/version_code_varchar64_compatibility_migration.sql`，再发布长度超过 32 的版本码。
如果已有环境的 `coefficient_buckets.stage_key` 或 `coefficient_buckets_log.stage_key` 仍是 `varchar(32)`，先执行 `db/game_manage/coefficient_bucket_stage_key_varchar64_compatibility_migration.sql`。

## 配置与环境变量

当前仓内 `src/main/resources/application.yml` 仍保留示例直连配置。**本地开发请优先使用环境变量或本机私有配置覆盖，不要把真实数据库、Redis、JWT 凭据写回仓库。**

常用覆盖项：

| 环境变量 | 用途 |
| --- | --- |
| `SPRING_DATASOURCE_URL` | 覆盖 PostgreSQL 连接串 |
| `SPRING_DATASOURCE_USERNAME` / `SPRING_DATASOURCE_PASSWORD` | 覆盖数据库账号密码 |
| `IT_DB_INIT_FAIL_TIMEOUT` | 调整 Hikari 初始化失败等待时间 |
| `IT_REDIS_HOST` / `IT_REDIS_PORT` / `IT_REDIS_PASSWORD` / `IT_REDIS_DATABASE` | 覆盖 Redis 连接配置 |
| `APP_STARTUP_FAIL_FAST` | 是否在启动阶段立即校验 PostgreSQL / Redis 可用性 |
| `APP_AUTH_JWT_DISABLED` | 是否关闭本地 Admin JWT 校验 |
| `IT_ADMIN_JWT_ES256_PUBLIC_KEY_PEM` | 启用 Admin JWT 时提供 ES256 公钥 |

补充说明：

- `APP_STARTUP_FAIL_FAST=true` 时，会在启动阶段主动探测 PostgreSQL 和 Redis；否则通常在第一次触发相关请求时才暴露依赖问题。
- CORS 当前只放开 `/api/**` 路径，并暴露 `ETag` 响应头；联调异常时先确认请求路径与响应头需求。

## 常用验证

### 最低验证标准

- 文档-only 变更：核对入口、命令、路径与 README 说明即可，可不跑 Maven。
- 代码变更：默认至少运行 `mvn test`。
- 配置、依赖、打包链路变更：在 `mvn test` 之外再运行 `mvn package`。

### 联调 / 发布回归清单

涉及接口、发布链、缓存或数据库结构时，至少回归：

1. `GET /api/games`
2. `GET /api/games/{gameId}/versions/current`
3. `GET /api/games/{gameId}/versions/{versionCode}/bundle`
4. 至少一类 Admin 资源的增删改查
5. 发布后缓存刷新与 bundle 快照行为

## 常见失败与排查

1. **启动成功但首个请求才报依赖错误**：检查是否把 `APP_STARTUP_FAIL_FAST` 保持为默认关闭；需要尽早暴露问题时显式设为 `true`。
2. **启动阶段直接失败**：优先核对 PostgreSQL / Redis 地址、账号密码和连通性，再看 `application.yml` 是否仍引用了不适合当前环境的示例值。
3. **Admin 接口返回 401 / 403**：检查 `APP_AUTH_JWT_DISABLED` 是否已关闭，以及是否同时提供了 `IT_ADMIN_JWT_ES256_PUBLIC_KEY_PEM`。
4. **发布后读到旧数据**：优先回归发布接口、Redis 可用性与缓存键更新，再检查 Bundle 生成链路。
5. **改了 SQL 或 Mapper 后查询异常**：同步检查 `db/**`、`src/main/resources/mapper/**/*.xml`、`mapper/**`、`service/**` 口径是否一致。

## 协作说明

- 这不是独立仓，而是 monorepo 下的后端专用 worktree。
- 涉及 `web / server / wasm` 边界的改动，优先先把后端口径、接口契约和会话记录收口，再决定是否同步改其他模块。
- 长期协作规则见仓库根 `AGENTS.md`；当前目录的就近规则见 `AGENTS.md`。
