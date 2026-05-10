TASK_KEY: server-katarina-import-runbook
DOC_TYPE: 详细设计
WORKSTREAM: server
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-04-30

# Katarina MVP Import Runbook

## Goal

Import [`最小验证/卡特琳娜-MVP种子数据.json`](../../../最小验证/卡特琳娜-MVP种子数据.json) into a real `gameId`
through admin HTTP APIs, then optionally publish `mvp_katarina_001`.

Tool entry:

- `xyz.game.datamanage.tools.KatarinaMvpImportMain`

## Imported By Admin APIs

- `attributeDefinitions`
- `heroes`
- `skills`
- `items`

Notes:

- `ownerCategories` are checked by the tool and can be bootstrapped through DB with `--bootstrapDb`
- `scenarios` are intentionally not imported because they are web/runtime inputs, not current server entities
- If backend auth is disabled with `app.auth.jwt.disabled=true`, `DV_ADMIN_JWT` is optional

## Prerequisites

1. Start `server/data_manage`
2. If backend auth is enabled, export an admin JWT

```powershell
$env:DV_ADMIN_JWT = "<jwt without the Bearer prefix>"
```

3. If you want the tool to bootstrap `public.games`, `public.owner_categories`, and game partitions, enable the backend auth switch:

```powershell
$env:APP_AUTH_JWT_DISABLED = "true"
```

4. If `lol` or `owner_categories` may be missing, also export DB env vars for bootstrap:

```powershell
$env:IT_DB_URL = "<jdbc-url-for-your-local-test-db>"
$env:IT_DB_USERNAME = "<db-username>"
$env:IT_DB_PASSWORD = "<已移除>"
```

5. The target DB must already have the schema v2 columns used by the current backend, especially `public.attribute_definitions.value_kind` and `public.attribute_definitions.rate_target_attr_key` plus the same columns on `public.attribute_definitions_log`.

## Dry Run

```powershell
cd server/data_manage
mvn -DskipTests test-compile `
  org.codehaus.mojo:exec-maven-plugin:3.5.0:java `
  "-Dexec.classpathScope=test" `
  "-Dexec.mainClass=xyz.game.datamanage.tools.KatarinaMvpImportMain" `
  "-Dexec.args=--dryRun --bootstrapDb"
```

## Import + Publish

```powershell
cd server/data_manage
mvn -DskipTests test-compile `
  org.codehaus.mojo:exec-maven-plugin:3.5.0:java `
  "-Dexec.classpathScope=test" `
  "-Dexec.mainClass=xyz.game.datamanage.tools.KatarinaMvpImportMain" `
  "-Dexec.args=--bootstrapDb"
```

Default behavior:

- `apiBaseUrl = http://localhost:8080`
- seed file = repository default `最小验证/卡特琳娜-MVP种子数据.json`
- `gameId = lol`
- `versionCode = mvp_katarina_001`
- publish after import
- no JWT is required when `APP_AUTH_JWT_DISABLED=true`

## Useful Overrides

Skip publish:

```powershell
-Dexec.args="--bootstrapDb --skipPublish"
```

Use a different API base URL:

```powershell
-Dexec.args="--apiBaseUrl=http://localhost:18080 --bootstrapDb"
```

Use an explicit seed file:

```powershell
-Dexec.args="--seedFile=C:\\project\\damage_viewer_project_planning\\最小验证\\卡特琳娜-MVP种子数据.json --bootstrapDb"
```

## Verification

After publish, the tool also verifies:

- `GET /api/games/{gameId}/versions/current`
- `GET /api/games/{gameId}/versions/{versionCode}/bundle`

It checks:

- `current.versionCode`
- `bundle.meta.versionCode`
- entity counts for attributes / heroes / skills / items
