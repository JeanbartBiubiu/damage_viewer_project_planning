# Backend AGENTS.md

## 范围与入口

本文件适用于 `server/data_manage/**`。先读同目录 `README.md` 和 `src/main/resources/application.yml`，再读目标路径更近的 `AGENTS.md`；依赖、初始化顺序、接口清单和命令以 README、`pom.xml` 与当前源码为准。

默认只写后端模块及任务明确包含的 `db/**`、接口文档和后端文档或工具。`web/**` 与 `wasm/**` 默认只读；共享契约变化返回主负责人统一处理。

## 当前边界

- 当前数据面是现行业务表和独立 `images` 分区。旧 `/combat-data/**`、版本发布和旧日志复制链路已删除，不恢复兼容。
- 公共游戏和图片读取位于 `controller/publicapi/**`；管理接口位于 `controller/adminapi/**`；图片管理实现位于 `controller/adminapi/image/**` 与 `service/image/**`。
- Java mapper 与 `src/main/resources/mapper/**` 的 XML statement id 必须一致。改 SQL 时同时核对实际 DDL、结果别名和调用链。
- `application.yml` 中的值是默认配置，环境变量和私有配置可能覆盖。不得提交真实数据库、Redis、JWT 或其他凭据。
- CORS 当前只覆盖 `/api/**`；认证或路径异常先确认请求与配置，不直接扩大放行范围。

## 验证

| 改动 | 最低证据 |
| --- | --- |
| 文档 | 核对入口、命令和链接，检查差异 |
| controller、service、mapper、support | 受影响测试；功能收尾运行 `mvn test` |
| `pom.xml`、`application.yml`、缓存、JWT 或启动装配 | `mvn test` 加 `mvn package` |
| 公共读取、缓存或数据库结构 | 对最终服务验证 `GET /api/games`、受影响图片接口和至少一类相关管理读写 |
| SQL 或接口契约 | 同步核对 `db/**`、接口文档和 README，并用对应层面的读回证明 |

仓库 SQL、单测或应用启动不能替代实库结构验证；需要访问 PostgreSQL 实库时使用 `backend-db-access`。已有证据只在对应最终代码未变化时复用。
