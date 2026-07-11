TASK_KEY: server-wasm-db-gap
DOC_TYPE: 测试记录
WORKSTREAM: server
STATUS: active
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-11

# Wasm Legacy ADC Bootstrap Adapter 验证记录（2026-07-11）

关联详细设计：[WasmLegacyAdcBootstrapAdapter详细设计](../../../详细设计/server/game_manage/WasmLegacyAdcBootstrapAdapter详细设计.md)。

## 1. 验证边界

验证 `POST /api/admin/games/{gameId}/wasm-catalog-source:bootstrap-legacy-adc`：从指定的已发布 Bundle 快照提取固定六名 ADC 与三名训练假人的基础面板，保存为 Wasm Catalog Source 草稿。

本记录不覆盖发布新版本；该接口设计上不创建 `published_wasm_catalog_snapshots`、不切换当前版本、不刷新公共 Catalog 缓存。

## 2. 自动化验证

| 命令 | 结果 |
| --- | --- |
| `cd server/data_manage; mvn test` | 通过：121 tests，0 failures / 0 errors / 0 skipped |
| `cd server/data_manage; mvn package -DskipTests` | 通过 |
| `git diff --check` | 通过 |

覆盖的关键断言包括：六 ADC + 三假人映射、只提取基础数值、DPS 特有技能进入 `unmappedLegacySkillIds`、非 LoL 返回 `422`、已有 Source 返回 `409`、并发冲突不覆盖已有记录、接口不触发发布或缓存失效。

## 3. 开发环境接口与 DB 验证

应用以开发环境配置启动成功后，使用已有 LoL 已发布 Bundle 版本 `v2_batch_b_hero_passives_002` 发起首次录入。

| 检查项 | 结果 |
| --- | --- |
| 首次 `POST /api/admin/games/lol/wasm-catalog-source:bootstrap-legacy-adc` | `200` |
| 已保存 Source 的 `schemaVersion` | `generic-p0` |
| Source templates | 9：`vayne`、`teemo`、`varus`、`kaisa`、`twitch`、`kogmaw` 与三名训练假人 |
| `sharedProviders` / `sharedFormulas` | 均为空 |
| 未映射 legacy hero skill | 9 个，均在响应 `importReport.unmappedLegacySkillIds` 中显式列出 |
| `GET /api/admin/games/lol/wasm-catalog-source` | `200`，可回读上述 9 个模板 |
| 相同请求第二次提交 | `409.CONFLICT`，已有 Source 未被覆盖 |
| `published_wasm_catalog_snapshots` 中 Wasm Catalog 记录 | 0 条 |
| `GET /api/games/lol/versions/v2_batch_b_hero_passives_002/wasm-catalog` | `404`，符合草稿尚未发布的预期 |

## 4. 结论与后续门槛

已有六 ADC 可以录入，但仅落为可编辑的 Canonical Catalog Source 草稿；DPS 被动、触发器和公式没有被伪装转换，仍需后续按 Wasm 语义补录。

若要让前端消费公共 `/wasm-catalog`，需要另行决定目标版本并执行 Source 发布；这会产生已发布快照并可能改变游戏当前版本，因此不属于本次 Bootstrap 的自动动作。
