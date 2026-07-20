TASK_KEY: wasm-generic-min-validation-coverage-audit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-20

# Wiki-only 候选注册表与 Unified 显式来源白名单设计

关联验证记录：[Wiki-only 候选注册表与 Unified 显式来源白名单验证记录](../../测试记录/wasm/Wiki-only候选注册表与Unified显式来源白名单验证记录-2026-07-20.md)。冻结计划修订：`wiki-only-candidate-registry-source-allowlist-v3`。本设计描述已落地的来源治理；**不**宣称下一机制 runtime 闭环或 live migrate/publish。

## 1. 目的与非目标

### 1.1 目的

- 去掉 242 候选 Batch-G/G8 家族对已删 Data Dragon / OCR / 本地 `item.json` 活跃读取的依赖。
- 以 Wiki-only routing manifest + 候选注册表作为 G8 的 canonical 输入。
- 将 Unified 的目录/正则来源发现替换为显式 allowlist（active + generator hashes + historical refs + 静态 seed attachments）。
- 保持相对 commit `1c0b2c9` 的分类/键集零漂移：G8 242 + Unified 254。

### 1.2 非目标

- 不实现新机制 runtime / Backend seed / Web UI。
- 不重分类 242/254；不把 Batch-G 历史桶改写成 G8 桶。
- 不执行 live migration、Admin publish、merge、push。
- 不改写 Planning worktree；不新增独立 task_key（挂靠既有 `wasm-generic-min-validation-coverage-audit`）。

## 2. 来源分层

| 层 | 角色 | 路径 / 备注 |
| --- | --- | --- |
| Wiki 数值真源 | 英雄 identity/generic + items manifest/normalized | `数据参考/lol-wiki-current-champions/**`、`数据参考/lol-wiki-current-items/**`（items revid `4030984` / SHA256 `e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d`） |
| Routing | 身份与审计路由 only；**不是**数值真源 | `数据参考/lol-wiki-mechanism-candidates/routing-manifest.json`（242） |
| Registry | Canonical 候选池 + Wiki 文本/引用 + `auditBaseline` | `最小验证/wiki-only-mechanism-candidate-registry.json` |
| Batch-G | 兼容投影；非 G8 canonical | `最小验证/V2-Batch-G-adc-passive-audit.json` |
| G8 | 覆盖审计；读注册表 | `最小验证/generic-g8-adc-passive-coverage-audit.json` |
| Unified | 统一清单；显式 allowlist | `最小验证/unified-mechanism-inventory.json` |

## 3. Routing manifest vs Wiki 真源边界

- Routing purpose：`identity_and_audit_routing_only_not_numeric_truth`。
- 计数：242 entries；`hero_skill` 165 / `item_passive` 77；53 item owners。
- 每条携带稳定 `candidateKey`、`inventoryOrdinal`、`auditBaseline`（含 `resolvedBucket`；OOS 行含结构化 `outOfScope`）。
- 英雄：经 identity-manifest 绑定 `pageId`，数值来自 Wiki generic/reviewed snapshots。
- 装备：每条显式 `wikiItemId` + `wikiEffectSlots`；**禁止**按效果槽数量或数组位置推断候选。
- Wiki `sourceText` / `sourceRef`：display 与 provenance；**不得**驱动 genericClassification / OOS 中文词面校验。

## 4. Item 显式路由与 opaque collision keys

- 全部 77 条 item 候选均有显式槽位路由（`wikiEffectSlots`）。
- 六条历史 collision `candidateKey` 保留 opaque 身份（字面量仍含 `数据参考/item.json#data.*|{hash8}`），但 **不再**从 `item.json` 读取或重算：

| opaque candidateKey（身份保留） | Wiki 槽 |
| --- | --- |
| `item_passive\|3748\|item_passive\|顺劈\|…\|71fa0f0c` | `pass`（Cleave） |
| `item_passive\|3748\|item_passive\|顺劈\|…\|020f8b5a` | `pass`（Cleave；非 `act=Titanic Crescent`） |
| `item_passive\|6333\|item_passive\|无视痛苦\|…\|668e55b0` | `pass` |
| `item_passive\|6333\|item_passive\|无视痛苦\|…\|52e96cc8` | `pass2` |
| `item_passive\|6695\|item_passive\|掠盾者\|…\|2892fed0` | `pass` |
| `item_passive\|6695\|item_passive\|掠盾者\|…\|7bcc8c31` | `pass` |

禁止对整份产物做“含 `item.json` 即失败”的盲扫，以免误伤这六条 opaque 身份。

## 5. 数据流（Registry → Batch-G / G8 / Unified）

```text
Wiki champions/items + routing-manifest
        │
        ▼
wiki-only-mechanism-candidate-registry  ◄── canonical for G8
        │
        ├──► Batch-G compatibility projection（历史文件名/schema；非 G8 输入）
        │
        ├──► G8 coverage audit（explicit candidateKey + auditBaseline fallback/OOS）
        │
        └──► Unified inventory
                 • primary: 242× G8 + 242× registry
                 • Batch-G primary: 0
                 • 唯一历史 Batch-G alias: batch_g_terminus_shadow_stale_ready
```

### 5.1 Batch-G（兼容 only）

- 生成器只读注册表；输出保留历史 classification 桶：22 already / 31 runtime / 1 ready / 43 manual / 145 OOS。
- `projection.canonicalInput=false`；G8 **不得**再以其为输入。

### 5.2 G8

- 输入：`最小验证/wiki-only-mechanism-candidate-registry.json`。
- 使用显式 `candidateKey`；fallback/OOS 走结构化 `auditBaseline`（`resolvedBucket` / tags / gaps / `outOfScope`）。
- 相对 `1c0b2c9`：242 key set 与 per-key `genericClassification` 零漂移；计数 48 migrated / 5 partial / 120 blocked / 69 OOS。

### 5.3 Unified

- Active 输入 8 + generator hashes 3 → `sources` / `currentInputHashes` 共 11；历史路径仅进非哈希 allowlist。
- Seed attachments 为静态表，**不**目录扫描 `*.seed.json`。
- 相对 `1c0b2c9`：254 keys 与每键 `status` / `completionMode` / `lane` 零漂移。
- 计数：completed 56 / blocked_runtime 117 / blocked_data 3 / OOS 72 / regression 5 / stale 1；full 56 / partial 5 / none 193；`actionableKeyCount=0`。

## 6. OOS 结构化语义

- OOS 形状来自 baseline / G8 结构化证据（`boundaryCategory`、`excludedBehavior`、`boundaryReason`、`damageRelevantSubBranchDisposition` 等）。
- Wiki 源文仅为 display/provenance；已移除依赖中文关键词的 OOS 校验门。
- Unified 传播 OOS 时复制结构化字段，不从英文 Wiki 散文合成中文摘要门。

## 7. Allowlist 角色

| Allowlist | 进入 `currentInputHashes`？ | 作用 |
| --- | --- | --- |
| `ACTIVE_SOURCE_ALLOWLIST`（8） | 是 | 当前解析/哈希的覆盖与种子输入（含 registry + G8） |
| `GENERATOR_SOURCE_ALLOWLIST`（3） | 是 | registry / G8 / Unified 生成器自身哈希 |
| `HISTORICAL_SOURCE_REF_ALLOWLIST` | 否 | sourceRefs/alias 允许的历史路径（含 Batch-G 文件作 `historical_reference`） |
| `SEED_REFERENCE_ATTACHMENTS` | 否（不读不哈希） | 按 mechanismKey 静态挂 seed 引用 |

缺项 fail-closed；非白名单路径不得出现在 `sources` / hashes / sourceRefs。

## 8. 不变量

1. Routing / registry / G8 候选键集均为 242，且与 `1c0b2c9` G8 key set 一致。
2. G8 per-key `genericClassification` 与 Unified 254 键的 status/completionMode/lane 相对 `1c0b2c9` 零漂移。
3. Unified：242 G8 primary + 242 registry primary；0 Batch-G primary；至多保留显式历史 alias `batch_g_terminus_shadow_stale_ready`。
4. `currentInputHashes` 路径集合 = active ∪ generator（11）；Batch-G 不在其中。
5. Item 路由显式；六 opaque keys 不重算。
6. 无 live migrate / publish / merge / push。

## 9. 停止与回滚边界

- **停止**：来源治理目标已完成；后续机制选择继续从 blocked families / 人工优先序推进，`actionableKeyCount=0` **不是**停工条件。
- **回滚**：恢复 v3 实施前的生成器与 JSON/CSV；不得半套用（例如 G8 已读注册表但 Unified 仍目录发现）。
- **越界即停**：runtime / Backend / Web / Planning / 新 task_key / 提交推送。

## 10. 相关产物

| 产物 | 路径 |
| --- | --- |
| Phase-A 真源边界（已刷新） | `文档记录/详细设计/wasm/Wiki冠军数值真源与PhaseA边界-2026-07-19.md` |
| 验证记录 | `文档记录/测试记录/wasm/Wiki-only候选注册表与Unified显式来源白名单验证记录-2026-07-20.md` |
| 阻塞汇总 | `文档记录/测试记录/wasm/最小验证剩余阻塞项汇总-2026-07-19.md` |
