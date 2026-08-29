# AGENTS.md

## 适用范围

- 本文件适用于 `server/data_manage/**`。
- 如果与仓库根 `AGENTS.md` 冲突，以更近的本文件为准；未覆盖部分沿用上层规则。
- 根 `AGENTS.md` 只负责 worktree 路由和治理摘要；后端入口、命令、验证和常见陷阱以本文件和同目录 `README.md` 为准。

## 当前目录的主写入范围

1. `server/data_manage/**`
2. 为支撑当前后端任务所必需的 `db/**`、`接口/**`、后端相关 `文档记录/**`
3. 与后端构建、数据导入、验证直接相关的 `tools/**`

默认只读参考：

1. `web/**`
2. `wasm/**`
3. 非后端专题的 `文档记录/**`

## 启动时优先读取

1. `README.md`
2. `src/main/resources/application.yml`
3. 目标改动涉及的 `controller/**`、`service/**`、`mapper/**`、`config/**`

## 关键入口地图

1. `src/main/java/xyz/game/datamanage/DataManageApplication.java`：应用启动入口。
2. `src/main/resources/application.yml`：数据库、Redis、缓存、JWT 与启动探测配置。
3. `controller/publicapi/GamePublicController.java`：游戏列表公共读取（`gameId` / `gameName` / 可空 `gameImgUrl`）。
4. `controller/publicapi/ImagePublicController.java`、`controller/adminapi/ImageAdminController.java`：图片读取与写入。
5. `controller/adminapi/attribute|character|equipment|skill*|status|damagetype|skillprocess|skilleffect|skillinternalstate/**`：阶段 0～7.4 当前管理接口。
6. `service/GameDataService.java`：games / images 薄聚合。
7. `service/PostgresReadStore.java`、`service/PostgresWriteStore.java`：游戏读取与图片/编辑日志写入。
8. `mapper/**` + `src/main/resources/mapper/**`：当前业务表与图片访问。
9. `config/StartupDependencyVerifier.java`：依赖探测。

当前数据面：阶段 0～7.4 业务表 + 独立 `images` 分区。旧 `/combat-data/**`、旧版本发布和旧 `*_log` 拷贝链路已经删除。

## 默认运行与验证

前置要求：

1. JDK `21`
2. Maven `3.9+`
3. PostgreSQL
4. Redis

常用命令：

1. 本地启动：`mvn spring-boot:run`
2. 默认测试：`mvn test`
3. 打包校验：`mvn package`
4. 文档-only 修改可不跑构建，但要核对命令、入口和验证说明仍有效。

## 完成定义

1. 改 `controller/**`、`service/**`、`mapper/**`、`support/**`：至少跑 `mvn test`。
2. 改 `pom.xml`、`application.yml`、缓存/JWT/启动配置：再补 `mvn package`。
3. 改公共读取、缓存或数据库结构：至少验证 `GET /api/games`、图片接口，以及至少一类阶段 0～7.4 管理读写；旧 combat-data / versions 路径应返回普通 404。
4. 改 SQL 或接口契约：同步检查 `db/**`、`接口/**`、README/设计文档口径。

## 常见陷阱

1. `application.yml` 仍保留示例直连配置；本地请优先用环境变量或私有配置覆盖，不要把真实凭据提交回仓库。
2. `app.startup.fail-fast` 默认是 `false`；如需在启动阶段立即暴露 PostgreSQL / Redis 问题，可显式设为 `true`。
3. `APP_AUTH_JWT_DISABLED` 默认允许本地关闭 Admin JWT；若改为启用，记得同时提供公钥配置并回归 Admin 接口。
4. CORS 当前只放开 `/api/**`；若联调异常，先确认请求路径而不是直接扩大放行范围。
5. 不要把已删除的 `/combat-data/**`、`versions/current` 或 `versions:publish` 当成当前能力；图片分区只由 `ensure_game_partitions` 维护。
