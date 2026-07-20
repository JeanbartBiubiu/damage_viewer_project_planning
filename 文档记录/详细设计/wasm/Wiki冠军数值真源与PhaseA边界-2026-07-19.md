TASK_KEY: wasm-generic-min-validation-coverage-audit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: draft
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-20

# Wiki 冠军数值真源与 Phase A 边界（2026-07-19）

> **当前真源治理（2026-07-20，`wiki-only-candidate-registry-source-allowlist-v3`）**：242 候选的 canonical 输入是 Wiki-only 候选注册表；Batch-G 仅为兼容投影；G8/Unified 直接消费注册表与显式来源白名单。详细设计见同目录 `Wiki-only候选注册表与Unified显式来源白名单设计.md`。下文保留 Phase-A 历史上下文，并以当前真源为准。

## 1. 数值真源优先级

1. **当前 League Wiki — 英雄技能**（`数据参考/lol-wiki-current-champions/`）
   - `identity-manifest.json`（165 英雄技能 pageId / candidateKey 映射）
   - `normalized/reviewed-contracts.json`（已审阅合同，优先）
   - `normalized/generic/{pageId}.json`（其余技能字段快照；含 `revisionId` + `contentSha256`）
2. **当前 League Wiki — 装备**（`数据参考/lol-wiki-current-items/`）
   - `manifest.json` revid `4030984` / SHA256 `e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d`
   - `current-items.normalized.json`（装备被动数值与效果槽）
   - **不再**以本地 `数据参考/item.json` 文本分段作为活跃数值真源；六条历史 collision `candidateKey` 仍保留 opaque 身份字面量，但路由由 Wiki `wikiEffectSlots` 显式给出
3. **Wiki-only 候选注册表**（canonical 候选池）：`最小验证/wiki-only-mechanism-candidate-registry.json`
   - 由 `数据参考/lol-wiki-mechanism-candidates/routing-manifest.json`（242；hero 165 / item 77；53 item owners）+ 上列 Wiki 快照生成
   - **G8 与 Unified 的 canonical 输入**；`auditBaseline` 承载结构化分类 / OOS，Wiki `sourceText` 仅 display/provenance
4. **Batch-G 兼容投影**（非 canonical）：`最小验证/V2-Batch-G-adc-passive-audit.json`
   - 仅从注册表投影；历史桶计数仍为 22 already / 31 runtime / 1 ready / 43 manual / 145 OOS
   - **不是** G8 的 canonical 输入
5. **Generic/wasm 证据**：仅用于 `completed` / `partial` 的 bilateral 引用，**不得**反向充当数值真源

**已删除（Phase A 边界，仍有效）**：`数据参考/ddragon-champions/**`、`数据参考/champion.json`、`数据参考/champion/**`、`tools/lol-static-data/convert-ddragon-champions.mjs`。注册表 / G8 / Unified 生成器不得再读取或引用上述路径；输出 JSON/CSV 不得含 `ddragon` 或已删 champion-static 路径子串（大小写不敏感）。六条 opaque collision key 字面量中的历史 `item.json#…` 片段是身份保留，**不是**活跃读取路径。

## 2. identity-manifest 与 routing-manifest 用法

- 英雄键：`ownerId|skillKey` → `pageId`、`candidateKey`、Wiki 修订元数据（identity-manifest，165）
- 装备键：routing-manifest 为每个 item 候选给出显式 `wikiItemId` + `wikiEffectSlots`；**禁止**按槽位数量/顺序推断
- G8 对全部 242 行使用注册表显式 `candidateKey`；`blocked_data` 仅在 Wiki **缺失/unknown** 必填数值合同时保留
- 可核验 Wiki 公式 → **非** `blocked_data`；按 mechanism override / `auditBaseline` 标 `blocked`/`partial`/`out_of_scope`，`remainingGap` 为 runtime/out_of_scope

## 3. 单目标策略与 runtime 原语

- 多目标/摆荡/视野/纯位移等 → `out_of_scope`（结构化 `outOfScopeEvidence` / `auditBaseline.outOfScope`；**不以** Wiki 英文/中文词面驱动分类）
- **不声称** C1–C4 runtime 原语已在 wasm 落地；`ready_to_implement=0`
- 已闭环 Phase-A 示例：Xayah W **25% / 1.25×** 合并 `basic_damage` 倍率（非 Arena 20%；非第二 missile；expected-crit 一次；排除 on-hit/proc/phantom 重复）
- 保留的精确 runtime blocker 示例：`axe_caught_event_ability_cooldown_reset`（Draven W 已闭环后仍可见其它具名 primitive）、feather/E 依赖族（Xayah P）等
- 已闭环边界（巨人杀手）：仅关闭当前 1v1 champion-source/target，以 `target.attr.hp.max - target.attr.hp.base` 作为显式 bonus-health 代理；**不是**专用 `target_bonus_health` ABI 字段，也**不**实现 non-champion 过滤

## 4. 经典 SR 近似与固定假设

- **Xayah W（已实现 Phase-A）**：classic SR 次级羽刃按 **25%** settled BA ratio 近似为 source-owned `basic_damage * (1 + 0.25 * deadly_plumage_active)`（1.25×），单次 expected-crit 后再乘一次，排除 on-hit/proc/phantom 重复；移速/Rakan/Runaan/projectile/独立 missile 等为 completedBoundary exclusions
- **Teemo P / Twitch Q / Varus P**：**fixed-enabled AS** 假设分支；stealth/kill/minion 事件分支 out of assumed scope，标 `completed`（非 stealth/kill blocker）
- **Kindred P（已实现 Phase-A）**：fixed 25-mark；常驻 range / Q·W·E 探针；旧 blocker `kindred_mark_stacks_max_assumption_and_qwe_dependencies` 已移除（**非** `distance_or_ratio_input`）

## 5. 当前停止边界（相对历史 Phase A）

历史 Phase A：删除 champion-static、Wiki 真源刷新、机制逐项闭环；**不** live migrate/publish。

**当前已完成的跨切面收口（v3）**：

| 角色 | 状态 |
| --- | --- |
| Wiki-only routing + registry | 已落地；242 候选 |
| Batch-G | 兼容投影 only；非 G8 canonical |
| G8 | 直接读注册表；相对 `1c0b2c9` 零漂移（48/5/120/69） |
| Unified | 8 active + 3 generator hashes = 11 `currentInputHashes`；242 G8 + 242 registry primary；0 Batch-G primary |
| live migrate / publish / merge / push | **未执行** |

**仍不在本边界内**：全量 C1–C4 原语落地、下一机制闭环实现、Go/Backend/Web 改动（除非另有机制任务）、Planning worktree 写入。

装备图像 key 修复脚本（`最小验证/数据/repair-item-image-keys-from-ddragon.ps1`）**不是** 机制数值真源。

## 6. 相关产物

| 产物 | 路径 |
| --- | --- |
| Routing manifest | `数据参考/lol-wiki-mechanism-candidates/routing-manifest.json` |
| Wiki-only 注册表 | `最小验证/wiki-only-mechanism-candidate-registry.json` / `.csv` |
| Batch-G 兼容投影 | `最小验证/V2-Batch-G-adc-passive-audit.json` |
| G8 审计 | `最小验证/generic-g8-adc-passive-coverage-audit.json` |
| 统一清单 | `最小验证/unified-mechanism-inventory.json` |
| 阻塞汇总 | `文档记录/测试记录/wasm/最小验证剩余阻塞项汇总-2026-07-19.md` |
| 本轮详细设计 | `文档记录/详细设计/wasm/Wiki-only候选注册表与Unified显式来源白名单设计.md` |
| 本轮验证记录 | `文档记录/测试记录/wasm/Wiki-only候选注册表与Unified显式来源白名单验证记录-2026-07-20.md` |
