# Damage Viewer 后端

后端保存作者配置、维护引用与图片，并返回一致性场景快照及完整对象可用目录；不执行战斗计算。当前直接读取PostgreSQL，不依赖Redis或Spring方法缓存。工作范围与验证门槛见[模块规则](AGENTS.md)。

## 接口与实现入口

以下管理路径相对 `/api/admin/games/{gameId}`；完整请求与错误结构以相应控制器、请求类型及服务校验为准。

| 能力 | 当前入口 |
| --- | --- |
| 公共游戏列表 | `GET /api/games`，支持ETag条件请求，`controller/publicapi/GamePublicController.java` |
| 公共图片同步 | `GET /api/games/{gameId}/images?updatedAfter=...`，按时间游标做全量／增量同步 |
| 各类管理读写 | `controller/adminapi/`；游戏、属性、角色、装备、构筑、技能组成、状态、乘区、图片及关系 |
| 技能统一配置 | `GET/POST/PATCH /skills/{skillKey}/configuration`，`SkillConfigurationAdminController` 及 `SkillConfigurationService` |
| 角色录入检查 | `CharacterAuthoringCheckAdminController`；只读结构检查，机制及运行另行验收 |
| 场景快照 | `POST /simulation-snapshot`，`SimulationSnapshotAdminController` 及 `SimulationSnapshotService` |
| 完整对象可用目录 | `GET /simulation-availability`；核对范围、配置、依赖及正式引擎／适配器身份 |
| 配置引用审计 | `GET /configuration-reference-audit`；只读检查当前配置与引用索引，不自动修复 |
| 管理图片目录 | `GET /images` 只读元数据，不返回图片正文；详情、写入及公共同步仍返回现行完整内容 |

源码位于 `src/main/java/xyz/game/datamanage/`，SQL映射位于 `src/main/resources/mapper/`。公共读取在 `controller/publicapi/`，管理端在 `controller/adminapi/`，业务校验在 `service/` 与 `support/authoring/`。

统一技能读取返回完整主体、参数、公式、效果、内部状态、过程、规则及整技能摘要 `baseDigest`。组合写入按明确变更列表，在同一游戏写锁及事务内核对摘要和最终组合，未提交对象保留，失败回滚；最高等级变化必须显式提交受影响参数，不自动补零。

`GameConfigurationWriteGuard` 以 `READ COMMITTED` 事务和游戏行锁串行化同游戏配置写入，核对受影响来源及引用链并定向更新 `skill_object_references`。`SkillObjectReferences` 提取完整引用，`SkillNumericSemantics` 检查实际数值用途。直接SQL不会自动执行这些服务校验。

场景快照使用一致性只读事务，保留完整作者数据、所选构筑、真实来源身份和等级，不持久化场景或执行战斗。可用目录中的历史证明须重新匹配当前内容与运行身份，不能由管理保存或组件通过直接授予完整对象准入。

## 存储与初始化

[建表脚本](../../db/game_manage/schema.sql)当前定义30张public逻辑表，包含图片分区父表，不含子分区与其他模式。角色和装备属性、技能六模块、构筑四表、吸血与计算规则均按该脚本维护；结构化技能根对象使用JSONB。完整模型关系见[系统精简设计](../../文档记录/概要设计/项目/实录驱动的系统精简设计.md)。

新库按顺序执行 `db/game_manage/schema.sql`、`db/game_manage/triggers.sql`，再录入游戏和业务数据；没有必跑业务种子。后者安装游戏新增时的图片分区函数与触发器。

已有库先核对实际结构和备份，再选择 `db/game_manage/migrations/` 中所需脚本。应用不自动执行迁移，不批跑目录；旧91表聚合迁移、符文三表替换及旧数值取值升级只适用于各自前置结构，不是新库步骤。脚本自身是否开启／提交事务须逐份确认；静态SQL和单测不证明实库已迁移。

## 鉴权与编辑留痕

管理鉴权在 `support/auth/AdminAuthFilter.java` 与 `JwtVerifier.java`。启用时按当前ES256签名令牌及编辑权限核验；本地关闭开关不代表公网部署要求。跨域配置 `WebCorsConfig` 覆盖 `/api/**`、允许现行请求方法并暴露ETag。

编辑记录由 `AdminEditLogHelper`、`PostgresWriteStore` 及对应mapper维护；写入流程调用过期日志清理。实际留痕及失败语义查源码，不沿用旧文档中必须安装定时清理扩展的要求。当前没有另建注册、登录或编辑日志查询页面。

## 本地开发与配置

前置为JDK 21、Maven 3.9+和PostgreSQL。在 `server/data_manage/` 运行：

```powershell
mvn spring-boot:run
mvn "-Dtest=具体测试类" test
mvn test
mvn package
```

默认配置在 `src/main/resources/application.yml`，由环境变量或私有配置覆盖；不提交真实凭据。常用变量：

| 变量 | 用途 |
| --- | --- |
| `SPRING_DATASOURCE_URL` | PostgreSQL连接串 |
| `SPRING_DATASOURCE_USERNAME` / `SPRING_DATASOURCE_PASSWORD` | 数据库账号与密码 |
| `IT_DB_INIT_FAIL_TIMEOUT` | 连接池初始化失败等待 |
| `APP_STARTUP_FAIL_FAST` | 启动时检查数据库依赖 |
| `APP_AUTH_JWT_DISABLED` | 关闭本地管理鉴权的开关 |
| `IT_ADMIN_JWT_ES256_PUBLIC_KEY_PEM` | 管理令牌核验公钥 |

默认服务端口为8080。`mvn spring-boot:run` 的本机进程通信临时目录由 `pom.xml` 配置到模块 `target/`，避免Windows临时目录的套接字连接异常。启动后仍应验证实际读取接口；401／403先核对鉴权开关、令牌与公钥。

## 验证与运维

按改动运行受影响测试，功能收尾执行 `mvn test`；配置、依赖或启动装配变化再执行 `mvn package`。数据库或公共读取变化时，对最终服务核对游戏列表、图片和受影响管理读写，写入另做独立回读，检查引用拒绝及失败事务无部分残留。

数据库访问规则见仓库 `.agents/skills/backend-db-access/SKILL.md`，录入方法见[录入边界](../../文档记录/项目说明/计算范围与录入边界.md)，备用发布见[部署规程](../../文档记录/项目说明/部署操作规程.md)。各层证据分开报告，源码与建表脚本不代替实库核验；历史安装流水与逐对象验证不在本页累积。
