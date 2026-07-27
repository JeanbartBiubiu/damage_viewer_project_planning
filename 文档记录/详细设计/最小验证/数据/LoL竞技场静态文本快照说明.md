TASK_KEY: wasm-min-validation-data-spec
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-27

# LoL 竞技场静态文本快照 — 退役墓碑说明

## 目的

本文档是原 Data Dragon / CommunityDragon「竞技场静态文本快照」工作流的**退役 / tombstone** 记录。该快照树及其抓取 / 分类入口已删除，不得再作为机制数值真源或 Unified 当前输入。

## 已移除范围

已删除：

- `文档记录/详细设计/最小验证/数据/lol_竞技场静态文本快照/`（整树，含 ddragon / communitydragon 原始快照与分类汇总索引）
- `tools/lol-static-data/fetch-lol-static-data.mjs`
- `tools/lol-static-data/classify-lol-static-data.mjs`
- `tools/lol-static-data/generate-lol-coverage-audit.mjs`
- 本地 Data Dragon item 文件：`数据参考/item.json`、`最小验证/数据/item.json`
- full-item DPS 覆盖审计与 Batch-C JSON 种子：`最小验证/V2-full-item-dps-coverage-20260615.{json,csv}`、`最小验证/V2-full-item-dps-coverage-summary-20260615.json`、`最小验证/V2-Batch-C-adc-items.seed.json`
- 相关重建入口：`最小验证/数据/build-v2-batch-c-adc-items-seed.mjs`、`最小验证/数据/repair-item-image-keys-from-ddragon.ps1`

不得再执行上述脚本，也不得把已删路径写回 `sources` / `currentInputHashes`。

## Wiki 替代真源

| 角色 | 路径 |
| --- | --- |
| 装备当前文档 | `数据参考/lol-wiki-current-items/current-items.normalized.json` |
| 装备 manifest | `数据参考/lol-wiki-current-items/manifest.json`（revid `4030984`） |
| 英雄技能 | `数据参考/lol-wiki-current-champions/**` |
| 候选注册表 | `最小验证/wiki-only-mechanism-candidate-registry.json` |

Unified 当前 item 溯源哈希仅包含上述 Wiki current-items 文档（`document_json`，`recordCount=0`），不再解析 full-item 容器或 Batch-C JSON。

## Opaque key 例外

六条历史 collision `candidateKey` 字面量中含 `数据参考/item.json#…` 的片段必须**按字节保留**为身份键；它们不是活跃读取路径，也不是 Data Dragon 复原入口。

## 历史 / runtime 证据边界

- Backend SQL seed（含 `lol_batch_c_adc_items_seed.sql`）中的 `"source":"数据参考/item.json"` 等字段是**保留的历史 provenance 元数据**，不是活跃 Data Dragon 读取。
- Batch-C JUnit 现为自包含静态 SQL 合同；不以已删 JSON 为 oracle。
- 负向守卫文案（如 `ddragonProvenanceOnly`）与历史文档提及可保留；不得据此重建已删输入。
- 本退役不改变 Backend/Web runtime 行为，不执行 live migration / Admin publish。
