TASK_KEY: wasm-generic-jhin-deadly-flourish-primary-hit
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-25

# 通用 ABI 烬 W 致命华彩 Deadly Flourish 主目标命中机制验证记录

详细设计：[通用 ABI - 烬 W 致命华彩（Deadly Flourish）主目标命中机制详细设计](../../详细设计/wasm/通用ABI-烬W致命华彩DeadlyFlourish主目标命中机制详细设计.md)。

## 1. 范围与证据边界

已闭环候选 `hero_skill|hero_jhin|W|致命华彩`：`completed/full/generic_runtime`（G8 governed `migrated`）。Wiki：请求 `Template:Data Jhin/W`，解析 `Template:Data Jhin/Deadly Flourish`；page `1307581` / rev `4021795` / timestamp `2026-05-21T13:25:33Z`；canonical raw bytes `2942`；SHA256 `14790ca09f6f320fc2fadc81c2fa7e783c7b81d48d792b7760494f2e8d788c65`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/jhin-w.json` plus pages sibling 为权威；sourceCount **仍为 12**（9 active + 3 generators；无新源）。本地 raw materialization 为 `2940` bytes / SHA256 `76790ba522dc101bb1f1c24ae620f80e8db6d10e890515cbc7da85005a67f78b`——**local raw materialization caveat**；sidecar/pages 为权威身份；**故意不断言**字节等价，**不是**源矛盾。边界：`rank5_primary_champion_single_physical_hit; immediate_impact_scaffold; physical_210_plus_0_50_total_ad; no_cast_timing_direction_range_width_line_geometry_multitarget_champion_collision_projectile_interception_spell_shield_mark_creation_mark_detection_root_bonus_movement_speed_minion_reduction_other_ranks_or_full_fidelity`。governed tags 序：`ability_cost_cooldown`、`active_physical_damage`、`immediate_impact_scaffold`。合同：Rank5 70 mana / 12000ms CD；immediate primary-champion scaffold；恰好一笔非暴击/不可复制物理 `210 + 0.50 * source.attr.ad.resolved`（二元 `add`；**total AD**，不得减 base AD，亦不得称为 bonus AD）；成功施放自动一次 `ability_started`（无显式 event op）；零 W state/modifier/listener/matcher/repeat/control/projectile/mark/root/movement-speed；小兵-only 25% 减伤不适用于所选冠军，已排除。交叉：totalAD60 raw240，armor0=240，armor100=120；totalAD100 raw260，armor0=260，armor100=130。mana210/HP1000/AD100/armor100 t0/t11999/t12000 → success/skip/success、两笔 W damage、final mana70/HP740、两次自动 W `ability_started`；mana69 resource skip / mana/HP 不变 / 无 W damage/event。Jhin W provider **standalone**；不合成 Batch-B 或 sibling Jhin。Backend 无 repository-owned `hero_jhin`/AD/mana materializer；seed/JUnit 仅 external-existing-data/check-only；不物化 identity/panel/resource；不 live-publish。**不**宣称 cast timing/direction/range/width/line/multitarget/collision/projectile/interception/spell shield/facing/mark/root/movement speed/minion reduction/other ranks 或完整 Deadly Flourish/游戏保真；**未**声称总体 Goal 完成。

本文件由 **Cursor 文档/治理切片**（`FROZEN_PLAN_REV: jhin-w-deadly-flourish-primary-hit-phase-a-v1-docs-governance`；DESIGN_REVIEW READY `run-619cf912-b707-4dfa-95d1-eb4125b28921`，strict `grok-4.5`，effort high，fast false，runDelta0/diff0，1351 parseable event lines / 66 tool calls，无 truncation/mutation，无 user decision；运行时/审计已提交）创建。下列验证结果按实现与驱动复验记录抄录；**未**在本切片重跑实现测试。记录日期权威为 **2026-07-25**。

本轮**未**执行 live migration、Admin publish、push 或 browser E2E。本切片**未** rebuild SQLite / **未** `--fix-headers`。**无**生产 Wasm 或 Web 写入/commit。

| Worktree / 阶段 | Commit / Run | 内容 | 证据地位 |
| --- | --- | --- | --- |
| DESIGN_REVIEW READY | `run-619cf912-b707-4dfa-95d1-eb4125b28921` | READY；1351 parseable / 66 tool calls；runDelta0/diff0；无 truncation/mutation；无 user decision；非阻塞 external-existing-data/check-only、raw caveat、raw G8 OOS/meta provenance | **接受门控** |
| Backend owning | owning `4903c00`；`run-7efdfc0a-e2fe-414e-be04-93ea0803ec09` | runDelta3/outside0；843 events / 74 calls；strict；focused Jhin/Jinx/Kai'Sa **27/27**；owning full Maven **839/839**；seed SHA `0759F309…DC92`；JUnit SHA `DDAFC311…F0B7` | 接受 |
| Backend 集成 | `0c103f8`；`run-3e62e677-8a05-4053-99cf-758e3b62bf3b` | runDelta3/outside0；909 events / 46 calls；strict；无 truncation；两 hash 匹配 owning；README +27；主会话集成 Jhin+Jinx **18/18**；legacy Draven/Kai'Sa CRLF caveat | 接受；不得主张集成全量或修复 peer |
| Wasm exact | `d62d2e4`；`run-c3427736-be29-4b92-9378-a43b618a58c7` | runDelta1/outside0；941 events / 100 calls；strict；无 truncation；focused 6/7 + `-count=100` + full Go + bench + TinyGo + Node smoke PASS | 接受 |
| Web | 无本机制写入 | Built/Web 资产保持 `1,169,377` / `65A4…C6A0` 同步不变 | 接受；无 Web 变更/拷贝 |
| 审计 | `fc6f854`；`run-858cab7f-3782-47a3-86cc-25010fcd978e` | G8/Unified generate+`--check`；runDelta6/outside0；1157 parseable / 187 calls；strict；无 truncation；仅 Jhin W 对象变化；Jinx W + Xayah W/Q/R 八 hashes 不变 | 接受 |

## 2. 验证结果（实现轮抄录）

### 2.1 Wiki 身份

| 验证 | 结果 |
| --- | --- |
| request / resolved template / page / rev / timestamp / canonical bytes / SHA | PASS；`Template:Data Jhin/W` → `Template:Data Jhin/Deadly Flourish` / 1307581 / 4021795 / 2026-05-21T13:25:33Z / 2942 / `14790ca0…788c65` |
| sidecar / pages | `数据参考/lol-wiki-current-champions/normalized/generic/jhin-w.json` plus pages sibling 权威 |
| local raw caveat | 2940 bytes / SHA `76790ba5…67f78b`；sidecar/pages 权威；非字节等价主张；非源矛盾 |
| sourceCount | 仍为 12（9 active + 3 generators）；无新源 |
| only-one-row invariant | G8/Unified 对该 candidateKey 仅一行；ordered keys 不变 |

### 2.2 Wasm / Go

| 验证 | 结果 |
| --- | --- |
| focused JhinDeadlyFlourish | PASS（6 top-level / 7 named subtests） |
| `-count=100` | PASS |
| `go test -count=1 ./...` | PASS |
| `go run ./cmd/bench` | PASS |
| 标准 TinyGo / Wasm build | PASS；产物 **1,169,377** bytes；SHA256 `65A4C6F848E614791509A9C849518A3D50C2EF1AF4FBCFA55823E56CA1D7C6A0` |
| Node canonical compile/run/release smoke | PASS |
| exact commit | `d62d2e4` |
| 实现 run | `run-c3427736-be29-4b92-9378-a43b618a58c7`；runDelta1/outside0；941 events / 100 calls；strict；无 truncation |
| 生产 Wasm / Web 写入/commit / 拷贝 | **无** |

### 2.3 Backend

| 验证 | 结果 |
| --- | --- |
| owning focused Jhin/Jinx/Kai'Sa static SQL | PASS（**27/27**）；owning `4903c00` |
| owning full Maven | PASS（**839/839**）；run `run-7efdfc0a-e2fe-414e-be04-93ea0803ec09`；runDelta3/outside0；843 events / 74 calls |
| seed / JUnit SHA256 | seed `0759F3090FF6DBBFC4BAA0F32E2C6AE0273A3A27A78E83CD135873352458DC92`；JUnit `DDAFC3110337AECD3A73ACE37B068BA98AC1F0EE5DB0EE45526D2275C8B2F0B7` |
| 集成 Jhin+Jinx | PASS（**18/18**）；集成 `0c103f8`；run `run-3e62e677-8a05-4053-99cf-758e3b62bf3b`；README +27；两 source hash 精确匹配 owning |
| 集成 legacy peer | Draven 与 Kai'Sa 无关 LF/CRLF-hardcoded `must BEGIN` caveat 仍在；本轮**未**重跑/修复；**不得**主张集成全量；owning 27/27 与 839/839 仍为权威 |
| seed 合同 | `db/game_manage/seeds/lol_generic_jhin_deadly_flourish_primary_hit_seed.sql` + `LolGenericJhinDeadlyFlourishPrimaryHitSeedSqlTest`；一笔二元物理；`hero_jhin`/ad/mana external-existing-data/check-only；不物化 identity/panel/resource；standalone |
| live seed execution | **未**执行 |

### 2.4 Web

| 验证 | 结果 |
| --- | --- |
| 本机制 Web 源码 / 资产写入 / commit / 拷贝 | **无** |
| 当前源资产 | **1,169,377** / SHA256 `65A4C6F848E614791509A9C849518A3D50C2EF1AF4FBCFA55823E56CA1D7C6A0`（Built 与 Web 源资产同字节/同 SHA；与标准 Wasm build 精确一致） |
| Playwright / live E2E | **未**执行 |
| 当前状态说明 | Web 资产对本 test-only Wasm 追加保持同步不变；**不是** bilateral runtime 替代 |

### 2.5 G8 / Unified

| 验证 | 结果 |
| --- | --- |
| G8 / Unified generator generate + `--check` | PASS；242/254 keys/order 不变；仅 Jhin W 记录/机制语义变化（metadata source hash/generatedAt 除外） |
| Jinx W + Xayah W/Q/R canonical object hashes | 不变：G8 Jinx W `00d140f215c25650c470c6a9f92df40503bf789584db32eaee30085d0aca0291`；Unified Jinx W `7fcee85ef9bd765731458226c08b3168701d79bca71064dfa43ef399f9c72946`；G8 Xayah W `dd91a84a1e307ab4540b9d0f422c3715334ecdac3ac01580c5cb04859f6d938f`；Unified Xayah W `b03237eb01927cccdfa38f2abacd12f2cf0a17cf0b5bbcde75f06b7870b45ed4`；G8 Xayah Q `8305be23180eab1fb0189710defbf546deb1e9bdd0b935119a05ed37dda823ba`；Unified Xayah Q `83a2402fd27bf0f2a32d39ce81049b9f4af939333b6519b4532a9703c8fd13a5`；G8 Xayah R `0eaf18abcec2ee5a43b60bad60b42594e87f28cf69ded46512d18fd9228906c9`；Unified Xayah R `39b10cd4e39794f7cbbd187f4d580b7d48778fa6b5505ceac8d2e505571d4a79` |
| G8 governed 最终字段 | `genericClassification=migrated`；exact 三 tags（序同上）；空 `remainingGap`；raw upstream `blocked_data`/`meta`/`OOS` 仅 provenance |
| Unified 254 | sourceCount 12；completed 83 / partial_actionable 0 / ready_to_implement 0 / blocked_runtime 90 / blocked_data 3 / out_of_scope 72 / regression_only 5 / stale_or_duplicate 1 |
| coverage | full 83 / partial 3 / none 168 |
| actionable | 0 |
| G8 242 | migrated 73 / partial 4 / blocked 96 / OOS 69；inScope 173 |
| `implementation_gap_no_unresolved_data_fields` | 73 |
| `actionableKeyCount=0` | 当前事实；**不是**停工条件；**未**声称总体 254 机制 Goal 完成 |

### 2.6 审计切片

| 验证 | 结果 |
| --- | --- |
| 审计 commit | `fc6f854` |
| 审计 run | `run-858cab7f-3782-47a3-86cc-25010fcd978e`；runDelta6 / outside0；1157 parseable / 187 calls；strict；无 truncation；G8/Unified generate+`--check` PASS；仅 Jhin W 机制对象变化 |
| live migration / Admin publish / push / browser E2E | 未执行 |

### 2.7 设计门控笔记

| 验证 | 结果 |
| --- | --- |
| 有效设计门控 | READY `run-619cf912-b707-4dfa-95d1-eb4125b28921` |
| 非阻塞笔记 | 仓库无 Jhin identity/AD/mana materializer → Backend external-existing-data/check-only；local raw caveat only；raw G8 OOS/meta 仅 provenance |
| Standalone / total AD | 不合成 Batch-B/sibling；公式为 total AD，不是 bonus AD；小兵减伤排除 |

## 3. 本 Cursor 切片执行的治理命令

| 验证 | 结果 |
| --- | --- |
| `task_rules.json` JSON 语法 | PASS（tasks=96；本切片写入后） |
| `node tools/task-governance/cli.mjs check` / rebuild | **未**执行（主会话将在 review 后 `check → rebuild → check`） |
| `git diff --check` / 变更路径核对 | PASS；仅四条 allowlist 路径变更 |
| SQLite / `--fix-headers` | **未**触碰 |

## 4. 已实现边界

已实现：Rank-5 active cost/cooldown；immediate primary-champion single physical hit scaffold；一笔非暴击/不可复制物理 `210+0.50*totalAD`（二元）；CD/mana 探针（t0/t11999/t12000；mana69 resource skip）；自动 `ability_started`；standalone provider；Web 资产与当前 build 同步且本轮不变。排除（completed-boundary exclusions；**非** remaining data/runtime blockers；**非**已建模近似）：cast timing、direction/range/width/line geometry/multitarget/champion collision、projectile/interception/spell shield/facing、mark creation/detection/duration、root/control/tenacity、bonus movement speed、minion reduction、other ranks、other Jhin abilities/passives、equipment/loadout/crit/on-hit、live/E2E/full-game/full-skill fidelity。`actionableKeyCount=0` **不是**停工条件；**未**声称总体 Goal 完成；**未**声称排除行为已实现或完整 Deadly Flourish 保真。
