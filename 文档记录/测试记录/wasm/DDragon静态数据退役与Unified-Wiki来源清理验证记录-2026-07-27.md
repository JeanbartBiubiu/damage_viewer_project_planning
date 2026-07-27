TASK_KEY: wasm-generic-min-validation-coverage-audit
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: pass
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-27

# DDragon 静态数据退役与 Unified Wiki 来源清理验证记录（2026-07-27）

冻结计划：`ddragon-retirement-unified-wiki-inputs-v3`。设计门：`run-fb491ff6-e2c7-4f0b-bfe3-8742979da6dc`（READY，runDeltaCount 0）。本记录仅覆盖本地文件清理 / Unified 来源收口 / Batch-C 自包含 SQL 合同；**不**声称 live migration、Admin publish、push、commit。

## 1. 范围

- 删除已退役 Data Dragon raw/derived 与重建入口。
- Unified 当前 item 溯源仅哈希 Wiki current-items 文档。
- 保留 254 机制键序与分类字段。
- Batch-C JUnit 改为自包含静态 SQL 合同。
- 未触碰仓库内无关 staged / UU·AA 冲突路径。

## 2. 删除确认

以下路径均已不存在：

- `数据参考/item.json`
- `最小验证/数据/item.json`
- `文档记录/详细设计/最小验证/数据/lol_竞技场静态文本快照/`（整树）
- `tools/lol-static-data/fetch-lol-static-data.mjs`
- `tools/lol-static-data/classify-lol-static-data.mjs`
- `tools/lol-static-data/generate-lol-coverage-audit.mjs`
- `最小验证/数据/build-v2-batch-c-adc-items-seed.mjs`
- `最小验证/数据/repair-item-image-keys-from-ddragon.ps1`
- `最小验证/V2-Batch-C-adc-items.seed.json`
- `最小验证/V2-full-item-dps-coverage-20260615.json`
- `最小验证/V2-full-item-dps-coverage-20260615.csv`
- `最小验证/V2-full-item-dps-coverage-summary-20260615.json`

## 3. Generator / check

| 命令 | 结果 |
| --- | --- |
| `node 最小验证/数据/build-wiki-only-mechanism-candidate-registry.mjs --check` | PASS（242；hero165/item77） |
| `node 最小验证/数据/build-v2-batch-g-adc-passive-audit.mjs --check` | PASS |
| `node 最小验证/数据/build-generic-g8-adc-passive-coverage-audit.mjs --check` | PASS |
| regenerate + `node 最小验证/数据/build-unified-mechanism-inventory.mjs --check` | PASS |

## 4. Unified 后置条件

相对实施前 TEMP baseline（非产品文件）键序与 per-key `status` / `completionMode` / `lane` / `blocker` / actionable 派生字段：**全等**。

| 项 | 结果 |
| --- | --- |
| mechanism keys | 254 |
| statusCounts | completed113 / blocked_runtime60 / blocked_data3 / out_of_scope72 / regression_only5 / stale_or_duplicate1 |
| completionModeCounts | full113 / partial3 / none138 |
| actionableKeyCount | 0 |
| sourceCount | 12 = 9 active + 3 generator |
| coverageRecordCount | 8 |
| fullItemContainerCount | 0 |
| coverage kinds | coefficient_bucket6 + data_only_seed1（Batch A）+ legacy_seed_bundle1 |
| Wiki document_json | normalized/manifest 均 `recordCount=0` / `role=document`；SHA 与 revid/timestamp 合同匹配 |
| item3094 | 无 `fullitem_3094_energized_container` alias；无 full-item sourceRef |
| 当前 sources/hashes | 无 full-item / Batch-C 删除路径 |

Wiki contract 实测：normalized SHA256 `17769e0891a0cfc3873abe3d74f1806e8b7a1bc5b21258308c0612121f4b56f4`；manifest `79882fa97b6d79d627dc168444da4df51c1bbff8dfe561fb4cf10669838ae0d7`；revid `4030984`；items.length `333`。

## 5. 删除路径读取扫描

对 `最小验证/数据` 与 `tools` 下可执行生成器扫描（18 文件）：**无活跃 read / ACTIVE_SOURCE 入口**指向已删路径。允许残留仅：Unified 负向守卫字符串（`deletedPathNeedles`）、opaque `item.json#…` 身份键字面量（registry/G8/Unified 共 6 条 collision key 保留）。

## 6. Governance

| 命令 | 结果 |
| --- | --- |
| `node tools/task-governance/cli.mjs check` | PASS（invalid_rules/missing_docs/invalid_headers/unassigned_docs 均为 0） |
| `node tools/agent-governance/cli.mjs check` | 预存 peer drift（3）：planning/backend/web 的 `db/task_doc_governance/task_rules.json` content_drift；**未 sync** |

## 7. Batch-C JUnit

| 命令 | 结果 |
| --- | --- |
| `mvn -Dtest=LolBatchCAdcItemsSeedSqlTest test`（`server/data_manage`） | **BLOCKED**：testCompile 被无关未合并冲突标记打断，未能执行该测试类 |
| 冲突外部路径 | `LolGenericTwitchDeadlyVenomSeedSqlTest.java`（AA）、`LolGenericXayahDeadlyPlumageSeedSqlTest.java`（UU）、`ProviderCombatDataServiceTest.java`（UU） |
| 定向静态断言（修改后的 JUnit + 保留 SQL） | **PASS**：无 `SOURCE_RELATIVE`/JSON oracle；ATTR_ROW 循环内显式 `attrValue != 0` 后再入集；53/53/151/16/53；DELETE 数字 ID = `item_` 剥离后实体集；extend 形状与 SQL-derived `statKeys`/`iconUrl` 一致；代表性 anchors / no-publish 保留 |
| 文档边界校正（review correction） | PhaseA 边界文档 Unified 现为 `9 active + 3 generator = 12 currentInputHashes`；九条 active 含三条 Wiki 文档；Batch-C/full-item 非 active |

测试改为仅读保留 SQL；ATTR_ROW matcher 循环内解析数值并显式断言非零后，再断言 151 unique tuples；53 entity / 53 relation / 151 attr / 16 keys / 53 extend；DELETE 数字 ID 与 `item_` 剥离后实体集相等；不读已删 JSON。未修复无关冲突。

## 8. Git / run-delta 边界

- `git diff --check`（仅三条 allowlist 产品路径）：无 whitespace error。
- 全 worktree `git diff --check`：仍被无关 UU/AA leftover conflict marker 打断（非本计划路径）。
- review correction 产品写入仍仅限三条 allowlist 路径；`runDeltaOutsideScopeCount=0`。
- 未 stage / commit / push。
- 未 live migrate / publish。
- 仓库内既有 UU/AA 冲突路径未处理。

## 9. 明确未执行

- 无 git commit / merge / push / rebase / reset。
- 无 live DB migration / Admin publish / Backend·Web runtime 行为变更。
- 无 peer governance sync / SQLite rebuild / `--fix-headers`。
