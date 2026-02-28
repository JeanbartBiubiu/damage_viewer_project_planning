# P1 Controller-Only 真实 DB 集成测试 Runbook

## 1. 前置条件
- 固定测试库已部署：
  - `db/game_manage/schema.sql`
  - `db/game_manage/triggers.sql`
- 该库仅用于测试，不可指向开发/生产库。

## 2. 环境变量（PowerShell）
```powershell
$env:IT_DB_URL = "jdbc:postgresql://127.0.0.1:5432/damage_viewer_it"
$env:IT_DB_USERNAME = "postgres"
$env:IT_DB_PASSWORD = "postgres"
```

说明：`ControllerPublishFlowIT` 会在测试类内部动态生成 ES256 密钥对并注入公钥配置，
无需额外设置 JWT secret 或公钥环境变量。

## 3. 手动执行 Controller 集成测试
```powershell
cd server/data_manage
mvn -Dtest=ControllerPublishFlowIT test
```

- 测试会在前置阶段创建新 `gameId`（`it_yyyyMMddHHmmss_4位随机`）。
- 默认不自动清理该 `gameId` 数据，便于人工验数。

## 4. 独立执行分区清理
- 必须提供 `--confirm=DROP_<gameId>`，否则拒绝执行。

### 4.1 Dry Run（推荐先执行）
```powershell
cd server/data_manage
mvn -DskipTests test-compile `
  org.codehaus.mojo:exec-maven-plugin:3.5.0:java `
  "-Dexec.classpathScope=test" `
  "-Dexec.mainClass=xyz.game.datamanage.tools.GamePartitionCleanupMain" `
  "-Dexec.args=--gameId=it_20260226_1234 --confirm=DROP_it_20260226_1234 --dryRun"
```

### 4.2 实际清理
```powershell
cd server/data_manage
mvn -DskipTests test-compile `
  org.codehaus.mojo:exec-maven-plugin:3.5.0:java `
  "-Dexec.classpathScope=test" `
  "-Dexec.mainClass=xyz.game.datamanage.tools.GamePartitionCleanupMain" `
  "-Dexec.args=--gameId=it_20260226_1234 --confirm=DROP_it_20260226_1234"
```

## 5. 风险提示
- 清理动作不可逆，会删除对应 `gameId` 的分区表与 `games/game_versions/owner_categories` 数据。
- 仅允许在测试库执行；执行前务必核对 `IT_DB_URL`。
- 建议流程：
  1. 跑 IT 测试并记录 `gameId`
  2. 人工验数
  3. 先 `--dryRun`，再执行真实清理

## 6. Skip detection (important)
- `ControllerPublishFlowIT` uses `@EnabledIfEnvironmentVariable` gates.
- If Maven output shows `Tests run: 3, Skipped: 3`, this means required env vars are missing and tests did not execute.
- Required env vars: `IT_DB_URL`, `IT_DB_USERNAME`.
- A skipped run is NOT a pass. Re-run after exporting env vars in section 2.
