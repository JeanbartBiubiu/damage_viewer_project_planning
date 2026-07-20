TASK_KEY: wasm-generic-min-validation-coverage-audit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: draft
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-19

# Wiki 冠军数值真源与 Phase A 边界（2026-07-19）

## 1. 数值真源优先级

1. **当前 League Wiki**（`数据参考/lol-wiki-current-champions/`）
   - `identity-manifest.json`（165 英雄技能 pageId / candidateKey 映射）
   - `normalized/reviewed-contracts.json`（8 条已审阅合同，优先）
   - `normalized/generic/{pageId}.json`（其余技能字段快照；含 `revisionId` + `contentSha256`）
2. **装备**：`数据参考/lol-wiki-current-items/current-items.normalized.json` + 本地 `数据参考/item.json` 文本分段
3. **冻结 Batch-G JSON**：`最小验证/V2-Batch-G-adc-passive-audit.json`（分类/候选池 provenance；**不再**从冠军静态 JSON 重建）
4. **Generic/wasm 证据**：仅用于 `completed` / `partial` 的 bilateral 引用，**不得**反向充当数值真源

**已删除（Phase A 边界）**：`数据参考/ddragon-champions/**`、`数据参考/champion.json`、`数据参考/champion/**`、`tools/lol-static-data/convert-ddragon-champions.mjs`。G8/unified 生成器不得再读取或引用上述路径；输出 JSON/CSV 不得含 `ddragon` 或已删 champion-static 路径子串（大小写不敏感）。

## 2. identity-manifest 用法

- 键：`ownerId|skillKey` → `pageId`、`candidateKey`、Wiki 修订元数据
- G8 对 **全部 165** 英雄技能行尝试 Wiki lookup；`blocked_data` 仅在 Wiki **缺失/unknown** 必填数值合同时保留
- 可核验 Wiki 公式（如 `{{ap|45 to 165}} (+ 70% bonus AD)`）→ **非** `blocked_data`；按 mechanism override 标 `blocked`/`partial`/`out_of_scope`，`remainingGap` 为 runtime/out_of_scope

## 3. 单目标策略与 runtime 原语

- 多目标/摆荡/视野/纯位移等 → `out_of_scope`（结构化 `outOfScopeEvidence`）
- **不声称** C1–C4 runtime 原语已在 wasm 落地；`ready_to_implement=0`
- 已闭环 Phase-A 示例：Xayah W **25% / 1.25×** 合并 `basic_damage` 倍率（非 Arena 20%；非第二 missile；expected-crit 一次；排除 on-hit/proc/phantom 重复）
- 保留的精确 runtime blocker 示例：`axe_caught_event_ability_cooldown_reset`（Draven W 已闭环后仍可见其它具名 primitive）、feather/E 依赖族（Xayah P）等
- 已闭环边界（巨人杀手）：仅关闭当前 1v1 champion-source/target，以 `target.attr.hp.max - target.attr.hp.base` 作为显式 bonus-health 代理；**不是**专用 `target_bonus_health` ABI 字段，也**不**实现 non-champion 过滤

## 4. 经典 SR 近似与固定假设

- **Xayah W（已实现 Phase-A）**：classic SR 次级羽刃按 **25%** settled BA ratio 近似为 source-owned `basic_damage * (1 + 0.25 * deadly_plumage_active)`（1.25×），单次 expected-crit 后再乘一次，排除 on-hit/proc/phantom 重复；移速/Rakan/Runaan/projectile/独立 missile 等为 completedBoundary exclusions
- **Teemo P / Twitch Q / Varus P**：**fixed-enabled AS** 假设分支；stealth/kill/minion 事件分支 out of assumed scope，标 `completed`（非 stealth/kill blocker）
- **Kindred P**：max-mark 数据假设 + Q/W/E 依赖；blocker `kindred_mark_stacks_max_assumption_and_qwe_dependencies`（**非** `distance_or_ratio_input`）

## 5. Phase A 停止边界

- 生成器：`build-generic-g8-adc-passive-coverage-audit.mjs`、`build-unified-mechanism-inventory.mjs`（Wiki 真源 + 结构校验，**无**固定 status 总数）
- Batch-G 生成器：冠军静态 JSON 缺失时 **early-fail**；`--check` 仅校验冻结 JSON
- **不在 Phase A**：live migrate/publish、全量 Batch-G 重分类、Go/Backend/Web 改动
- 装备图像 key 修复脚本（`最小验证/数据/repair-item-image-keys-from-ddragon.ps1`）**不是** 机制数值真源

## 6. 相关产物

| 产物 | 路径 |
| --- | --- |
| G8 审计 | `最小验证/generic-g8-adc-passive-coverage-audit.json` |
| 统一清单 | `最小验证/unified-mechanism-inventory.json` |
| 阻塞汇总 | `文档记录/测试记录/wasm/最小验证剩余阻塞项汇总-2026-07-19.md` |
