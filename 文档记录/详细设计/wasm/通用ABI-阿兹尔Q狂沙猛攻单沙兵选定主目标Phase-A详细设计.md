TASK_KEY: wasm-generic-azir-conquering-sands-one-soldier-primary-hit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-27

# 通用 ABI - 阿兹尔 Q 狂沙猛攻（Conquering Sands）单沙兵选定主目标 Phase-A 详细设计

关联验证记录：[通用 ABI 阿兹尔 Q 狂沙猛攻单沙兵选定主目标 Phase-A 验证记录](../../测试记录/wasm/通用ABI-阿兹尔Q狂沙猛攻单沙兵选定主目标Phase-A验证记录-2026-07-27.md)。本任务将精确候选 `hero_skill|hero_azir|Q|狂沙猛攻` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime`；无 actionable gap。**仅** Rank-5 假定一个既有沙兵、选定主目标的单次魔法命中 Phase-A；**不**宣称完整 Conquering Sands / 完整 Q / 完整游戏保真。明确排除 ranks1–4、soldier entity/spawn/despawn/count/formation/placement/state/gate、command/path/dash/travel/collision、target location/range/geometry/pass-through/arrival/multitarget、slow、sibling Azir abilities/loadout、live/publish/Web/assets/browser E2E/full-game fidelity。一个既有沙兵仅为 caller/scenario 假定与 completed-boundary exclusion，**永不**建模或强制为状态门控。`immediate_impact_scaffold` 仅为边界用语，**不是** governed tag。Jhin P / Yunara P 仍为用户推迟的 `blocked_runtime`，**不是** `out_of_scope`。Aphelios **OOS**。**未**声称总体 Goal 完成。冻结方案：`FROZEN_PLAN_REV azir-q-conquering-sands-one-soldier-selected-primary-hit-phase-a-v1`。

## 0. 设计审查历史

| 轮次 | Run | 裁决 | 模型 / 元数据 | 吸收要点 |
| --- | --- | --- | --- | --- |
| v1 | `run-33d1ffcf-4e3f-4304-8b19-51bdbff92d68` | **READY** | DESIGN_REVIEW_ONLY；strict grok-4.5 / high / false；runDelta0/outside0；1671 parseable event lines；无 truncation/mutation | 正式最终设计门控 |

Production Wasm / public ABI / Web 变更**不**需要——本切片为文档/治理；实现证据已由 Backend/Wasm/审计提交。

## 1. 目的与非目标

### 1.1 目的

在通用 ABI 下，对 Azir Q 建立**有界 Phase-A** 证据闭环：Rank-5 假定一个既有沙兵、选定主目标**单次魔法命中**脚手架（immediate impact），使候选进入 `completed/full/generic_runtime`（G8 `migrated`）。

### 1.2 非目标

下列为 **completed-boundary exclusions**（**不是** remaining blockers，亦**不是**已建模近似）：

- ranks 1–4
- soldier entity / spawn / despawn / count / formation / placement / state / gate
- command / path / dash / travel / collision
- target location / range / geometry / pass-through / arrival / multitarget
- slow
- sibling Azir abilities / loadout / bootstrap
- live migration / Admin publish / browser E2E / Web / assets / 完整 Conquering Sands / 完整 Q / 完整游戏保真

**精确单沙兵选定主目标有界完成 ≠ 完整 Q 保真。**

## 2. 权威来源

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_azir\|Q\|狂沙猛攻` |
| Wiki request / resolved | `Template:Data Azir/Q` → `Template:Data Azir/Conquering Sands` |
| Wiki 身份 | pageId `1306850`；revision `4024967`；timestamp `2026-06-04T07:26:59Z`；canonical raw bytes `2512`；SHA256 `168e2568c6795859e68831eb23b59b62d249aceb07cf3740403b1616516b51f2` |
| normalized | `数据参考/lol-wiki-current-champions/normalized/generic/azir-q.json` bytes `3119` / SHA256 `9e2cfc28ced422699bbb40722ba46d82167c79f34bbd696f2fc4080e52120fb7`；pages sibling bytes `684` / SHA256 `a15a3c54079cd8a75584c9725bb792441103ff27cafa31fa136d076791fa71f4` 为权威 |
| local raw caveat | local raw bytes `2510` / SHA256 `6885ead987cae40fa37992d170337007629e3f12ebfc494eb3a1f54b5fb110e4`——**local raw materialization caveat only**；**故意不断言**字节等价，亦**不得**表述为源矛盾；canonical identity 仍为 sidecar/pages |
| sourceCount | **仍为 12**（9 active + 3 generators；无新源） |

## 3. 有界 Phase-A 合同

| 环节 | 合同 |
| --- | --- |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank5_assume_one_existing_sand_soldier_selected_primary_single_magic_hit; immediate_impact_scaffold; magic_140_plus_0_55_ap; mana110_listed_cooldown6000ms_scaffold; no_soldier_entity_spawn_count_formation_command_path_target_location_dash_collision_geometry_multitarget_slow_or_full_fidelity` |
| G8 governed tags（序） | `ability_cost_cooldown`、`active_magic_damage`、`ap_ratio`、`one_existing_soldier_selected_primary_hit_scaffold` |
| 公式 | `add(const 140, mul(const 0.55, read source.attr.ap.resolved))`（精确嵌套二元；AP path **恰好一次**；**不**读 AD / crit_chance / crit_damage） |
| CritEligible | `false`；CopyableOnHit `false` |
| 事件 | 恰好一笔非暴击/不可复制魔法伤害量子（type **20221** / add **20170**；无 20230；无显式 event op；无 Q ability-specific type）；成功施放自动一次 `ability_started` |
| Provider | 独立 standalone Q provider；**无**生产英雄 switch / generic-runtime specialization；**无** Batch-B 或 sibling Azir synthesis |
| 沙兵假定 | caller/scenario 假定一个既有沙兵；**永不**建模或强制为状态门控 |
| 数值交叉 | AP0/MR0：raw140/final140；AP100/MR100：raw195/final97.5；无关 AD/crit/crit_damage 变化不影响本量子 |
| 日程交叉 | mana330/AP100/HP1000/MR100：t0/t5999/t6000 → success/skip/success；两笔 Q damage；final mana110/HP805；两次自动 `ability_started`；mana109 → resource skip 不变 |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 4. 通用 ABI 图

```text
Wiki azir-q.json (page1306850/rev4024967；canonical SHA 168e2568…)
  → Backend seed（lol_generic_azir_conquering_sands_one_soldier_primary_hit_seed.sql；
     hero_azir/ap/mana = external existing-data/check-only；
     standalone Q 图；无生产 runtime 特化）
    → Web 既有 generic 投影（无本机制 Web 写入）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → mana110 + listed CD scaffold 6000ms
    → 恰好一笔魔法量子 140+0.55*ap.resolved
    → 自动 ability_started ×1 / 成功施放
```

## 5. Backend 所有权 / 前置

| 项 | 合同 |
| --- | --- |
| seed | `db/game_manage/seeds/lol_generic_azir_conquering_sands_one_soldier_primary_hit_seed.sql`（bytes `29560`；SHA256 `9263b65f6432ca39f5c095934513fe5358a5bf159664904f7d59d86c05eae149`） |
| JUnit | `LolGenericAzirConqueringSandsOneSoldierPrimaryHitSeedSqlTest`（bytes `50880`；SHA256 `9409b991ea37f69d63c10f7811ee6e33f941fd9ce6eff554fb08d8f6d126e4fb`） |
| 前置 | `hero_azir` / AP / mana 为 **external existing-data/check-only**；**不**物化 identity/panel/resource values；standalone Q；**无** live |
| owning | `dd214a3501601098f73267900aa6a199626d5b31`（`run-1a22222a-f467-4069-bdb7-b2729ff6fbed`；runDelta3/outside0；events1440；focused 37/37 PASS；driver full Maven 1132/1132 PASS） |
| live | **无** live seed execution |

## 6. Wasm 测试-only 证据

| 项 | 合同 |
| --- | --- |
| exact path | `wasm/tinygo_engine_v2/internal/runtime/generic_azir_conquering_sands_one_soldier_primary_hit_test.go` |
| bytes / SHA | `66442` / SHA256 `ea86be56d3d60d4f9032fa1145f04920c459935778c4c1d60f0eb140e9887188` |
| 接受实现 run | `run-04125cb2-8079-47b6-8b1a-fc795924d1ca`：finished；runDelta1/outside0；events1447 parseable；focused Azir 与四 sibling PASS；precommit full 仅因 test 文件 dirty 失败 |
| 接受 commit | `5580ae77d30764de1b8f4974072f55680cce137b`；提交后 driver `go test -count=1 ./...` PASS 与 `go run ./cmd/bench` PASS |
| 地位 | 英雄名 `_test.go` **仅为**测试/治理证据，**排除**于生产构建；**无**生产英雄 switch / generic-runtime specialization |
| 生产 / Web | **无**生产 Wasm / public ABI / Web / asset 写入；**未**资产重建 |

## 7. Fixtures

| Fixture | 期望 |
| --- | --- |
| AP0 / MR0 | raw140 / final140 |
| AP100 / MR100 | raw195 / final97.5 |
| AD / crit / crit_damage 变化 | 本量子不变 |
| mana330；t0/t5999/t6000 | success/skip/success；mana110/HP805；两笔 Q damage；两次 `ability_started` |
| mana109 | resource skip；mana/HP 不变；无 Q damage/event |

## 8. 审计迁移与完成语义

| 项 | 合同 |
| --- | --- |
| 审计首轮（拒绝） | `run-2c236416-03a5-44ac-ac77-8cf17cc5c243`：产生意图内八路径 diff，但 event log 在 `C:\Users\Administrator\AppData\Local\Temp` 创建两枚 scratch（`azir-pre-snapshot.json`、`azir-validate.mjs`）——**拒绝**；driver 已删除并确认两文件均不存在；**不得**引为接受 run |
| 接受恢复/采纳 | `run-daf2b308-5659-45ad-9dbf-e4e47efe9d3e`：finished；strict model；duration231462ms；runDelta0/outside0；1115 parseable；无 truncation；无 file mutation tools；无 Temp/仓库写入；最终 ADOPTED；Driver 五 check + target-record/order/provisional-removal/override uniqueness + `git diff --check` PASS |
| 接受审计 commit | `140ae71e71757bf698a50a0368ed10f31b87f098` |
| 当前计数 | Wiki-only242 不变 migrated48/partial5/blocked120/OOS69；G8 242=migrated103/partial4/blocked66/OOS69；Unified254/source12 completed113/blocked_runtime60/blocked_data3/OOS72/regression5/stale1；full113/partial3/none138；actionable0；`implementation_gap_no_unresolved_data_fields` **为 52**；status=`blocked_runtime` 且 blocker=`blocked_data` 的家族行 **仍为 1**（勿与 impl-gap 混淆）；provisional63=runtime60/data3；hero62/item1；**Azir Q 缺席** |
| 报告口径 | 严格 verified completion **113/254=44.5%**；completed+provisional descriptive coverage **仍为 176/254=69.3%** |
| digests | Unified `69832c2a7e7a473b64fd102771cb8055d63683245d76fdccff54598ef329c018`；Wiki `927d8b5a729fe5a00ce4428cf854cb244dcf78b556afc77e711c9b8cb68126c7`（不变） |
| OOS / 真队列 | `out_of_scope=72` 为**最终跳过分类**：无实现/模板/后续队列。真剩余队列 **仅 63** = blocked_runtime60 + blocked_data3 |
| 完成语义 | Azir Q 完成/`actionableKeyCount=0` **不是**停工条件；总体 Goal **仍活跃**；治理 tasks **127**（docs commit pending driver） |

## 9. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1306850 / rev4024967 / timestamp2026-06-04T07:26:59Z / canonical2512 / SHA `168e2568…6b51f2`；normalized3119 / SHA `9e2cfc28…120fb7`；pages684 / SHA `a15a3c54…fa71f4`；local raw2510 / SHA `6885ead9…b110e4` materialization caveat only |
| 边界 | exact `completedBoundary`；单沙兵选定主目标单次魔法命中，不是完整 Q；沙兵仅为 scenario 假定 |
| tags | exact 四 tags 序：`ability_cost_cooldown` / `active_magic_damage` / `ap_ratio` / `one_existing_soldier_selected_primary_hit_scaffold`（`immediate_impact_scaffold` **不**入 tags） |
| 公式 / fixtures | `140+0.55*ap.resolved`；CritEligible false；§7 fixtures |
| Backend | owning `dd214a35…`；focused 37/37 + full1132；external check-only；standalone；无 live |
| Wasm | exact `5580ae77…`；英雄名 `_test.go` 仅测试/治理；无生产/Web 写入 |
| 审计 | 接受 `140ae71e…`（首轮 Temp scratch 已拒绝）；counts 与 §8 一致；tasks127 |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成 |
