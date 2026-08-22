TASK_KEY: wasm-generic-kaisa-void-seeker-primary-hit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-22

# 通用 ABI - 卡莎 W 虚空索敌（Void Seeker）主目标命中机制详细设计

关联验证记录：[通用 ABI 卡莎 W 虚空索敌 Void Seeker 主目标命中机制验证记录](../../测试记录/wasm/最小验证剩余阻塞项汇总-2026-07-19.md)。本任务将精确候选 `hero_skill|hero_kaisa|W|虚空索敌` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称施放延迟/弹道/几何/视野揭示/Plasma 进化/冷却返还或完整游戏技能保真。冻结方案：`FROZEN_PLAN_REV kaisa-w-void-seeker-primary-hit-phase-a-v2`（DESIGN_REVIEW v2 READY `run-3ae202d3-6cbd-42a2-8748-2ddd9dee34c9`；agent `agent-87fa12f8-a079-4590-b762-18189a2f2cd3`；strict model；runDelta0/outside0；721 parseable；无 truncation/task/mutation。v1 `run-3068c8fb-91ab-4c3d-b5f8-2a98096d16d6` 因四条内部结果 `clientTruncated=true` **无效**，其 tag 结论已吸收进 v2，**不是**共识门控。审查结论：boundary 允许；immediate scaffold 显式排除 Wiki 0.4s cast / `Effect at cast time end`；total AD 写在 boundary/reason/formula；**无** `total_ad_ratio` governed tag；`bonus_ad_ratio` 为假）。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_kaisa\|W\|虚空索敌` |
| Wiki | 请求 `Template:Data Kai'Sa/W`，解析为 `Template:Data Kai'Sa/Void Seeker`；pageId `1353553`；revision `4034696`；timestamp `2026-06-23T21:14:14Z`；canonical raw bytes `1843`；SHA256 `aa4ba76c6fa345c711651fa56d9b914d4ea8b7eb3ddfae79d7feb25470d7e3d1`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/kaisa-w.json`；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| raw caveat | 本地 raw 物化为 `1842` bytes / SHA256 `496936a80f17b2b0fe0dcb18a2f7e237e77b22ee687b3a59a2a24b775f9b5802`（末尾换行）；**sidecar 拥有 canonical 元数据**，raw 仅作存在/非空证明。**不得**表述为源矛盾 |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank5_primary_target_single_hit; immediate_impact_scaffold; magic_130_plus_1_30_total_ad_plus_0_45_ap; no_cast_delay_projectile_geometry_sight_reveal_plasma_evolution_or_cooldown_refund` |
| Rank-5 active | 75 mana；14000ms cooldown；immediate primary-target scaffold；每次成功施放恰好一笔非暴击/不可复制魔法伤害 `130 + 1.30*source.attr.ad.resolved + 0.45*source.attr.ap.resolved`；**AD 为 total AD，永不 bonus AD** |
| 数值交叉 | totalAD100 / AP100 → raw305；目标 MR100 → mitigated152.5。t0 / t13999 / t14000：两次命中 + 恰好一次 cooldown skip 且不扣 mana、无伤害；mana345 → final195；目标 HP1000 → final695 |
| governed tags | 仅 `ability_cost_cooldown`、`active_magic_damage`、`ap_ratio`、`immediate_impact_scaffold`。**不存在** `total_ad_ratio` governed tag；`bonus_ad_ratio` 为假；total AD 仅显式写在 boundary / reason / formula |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A scaffold 与排除

Immediate impact 是 **Phase-A scaffold**：成功施放后立即对主目标结算单次魔法伤害。Wiki 0.4s cast 与 `Effect at cast time end` **被显式排除**，而非建模或近似；**不**伪造 cast-delay phase。不代表真实弹道飞行、路径几何、首个敌人索敌、视野揭示、Plasma/Second Skin 耦合、进化或冷却返还保真。

| 排除（非 remainingGap / 非 blocker） | 说明 |
| --- | --- |
| cast0.4 / Effect at cast time end | 施放延迟与 cast-end 时序 **排除而非近似** |
| projectile / travel / collision / first-enemy acquisition | 无弹道、碰撞与首敌索敌合同 |
| location / range3000 / width200 / speed1750 / geometry / spellshield | 无落点、射程、宽度、速度、几何与法术护盾合同 |
| sight / reveal / true sight 4s | 视野与真实视野全部排除 |
| applying 2 Plasma / Second Skin / Plasma / Caustic Wounds coupling | Plasma 叠层与被动族耦合全部排除 |
| item AP100 evolution / applying 3 Plasma / champion-hit 75% cooldown refund | 进化与冷却返还全部排除 |
| ranks 1–4 | 仅 Rank5 |
| equipment / loadout | 无装备/配装耦合 |
| live migration / Admin publish / browser E2E / full-game fidelity | 发布与完整保真不在本闭环 |

## 3. 端到端数据流

```text
Wiki kaisa-w.json (page1353553/rev4034696；canonical SHA aa4ba76c…)
  → Backend seed（self-contained；provider_hero_kaisa_w_void_seeker_primary_hit）
    → Web 既有 generic 投影（无本机制 Web 源码变更；无生产 Wasm/ABI/runtime 变更）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/cooldown → null-duration impact + on_enter sequence
    → 一笔 magic damage operation（130+1.30*totalAD+0.45*AP；runtime magic 20221 / 无 20220）
```

| 层 | 合同 |
| --- | --- |
| Backend | 自包含 seed：baseline hp640 / mana345 / ad59 / ap0 / AS0.644 / armor25 / MR30 / hpregen0.8 / manaregen1.64；恰好九条属性定义（含 AP）；保留既有 basic / Second Skin / Supercharge providers；仅挂载独立 `provider_hero_kaisa_w_void_seeker_primary_hit`；一条 active ability（cost/cooldown）、null-duration impact + on_enter sequence、一笔魔法 `130+1.30*source.attr.ad.resolved+0.45*source.attr.ap.resolved` operation。幂等 material-change revision guard；**无** DELETE/DDL/auto-publish/live execution。owning `9d9200a` / 集成 `1dc8d5b`；focused JUnit 56/56；full Maven 696/696 |
| Web | 既有 generic 投影；owning lint/typecheck/Vitest330/build PASS；integrated lint/typecheck/Vitest136/build PASS；**无**本任务 Web 源码变更。**不**声称 Web Wasm 资产与当前 build 同步（见 §5 资产现状限制） |
| Wasm | exact `41e88a2`（`wasm/tinygo_engine_v2/internal/runtime/generic_kaisa_void_seeker_primary_hit_test.go`）；真实 CompileGeneric / RunGeneric；focused 4/4 与 full `go test -count=1 ./...` PASS；bench100 PASS；TinyGo build PASS（1,168,476 bytes；SHA `84977E884BA81B4D19C54A36B454C0D8620FB66ADB14C12F07D2824CCACF0666`）；Node canonical compile/run/release smoke PASS。**无**生产 Wasm/ABI/runtime 变更 |

## 4. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN_REVIEW v2 READY | agent `agent-87fa12f8-a079-4590-b762-18189a2f2cd3`；run `run-3ae202d3-6cbd-42a2-8748-2ddd9dee34c9`；strict model；runDelta0/outside0；721 parseable；无 truncation/task/mutation |
| DESIGN_REVIEW v1（无效） | `run-3068c8fb-91ab-4c3d-b5f8-2a98096d16d6`；四条内部结果 `clientTruncated=true`；**不是**共识门控；tag 结论已吸收进 v2 |
| Backend owning | `9d9200a`；实现 run `run-f5555bba-5bfb-45f8-bd61-9053d1dcaf9b`（agent `agent-7fc26ac5-cfd3-4ecb-a246-6456bf779126`；runDelta3/outside0；953 parseable/无 truncation） |
| Backend 日期修正 | agent `agent-8ed95b08-be03-42ac-a40a-2b47da2dad2b`；run `run-1445d17f-9c01-4518-bd3e-2fe15a2efe71`；delta2 / runDeltaOutside0 |
| Backend 集成 | `1dc8d5b` |
| Wasm exact | `41e88a2`；实现 run `run-4c648ac1-bfe8-4eef-8d50-f7b61b3a5c04`（agent `agent-d829723e-441c-4692-9972-5a5b51a7b406`；runDelta1/outside0；703 parseable/无 truncation） |
| Wasm gofmt | agent `agent-04b215ed-9ccd-490b-bd4e-01183e19ff00`；run `run-29592ea2-1092-4375-abcc-76e3bf14edd0`；delta1/outside0 |
| 审计 commit | `26285fa`；实现 run `run-e68c0b2d-1ffe-40cc-9f2a-b7d574960519`（agent `agent-a9bde30d-9104-445c-ac59-b715f12099cd`；runDelta6/outside0；1153 parseable/无 truncation） |
| 最终清单 | G8 242 = migrated57 / partial4 / blocked112 / OOS69；Unified sourceCount12 / total254；completed67 / partial_actionable0 / ready0 / blocked_runtime106 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full67 / partial3 / none184；actionable0；`implementation_gap_no_unresolved_data_fields=88` |

## 5. 审计 override、语义比较与资产现状限制

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`（仅 `ability_cost_cooldown|active_magic_damage|ap_ratio|immediate_impact_scaffold`）、空 `remainingGap`。raw upstream `classification` / `mechanismTags` / `auditBaseline`（含历史 `meta_or_non_target_dps` / `blocked_data` provenance）按既有 G8 schema 保留为历史输入 provenance，**不是**最终 disposition。exact audit override **必须**清掉 governed generic 陈旧状态。

主会话语义比较：ordered keys 不变；全部 241 条非 Kai'Sa W G8 行与全部 253 条非 Kai'Sa W Unified 行作为解析对象字节等价；**仅** Kai'Sa W governed disposition/evidence 变化。Registry / Batch-G checks PASS。

**Web Wasm 资产现状限制（非 Kai'Sa W 机制 blocker）**：冻结 Kai'Sa W 计划零生产 Wasm/Web 写入，故未扩大亦未同步既有漂移。当前 build size `1,168,476` SHA256 `84977E884BA81B4D19C54A36B454C0D8620FB66ADB14C12F07D2824CCACF0666`；owning Web asset size `1,155,992` SHA256 `6A5250835639AD9A1E70F1A9B2A5811F14E307717779FE89A1A3A46B96A4917A`；Wasm integrated Web asset size `1,101,630` SHA256 `2CE1A0DAF10D193567663F28CD2ACD7941EA62EBF4284C307D5C5CC91C0B0BBF`。记录为独立 artifact-currentness 限制，**不得**误读为 Kai'Sa W 机制未闭环。

非目标（再次强调）：cast0.4/`Effect at cast time end`、projectile/travel/collision/first-enemy acquisition、location/range3000/width200/speed1750/geometry/spellshield、sight/reveal/true sight 4s、applying 2 Plasma 与全部 Second Skin/Plasma/Caustic Wounds 耦合、item AP100 evolution/applying 3 Plasma/champion-hit 75% cooldown refund、ranks1–4、equipment/loadout、live migration/Admin publish/browser E2E/full-game fidelity。不得误称排除行为已实现或完整游戏技能保真；不得引入 `total_ad_ratio` governed tag 或把 total AD 误写为 bonus AD。
