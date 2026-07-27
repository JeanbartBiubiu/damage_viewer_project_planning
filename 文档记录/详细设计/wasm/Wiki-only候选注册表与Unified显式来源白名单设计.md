TASK_KEY: wasm-generic-min-validation-coverage-audit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-21

# Wiki-only 候选注册表与 Unified 显式来源白名单设计

关联验证记录：[Wiki-only 候选注册表与 Unified 显式来源白名单验证记录](../../测试记录/wasm/Wiki-only候选注册表与Unified显式来源白名单验证记录-2026-07-20.md)。冻结计划修订：`wiki-only-candidate-registry-source-allowlist-v3`。本设计描述已落地的来源治理；**不**宣称下一机制 runtime 闭环或 live migrate/publish。

## 1. 目的与非目标

### 1.1 目的

- 去掉 242 候选 Batch-G/G8 家族对已删 Data Dragon / OCR / 本地 `item.json` 活跃读取的依赖。
- 以 Wiki-only routing manifest + 候选注册表作为 G8 的 canonical 输入。
- 将 Unified 的目录/正则来源发现替换为显式 allowlist（active + generator hashes + historical refs + 静态 seed attachments）。
- 保持相对 commit `1c0b2c9` 的 **键集/路由** 零漂移：G8 242 + Unified 254；此后 disposition 变化为有意机制闭环，不是来源路由漂移。

### 1.2 非目标

- 不实现新机制 runtime / Backend seed / Web UI。
- 不重分类 242/254 键集；不把 Batch-G 历史桶改写成 G8 桶。
- 不执行 live migration、Admin publish、merge、push。
- 不改写 Planning worktree；不新增独立 task_key（挂靠既有 `wasm-generic-min-validation-coverage-audit`）。

## 2. 来源分层

| 层 | 角色 | 路径 / 备注 |
| --- | --- | --- |
| Wiki 数值真源 | 英雄 identity/generic + items manifest/normalized | `数据参考/lol-wiki-current-champions/**`、`数据参考/lol-wiki-current-items/**`（items revid `4030984` / SHA256 `e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d`） |
| EXTRA sidecar | 非 registry 英雄机制的 provenance-only Wiki 捕获 | `数据参考/lol-wiki-extra-mechanisms/normalized/generic/malzahar-e.json`（`document_json`；不进入 165 identity / registry / G8） |
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
- EXTRA sidecar（如 Malzahar E）**不**扩大 165 英雄 identity、registry 或 G8 候选池；仅作 Unified provenance。

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
                 • EXTRA sidecar: provenance-only document_json（recordCount0）
                 • 唯一历史 Batch-G alias: batch_g_terminus_shadow_stale_ready
```

### 5.1 Batch-G（兼容 only）

- 生成器只读注册表；输出保留历史 classification 桶：22 already / 31 runtime / 1 ready / 43 manual / 145 OOS。
- `projection.canonicalInput=false`；G8 **不得**再以其为输入。Batch-G **仍不在** `currentInputHashes`。

### 5.2 G8

- 输入：`最小验证/wiki-only-mechanism-candidate-registry.json`。
- 使用显式 `candidateKey`；fallback/OOS 走结构化 `auditBaseline`（`resolvedBucket` / tags / gaps / `outOfScope`）。
- 键集相对 `1c0b2c9` 零漂移（242）；当前分类 50 migrated / 4 partial / 119 blocked / 69 OOS（相对来源治理迁移后的有意机制闭环；**不是**路由重算）。
- Malzahar E 等 EXTRA 机制 **不**进入 G8。

### 5.3 Unified

- Active 输入 9 + generator hashes 3 → `sources` / `currentInputHashes` 共 12；**无**目录发现。
- Active `document_json`（均为 hashed/parsed/validated；`recordCount=0`；零 coverage records）：
  - EXTRA sidecar `数据参考/lol-wiki-extra-mechanisms/normalized/generic/malzahar-e.json`
  - Wiki current-items `数据参考/lol-wiki-current-items/current-items.normalized.json`
  - Wiki current-items `数据参考/lol-wiki-current-items/manifest.json`
- **已退役**：full-item DPS coverage JSON 与 Batch-C ADC items seed JSON 不再进入 ACTIVE_SOURCE / coverage。
- Coverage 角色计数：`coverageRecordCount=8` = `coefficient_bucket` 6 + `data_only_seed` 1（Batch A）+ `legacy_seed_bundle` 1；`fullItemContainerCount=0`。
- Seed attachments 为静态表，**不**目录扫描 `*.seed.json`。
- 键集相对 `1c0b2c9` 仍为 254；相对来源治理迁移后的 disposition 变化为有意机制闭环，不是 source-routing drift。
- **当前计数**：completed 60 / blocked_runtime 113 / blocked_data 3 / OOS 72 / regression 5 / stale 1；full 60 / partial 3 / none 191；`actionableKeyCount=0`。

## 6. OOS 结构化语义

- OOS 形状来自 baseline / G8 结构化证据（`boundaryCategory`、`excludedBehavior`、`boundaryReason`、`damageRelevantSubBranchDisposition` 等）。
- Wiki 源文仅为 display/provenance；已移除依赖中文关键词的 OOS 校验门。
- Unified 传播 OOS 时复制结构化字段，不从英文 Wiki 散文合成中文摘要门。

## 7. Allowlist 角色

| Allowlist | 进入 `currentInputHashes`？ | 作用 |
| --- | --- | --- |
| `ACTIVE_SOURCE_ALLOWLIST`（9） | 是 | 当前解析/哈希输入：6 个 coverage/seed + 3 个 provenance-only `document_json`（Malzahar E EXTRA sidecar + Wiki current-items normalized/manifest；均 `recordCount=0`） |
| `GENERATOR_SOURCE_ALLOWLIST`（3） | 是 | registry / G8 / Unified 生成器自身哈希 |
| `HISTORICAL_SOURCE_REF_ALLOWLIST` | 否 | sourceRefs/alias 允许的历史路径（含 Batch-G 文件作 `historical_reference`；Batch-J Malzahar 仅 regression） |
| `SEED_REFERENCE_ATTACHMENTS` | 否（不读不哈希） | 按 mechanismKey 静态挂 seed 引用 |

缺项 fail-closed；非白名单路径不得出现在 `sources` / hashes / sourceRefs。**禁止**对 EXTRA 目录做 discovery。

## 8. 不变量

1. Routing / registry / G8 候选键集均为 242（165 heroes / 77 items），且与 `1c0b2c9` G8 key set 一致。
2. Unified 254 键集相对 `1c0b2c9` 不变；per-key disposition 自来源治理迁移以来的变化为**有意机制闭环**，不是 source-routing drift。
3. Unified：242 G8 primary + 242 registry primary；0 Batch-G primary；至多保留显式历史 alias `batch_g_terminus_shadow_stale_ready`。
4. `currentInputHashes` 路径集合 = active ∪ generator（**12** = 9 + 3）；Batch-G 不在其中。
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
| Malzahar E 详细设计 | `文档记录/详细设计/wasm/通用ABI-玛尔扎哈E恶咒降临MaleficVisions机制详细设计.md` |
