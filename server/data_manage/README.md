# Damage Viewer 后端

后端保存作者配置、维护引用与图片，并返回一致性场景快照及完整对象可用目录；不执行战斗计算。当前直接读取PostgreSQL，不依赖Redis或Spring方法缓存。工作范围与验证门槛见[模块规则](AGENTS.md)。

## 接口与实现入口

以下管理路径相对 `/api/admin/games/{gameId}`；完整请求与错误结构以相应控制器、请求类型及服务校验为准。

| 能力 | 当前入口 |
| --- | --- |
| 公共游戏列表 | `GET /api/games`，支持ETag条件请求，`controller/publicapi/GamePublicController.java` |
| 访问统计 | 匿名上报、编辑账号查询近30天；[统计口径、接口及独立建表入口](../../db/visit_statistics/README.md) |
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

触发规则的事务与保存阶段由 `service/skilltrigger/SkillTriggerRuleService` 协调；`validation/` 负责无数据库的结构校验和只读引用需求，`reference/` 负责目录加锁、输入依赖校验与反向引用保护。效果和过程直接使用已有循环检查器，其他对象通过引用保护组件检查变更；统一保存仍在全部对象落地后检查最终组合。拆分证据见[触发规则拆分验收](../../文档记录/测试记录/server/触发规则校验与引用保护拆分验收-2026-11-02.md)。

`GameConfigurationWriteGuard` 以 `READ COMMITTED` 事务和游戏行锁串行化同游戏配置写入，核对受影响来源及引用链并定向更新 `skill_object_references`。`SkillObjectReferences` 提取完整引用，`SkillNumericSemantics` 检查实际数值用途。直接SQL不会自动执行这些服务校验。

场景快照使用一致性只读事务，保留完整作者数据、所选构筑、真实来源身份和等级，不持久化场景或执行战斗。可用目录中的历史证明须重新匹配当前内容与运行身份，不能由管理保存或组件通过直接授予完整对象准入。

## 存储与初始化

[建表脚本](../../db/game_manage/schema.sql)当前定义30张public逻辑表，包含图片分区父表，不含子分区与其他模式。角色和装备属性、技能六模块、构筑四表、吸血与计算规则均按该脚本维护；结构化技能根对象使用JSONB。完整模型关系见[系统精简设计](../../文档记录/概要设计/项目/实录驱动的系统精简设计.md)。

新库按顺序执行 `db/game_manage/schema.sql`、`db/game_manage/triggers.sql`，再录入游戏和业务数据；没有必跑业务种子。后者安装游戏新增时的图片分区函数与触发器。

已有库先核对实际结构和备份，再选择 `db/game_manage/migrations/` 中所需脚本。应用不自动执行迁移，不批跑目录；旧91表聚合迁移、符文三表替换及旧数值取值升级只适用于各自前置结构，不是新库步骤。脚本自身是否开启／提交事务须逐份确认；静态SQL和单测不证明实库已迁移。

## 鉴权与编辑留痕

账号入口位于 `support/account/`，共享字段、阶段和权限以[账号方案](../../文档记录/详细设计/项目/账号注册登录与权限接入技术方案.md)为准。全部游戏 GET 及只读 `POST /api/admin/games/{gameId}/simulation-snapshot` 匿名开放，即使携带失效 Cookie 也不检查会话；账号私有操作、计算票据和游戏写入按各自凭证检查。游戏写入要求已开通的正式会话及编辑资格，`AccountGameWriteGuard` 在真实写事务开始后先持有账号共享锁并复核版本，再进入游戏业务。旧手填令牌、邮箱身份和鉴权关闭开关已移除。

注册必须完成验证器绑定及恢复码保存确认；正确密码可续办未完成注册。账号开通只由独立内网凭据调用 `POST /internal/accounts/{accountId}/enable-login`；请求头 `X-Damage-Internal-Token` 的值从私密文件读取，不使用玩家会话。请求体为 `{enablementReference}`。相同关联编号可重试，冲突不覆盖首次开通。禁用和编辑资格维护由 `AccountMaintenance.changeAccess` 在账号排他锁内完成并提升凭证版本，当前没有普通玩家权限管理路由。

正式会话、流程及对应防跨站请求伪造值使用独立的安全 Cookie，不写浏览器存储。账号及写入请求必须带允许的精确 `Origin`、`Content-Type: application/json` 和 `X-Damage-Client: web`；有会话／流程的状态变更再核对各自可读 Cookie、`X-CSRF-Token` 和数据库摘要。初始化注册、登录及恢复请求忽略残留 Cookie；安全变更起点用会话防伪值，后续流程用流程防伪值。流程 GET（材料与状态）也要求流程防伪证明；创建及已验证的流程响应用 `X-Damage-Flow-CSRF` 返回本流程的绑定值，页面固定该值后发请求，防止多标签页 Cookie 切换误确认另一批材料。完成流程只保留到原截止时间的状态回查，临时密文立即擦除。

跨域配置由 `WebCorsConfig` 按操作区分：游戏公共读取允许无凭据跨域，账号及写入仅允许配置中的来源并允许受控凭据。账号响应均禁止缓存。浏览器与接口须使用同源 HTTPS；本地通过 HTTPS 前端代理访问回环后端，不能去掉 Cookie 的安全属性。

编辑记录由 `AdminEditLogHelper`、`PostgresWriteStore` 及对应mapper维护，身份是账号 UUID 与当时用户名快照；迁移保留历史邮箱列及原记录。部分既有编辑日志助手仍采用容错策略；账号安全事件完全独立，关键状态与事件同事务提交，绝不向编辑日志传递密码、动态码、种子或恢复材料。新库及一次性迁移入口见[账号数据库说明](../../db/user_manage/README.md)。

每小时清理超过七天、从未开通的账号，按 200 个一批持锁重新核对，单轮最多 20 批；满七天整不删除，已开通过的禁用账号保留。过期流程、会话、限流记录及超过 30 天安全事件另作有界清理。默认启用，隔离验证时可暂停调度；上线前核对候选、备份与内网接口外部不可达。应用不会自动运行建表或迁移。

## 本地开发与配置

前置为JDK 21、Maven 3.9+和PostgreSQL。在 `server/data_manage/` 运行：

```powershell
mvn spring-boot:run
mvn "-Dtest=具体测试类" test
mvn test
mvn package
```

默认配置在 `src/main/resources/application.yml`，由环境变量或私有配置覆盖；数据库密码必须通过 `SPRING_DATASOURCE_PASSWORD` 或私有配置提供，源码不保存真实密码。常用变量：

| 变量 | 用途 |
| --- | --- |
| `SPRING_DATASOURCE_URL` | PostgreSQL连接串 |
| `SPRING_DATASOURCE_USERNAME` / `SPRING_DATASOURCE_PASSWORD` | 数据库账号与密码 |
| `IT_DB_INIT_FAIL_TIMEOUT` | 连接池初始化失败等待 |
| `APP_STARTUP_FAIL_FAST` | 启动时检查数据库依赖 |
| `APP_AUTH_ALLOWED_ORIGINS` | 精确浏览器来源列表，默认 `https://localhost:5173` |
| `APP_AUTH_AEAD_KEYSET_PATH` / `APP_AUTH_AEAD_KEY_ID` | 数据库外的带认证加密密钥集文件及编号 |
| `APP_AUTH_GRANT_PRIVATE_KEY_PATH` / `APP_AUTH_GRANT_KEY_ID` | Ed25519 计算票据私钥文件及公钥编号 |
| `APP_AUTH_INTERNAL_TOKEN_PATH` | 独立内网调用凭据文件 |
| `APP_AUTH_INTERNAL_TRUSTED_ADDRESSES` | 直连可信来源地址清单，默认仅回环 |
| `APP_AUTH_CLEANUP_ENABLED` | 默认 `true`，隔离验证可设 `false` 暂停定时调度 |
| `SERVER_ADDRESS` | 默认 `127.0.0.1`；仅显式改为受控内网监听 |

默认服务端口为8080，默认监听回环且 `server.forward-headers-strategy=none`。可信来源仅取直连地址，不接受转发来源头；非回环的内网调用还要求直接加密连接。过滤器使用 Spring 实际路由的解码及矩阵参数语义分类，内部控制器在任何账号操作前还强制执行独立凭据守卫。公网代理须明确拒绝转发 `/internal/**` 及其规范化变体，防火墙限制后端直连端口，并从外网实测拒绝结果。账号浏览器流量可由同机 HTTPS 代理转入回环后端。

`mvn spring-boot:run` 的本机进程通信临时目录由 `pom.xml` 配置到模块 `target/`。启动后验证实际读取及账号接口。新密码由 PostgreSQL 的 `public.crypt()` 和 `public.gen_salt('bf',10)` 生成，固定 bcrypt 成本 10；验证只接受完整的 `$2a$10$` 或已有 `$2a$12$` 的 60 字符编码。已有成本 12 密码继续按 12 验证，不自动重哈希或处理账号数据。未知账号或非法编码执行成本 10 的虚拟校验并强制失败，因此混合存量 12 期间仍有可测的成本时间差；不宣称耗时均衡。没有 Argon2 或其他成本回退，本次也不新增或重写数据库迁移。

新密码至少 12 个 Unicode 字符、UTF-8 最多 72 字节；注册与验证均拒绝空字符和孤立代理项，不去首尾空白、不规范化、不截断。`PasswordTasks` 在请求调用线程直接执行数据库操作，不再创建专用线程池、排队或设置固定密码并发数；既有连接池与数据库查询期限仍生效。查询执行期限五秒，连接网络期限最多十秒，原连接状态随后复原。数据库安全配置不足返回 503，认证限流返回 429 和 `Retry-After`。

密码证明开始前，以固定账号→来源地址顺序，在同一独立短事务原子预占两项固定窗口额度；任一不足则整批回滚。计数暂时包含失败及未决尝试，不持有计数行锁跨越密码计算。证明资源持有到登录、验证器恢复或安全操作结束；正确证明、技术错误和安全操作中的动态码错误按原窗口键退回一次，错误密码及验证器恢复中的 401 保留原占额。成功登录不永久消耗密码失败预算，进程中断后的占额最多保留到原窗口结束；不设置跨账号的全局密码限额。

`AccountDatabaseCrypto` 共用实际查询连接检查扩展查询协议、参数日志、数据库审计和加密传输，然后才用 `PreparedStatement` 绑定密码；不走记录绑定值的通用查询助手，不执行任何全局／角色日志修改。运维须对实际应用角色和目标数据库显式配置以下两项，并让连接池重新建立连接；占位符须替换为已核对的标识，不能向应用授予修改日志的权限：

```sql
ALTER ROLE <应用角色> IN DATABASE <目标数据库> SET log_parameter_max_length = 0;
ALTER ROLE <应用角色> IN DATABASE <目标数据库> SET log_parameter_max_length_on_error = 0;
```

若安装数据库审计，`pgaudit.log_parameter` 必须关闭；pgjdbc 的参数跟踪日志也不得启用。数据库和连接均使用 UTF-8，连接必须使用非简单查询模式（建议明确 `preferQueryMode=extended`）。非回环／非本地套接字连接要求 `pg_stat_ssl` 确认加密，部署使用 `sslmode=verify-full` 并配置信任证书以核验服务器身份。缺扩展、协议／日志／传输条件不满足时账号操作失败关闭；组件构造不查询数据库，匿名游戏读取不依赖其密码功能探测。

同一组件以 `gen_random_bytes()` 生成验证器种子、成对的会话／流程与防伪值、整批十份恢复码；数据库只保留既有摘要或受保护的种子密文。账号与流程 UUID、服务器持久化密钥及内网服务凭据的生成规则不变。数据库新安装及旧编码拒绝迁移见[账号数据库说明](../../db/user_manage/README.md)。

在模块目录显式运行下列工具可生成持久化密钥，应用自身绝不自动生成临时替代密钥：

```powershell
mvn -q -DskipTests compile dependency:build-classpath "-Dmdep.outputFile=target/runtime-classpath.txt"
$authRuntime = 'target/classes;' + (Get-Content -Raw target/runtime-classpath.txt).Trim()
java -cp $authRuntime xyz.game.datamanage.support.account.AuthKeyTool ../../config/auth
```

工具拒绝覆盖已有文件并收紧目录／文件权限；只输出目录和公钥元数据路径。`config/auth/` 被仓库忽略，其中 `aead-keyset.json`、`grant-private.pk8` 和 `internal-token.txt` 必须私密保存及备份，不进入日志或版本库。`grant-public.json` 是可分发的 `kid=wasm-1` 公钥元数据；更换公钥编号须同步受信任的 Wasm 构建。缺少私密配置时相关操作失败关闭，公共游戏读取仍然可用。清理构建会删除 `target/runtime-classpath.txt`，需要时重新生成。

## 验证与运维

按改动运行受影响测试，功能收尾执行 `mvn test`；配置、依赖或启动装配变化再执行 `mvn package`。数据库或公共读取变化时，对最终服务核对游戏列表、图片和受影响管理读写，写入另做独立回读，检查引用拒绝及失败事务无部分残留。

数据库访问规则见仓库 `.agents/skills/backend-db-access/SKILL.md`，录入方法见[录入边界](../../文档记录/项目说明/计算范围与录入边界.md)，备用发布见[部署规程](../../文档记录/项目说明/部署操作规程.md)。各层证据分开报告，源码与建表脚本不代替实库核验；历史安装流水与逐对象验证不在本页累积。
