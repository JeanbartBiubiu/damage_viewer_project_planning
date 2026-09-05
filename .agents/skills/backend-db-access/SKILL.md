---
name: backend-db-access
description: Use when Codex needs to inspect or modify the Damage Viewer backend PostgreSQL database from c:\project\damage_backend_dev, verify db/game_manage DDL, create/check game partitions such as lol, or run controlled DB queries through the repo's JDBC/jshell path when psql is unavailable.
---

# Backend DB Access

Use this skill when the task requires live PostgreSQL access for the backend repo, especially schema checks, partition checks, controlled DDL, or data repair.

## Scope

- repo root: `c:\project\damage_backend_dev`
- backend module: `server\data_manage`
- SQL root: `db\game_manage`
- default datasource config: `server\data_manage\src\main\resources\application.yml`
- preferred access path when `psql` is missing: Maven runtime classpath plus `jshell` JDBC

## Guardrails

- Read the nearest applicable `AGENTS.md` before changing backend code, SQL, or docs.
- Never print database passwords, API keys, tokens, cookies, or full config files in chat or committed files.
- Report the DB target as host/database/user only when useful; redact credentials.
- Treat live DB schema drift as real. Verify current schema before broad DDL.
- Prefer idempotent DDL for repeated setup work: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
- Do not hand-edit generated governance SQLite files. `tools\task-governance` is separate from live PostgreSQL access.

## Build The JDBC Classpath

Run from `server\data_manage`:

```powershell
mvn -q -DincludeScope=runtime "-Dmdep.outputFile=target\codex-runtime-classpath.txt" dependency:build-classpath
```

Then return to the repository root and read:

```powershell
$cp = Get-Content -Raw server\data_manage\target\codex-runtime-classpath.txt
```

If Maven dependencies are already present, this is usually enough for `org.postgresql.Driver`.

## JShell JDBC Pattern

Run from the repo root unless noted. Use `application.yml` only as the default source of `spring.datasource` values. Environment or profile overrides may exist, so confirm the target when the exact DB matters. Do not echo passwords.

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

Set `CODEX_DB_URL`, `CODEX_DB_USER`, and `CODEX_DB_PASSWORD` only when intentionally overriding the checked-in default datasource in the same PowerShell process. Do not paste resolved secrets into the final answer.

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

## Reporting

In the final response, include:

- whether live DB access succeeded
- the database target, with credentials redacted
- missing parent tables or partitions before and after, if checked
- DDL files or explicit statements executed, if any
- verification commands or endpoints checked, if any

Keep command output concise; do not dump full query results unless the user asks for raw output.

## Task Governance Note

For local task/doc governance, use `tools\task-governance` instead of this skill:

```powershell
node tools\task-governance\cli.mjs rebuild
node tools\task-governance\cli.mjs tasks
node tools\task-governance\cli.mjs docs <task_key>
```

If `sql.js` is missing, install dependencies under `tools\task-governance` before rerunning the CLI.
