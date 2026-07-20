TASK_KEY: wasm-generic-min-validation-coverage-audit
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: pass
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-20

# Wiki-only 候选注册表与 Unified 显式来源白名单验证记录（2026-07-20）

详细设计：[Wiki-only 候选注册表与 Unified 显式来源白名单设计](../../详细设计/wasm/Wiki-only候选注册表与Unified显式来源白名单设计.md)。冻结计划修订：`wiki-only-candidate-registry-source-allowlist-v3`。本记录覆盖设计审查与 Run 1/2 实施验证；**不**声称 commit、push 或 live migrate/publish。

## 1. 范围

已完成跨切面来源治理：Wiki-only routing/registry → Batch-G 兼容投影 → G8 直读注册表 → Unified 显式 allowlist + 结构化 OOS。分类相对 `1c0b2c9` 零漂移。未改 runtime / Backend / Web / Planning；未执行 live 发布。

## 2. Design review

| 修订 | 裁决 | 说明 |
| --- | --- | --- |
| v1 | **REVISE** | 路由/allowlist 主架构与仓库事实基本一致；需修正 item 槽位推断、G8 分类仍依赖 Wiki 文本、Unified 目录发现等问题 |
| v2 | **REVISE** | v1 blocker 处置已 ACCEPT；英文 Wiki 证据与既有中文 OOS 词面校验门冲突等仍阻塞 |
| v3 | **READY** | 结构化 `auditBaseline`、显式 item 槽、opaque key 保护、Unified exact allowlist；无 correctness blocker |

| 项 | 结果 |
| --- | --- |
| READY run id | `run-2a2da914-4fc1-4532-b310-19906c9c8fc8` |
| run delta | **0** |
| 事件日志 | 完整 |
| mutation | DESIGN_REVIEW_ONLY；无文件创建/编辑/删除 |

## 3. Implementation runs

| Run | run id | 结果 | 范围摘要 |
| --- | --- | --- | --- |
| Run 1 | `run-25726e3f-0dc3-4089-8ecc-c4b7e3ceda47` | 成功 | registry 构建、Batch-G 兼容投影、G8 改读注册表并再生 |
| Run 2（首次） | （SDK） | **CANCEL** | 零 delta；未落盘成功实施 |
| Run 2（重试） | `run-8b1e8408-1fa7-4ba5-b951-e857a1283ad1` | 成功 | Unified exact allowlist、registry primary、结构化 OOS；allowlist 外 run-delta **0** |
| Run 3 | 本记录所属文档/治理映射 | 文档 only | 不改生成器或 JSON/CSV 产物 |

## 4. Generator / check

| 命令 | 结果 |
| --- | --- |
| `node 最小验证/数据/build-wiki-only-mechanism-candidate-registry.mjs` + `--check` | PASS（Run 1） |
| `node 最小验证/数据/build-v2-batch-g-adc-passive-audit.mjs` + `--check` | PASS（兼容投影） |
| `node 最小验证/数据/build-generic-g8-adc-passive-coverage-audit.mjs` + `--check` | PASS |
| `node 最小验证/数据/build-unified-mechanism-inventory.mjs` + `--check` | PASS（Run 2） |

本 Run 3 **不**重建上述产物。

## 5. Baseline parity（相对 `1c0b2c9`）

### 5.1 Routing / registry

- Routing：242；hero 165 / item 77；53 item owners；每条 item 显式槽位路由；六 collision `candidateKey` 保持 opaque 身份。
- Registry 读取 Wiki hero identity/generic 与 current-items revid `4030984` / SHA256 `e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d`。

### 5.2 Batch-G（兼容投影）

- 历史桶：22 already / 31 runtime / 1 ready / 43 manual / 145 OOS。
- `canonicalInput=false`；**不是** G8 canonical 输入。

### 5.3 G8

- 242 key set 与 per-key `genericClassification`：**零漂移**。
- 计数：48 migrated / 5 partial / 120 blocked / 69 OOS。
- OOS：结构化 baseline/G8 证据；Wiki 文本不驱动分类或中文词面校验。

### 5.4 Unified

- 254 keys；每键 `status` / `completionMode` / `lane`：**零漂移**。
- 计数：completed 56 / blocked_runtime 117 / blocked_data 3 / OOS 72 / regression 5 / stale 1；full 56 / partial 5 / none 193；`actionableKeyCount=0`。
- 来源策略：8 active + 3 generator hashes = 11 `currentInputHashes`；历史 refs 显式非哈希 allowlist；seed attachments 静态表。
- Primary refs：242 G8 + 242 registry + **0** Batch-G；唯一历史 Batch-G alias：`batch_g_terminus_shadow_stale_ready`。

## 6. 明确未执行

- 无 git commit / merge / push。
- 无 live DB migration / Admin publish / 浏览器 live E2E。
- 无 runtime / Backend / Web / Planning 代码变更（本治理轮次）。

## 7. 残余边界

来源治理 blocker 已关闭。`actionableKeyCount=0` 表示当前无自动 ready 键，**不是**总体 Goal 完成或停工条件；下一机制仍从 blocked families / 人工优先序选择。详见阻塞汇总中的当前来源治理节。
