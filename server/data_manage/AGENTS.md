# AGENTS.md

## 适用范围

- 本文件适用于 `server/data_manage/**`。
- 如果与仓库根 `AGENTS.md` 或 `agent_group/AGENTS_BACKEND.md` 冲突，以更近的本文件为准；未覆盖部分沿用上层规则。

## 当前目录的主写入范围

1. `server/data_manage/**`
2. 为支撑当前后端任务所必需的 `db/**`、`接口/**`、后端相关 `文档记录/**`

## 启动时优先读取

1. `README.md`
2. `src/main/resources/application.yml`
3. 目标改动涉及的 `controller/**`、`service/**`、`mapper/**`、`config/**`

## 关键入口地图

1. `src/main/java/xyz/game/datamanage/DataManageApplication.java`：应用启动入口。
2. `src/main/resources/application.yml`：数据库、Redis、缓存、JWT 与启动探测配置。
3. `src/main/java/xyz/game/datamanage/controller/publicapi/GamePublicController.java`：游戏列表公共读取。
4. `src/main/java/xyz/game/datamanage/controller/publicapi/VersionPublicController.java`：当前版本与 Bundle 读取。
5. `src/main/java/xyz/game/datamanage/controller/adminapi/VersionAdminController.java`：版本创建与发布。
6. `src/main/java/xyz/game/datamanage/service/GameDataService.java`：服务聚合入口。
7. `src/main/java/xyz/game/datamanage/service/PostgresReadStore.java` / `PostgresWriteStore.java`：读取组装与发布写入主链路。
8. `src/main/java/xyz/game/datamanage/config/StartupDependencyVerifier.java`：依赖探测。

## 默认运行与验证

1. 本地启动：`mvn spring-boot:run`
2. 默认测试：`mvn test`
3. 打包校验：`mvn package`
4. 文档-only 修改可不跑构建，但要核对命令、入口和验证说明仍有效。

## 完成定义

1. 改 `controller/**`、`service/**`、`mapper/**`、`support/**`：至少跑 `mvn test`。
2. 改 `pom.xml`、`application.yml`、缓存/JWT/启动配置：再补 `mvn package`。
3. 改公共读取、发布链、缓存或数据库结构：至少验证 `current version`、`bundle`、Admin 资源写入、发布后缓存行为。
4. 改 SQL 或接口契约：同步检查 `db/**`、`接口/**`、README/设计文档口径。

## 常见陷阱

1. `application.yml` 仍保留示例直连配置；本地请优先用环境变量或私有配置覆盖，不要把真实凭据提交回仓库。
2. `app.startup.fail-fast` 默认是 `false`；如需在启动阶段立即暴露 PostgreSQL / Redis 问题，可显式设为 `true`。
3. `APP_AUTH_JWT_DISABLED` 默认允许本地关闭 Admin JWT；若改为启用，记得同时提供公钥配置并回归 Admin 接口。
4. CORS 当前只放开 `/api/**`；若联调异常，先确认请求路径而不是直接扩大放行范围。