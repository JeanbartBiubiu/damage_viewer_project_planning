---
name: backend-db-access
description: "读取或变更 Damage Viewer 后端 PostgreSQL 实库、核对结构或游戏图片分区时使用；静态 SQL 审查不使用。"
---

# 后端数据库访问

本技能处理后端 PostgreSQL 实库的结构核对、分区检查、已授权 DDL 和数据修复。仓库 SQL 的静态审查不等于实库访问。

## 范围

- repo root: `c:\project\damage_backend_dev`
- backend module: `server\data_manage`
- SQL root: `db\game_manage`
- default datasource config: `server\data_manage\src\main\resources\application.yml`
- preferred access path when `psql` is missing: Maven runtime classpath plus `jshell` JDBC

## 安全边界

- 修改后端代码、SQL 或文档前读取最近的 `AGENTS.md`。
- 不在聊天、提交文件或日志中打印数据库密码、API key、令牌、Cookie 或完整配置；需要说明目标时只给主机、数据库和用户并隐藏凭据。
- 实库可能与仓库定义漂移。执行范围较大的 DDL 前先读实际表、列、约束和分区；重复初始化优先使用幂等语句。
- 真实数据删除或修复前核对数据库目标、影响行和用户授权。任务文档治理 SQLite 不属于本技能。

## 构建 JDBC 类路径

在 `server\data_manage` 执行：

```powershell
mvn -q -DincludeScope=runtime "-Dmdep.outputFile=target\codex-runtime-classpath.txt" dependency:build-classpath
```

回到仓库根目录读取：

```powershell
$cp = Get-Content -Raw server\data_manage\target\codex-runtime-classpath.txt
```

已有 Maven 依赖时即可加载 `org.postgresql.Driver`。

## JShell JDBC 模板

除特别说明外在仓库根目录执行。`application.yml` 只提供 `spring.datasource` 默认值；环境变量和运行配置可能覆盖它，目标库重要时应先确认。不要回显密码。

```powershell
$cp = Get-Content -Raw server\data_manage\target\codex-runtime-classpath.txt
$script = @'
import java.sql.*;
import java.nio.file.*;
import java.util.*;
import org.yaml.snakeyaml.Yaml;

Class.forName("org.postgresql.Driver");
Map<?,?> root = new Yaml().load(Files.newInputStream(Path.of("server/data_manage/src/main/resources/application.yml")));
Map<?,?> spring = (Map<?,?>) root.get("spring");
Map<?,?> ds = (Map<?,?>) spring.get("datasource");
String url = Optional.ofNullable(System.getenv("CODEX_DB_URL")).orElse(String.valueOf(ds.get("url")));
String user = Optional.ofNullable(System.getenv("CODEX_DB_USER")).orElse(String.valueOf(ds.get("username")));
String pass = Optional.ofNullable(System.getenv("CODEX_DB_PASSWORD")).orElse(String.valueOf(ds.get("password")));

try (Connection c = DriverManager.getConnection(url, user, pass)) {
  try (PreparedStatement ps = c.prepareStatement("select current_database(), current_user")) {
    try (ResultSet rs = ps.executeQuery()) {
      while (rs.next()) {
        System.out.println(rs.getString(1) + " / " + rs.getString(2));
      }
    }
  }
}
/exit
'@
$script | jshell -q --class-path "$cp"
```

只有明确要覆盖仓库默认数据源时，才在同一 PowerShell 进程设置 `CODEX_DB_URL`、`CODEX_DB_USER` 和 `CODEX_DB_PASSWORD`。最终回复不得包含解析后的密钥。

## 当前初始化与结构核对

先读后端工作树 `server/data_manage/README.md` 的 SQL 初始化及目标功能迁移小节，核对文件存在。仓库 SQL 只证明定义存在，不能证明目标数据库已经执行。

新库入口仅按顺序使用：

1. `db/game_manage/schema.sql`
2. `db/game_manage/triggers.sql`

当前没有新库必跑的业务种子；`migrations/**` 不是新库初始化步骤。不要恢复旧战斗数据模型或不存在的种子文件。

已有库先检查实际表、列、约束和数据，再按目标功能的后端 README 选择存在的迁移文件；不批量运行迁移目录，也不把 `CREATE TABLE IF NOT EXISTS` 当作列和约束升级器。当前 MVP 不要求额外开发旧模型兼容层。清理真实旧数据前确认数据库目标、待删范围和用户授权；文档检查不授权执行数据库变更。

可用的只读检查：

- 目标数据库与用户：`select current_database(), current_user`
- 表存在性：`select to_regclass('public.<table_name>')`
- 列、约束：`information_schema.columns`、`pg_constraint`
- 分区挂接：`pg_inherits`

分区父表清单以当前 `triggers.sql` 的 `ensure_game_partitions` 为准；目前只有 `images`，普通管理表不是按游戏分区。只读查询不调用创建函数。只有任务已授权创建目标游戏图片分区时，才调用 `select public.ensure_game_partitions('lol')` 并读回 `images_lol` 的挂接；实际游戏键以任务为准。

执行初始化或迁移后，以目标库读回结果验证，不以脚本退出成功或静态测试替代真实结构证据。

## 交付

说明实库访问是否成功、已隐藏凭据的目标库、检查前后的缺失表或分区、实际执行的 DDL 文件或语句，以及读回验证。除非用户要求原始数据，不转储完整查询结果。
