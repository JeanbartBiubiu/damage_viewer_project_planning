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

Then read:

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

## db/game_manage Setup Checks

For a full backend game-management schema check, verify parent tables and game partitions instead of assuming the repo SQL already ran.

Relevant SQL files:

- `db\game_manage\schema.sql`
- `db\game_manage\coefficient_bucket_schema.sql`
- `db\game_manage\status_control_schema.sql`
- `db\game_manage\status_resource_schema.sql`
- `db\game_manage\triggers.sql`
- `db\game_manage\lol_status_action_control_partitions.sql`

Useful checks:

- parent table exists: `select to_regclass('public.<table_name>')`
- partition exists: `select to_regclass('public.<parent>_lol')`
- partition attachment: inspect `pg_inherits` for parent/child relations
- create missing game partitions: `select public.ensure_game_partitions('lol')`

If direct DDL execution is allowed by the user, run transformed idempotent SQL files, then call `public.ensure_game_partitions('lol')`, then re-check all expected parent tables and `lol` partitions.

## Known Drift To Check First

Older live databases may miss columns that current backend mappers expect. Before rerunning broad DDL, check these compatibility columns:

```sql
alter table public.type_relations add column if not exists deleted boolean not null default false;
alter table public.type_relations_log add column if not exists deleted boolean not null default false;
```

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
