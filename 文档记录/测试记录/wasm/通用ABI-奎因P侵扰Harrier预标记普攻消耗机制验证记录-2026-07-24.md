TASK_KEY: wasm-generic-quinn-harrier-premarked-consume
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: pass
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-24

# 通用 ABI 奎因 P 侵扰 Harrier 预标记普攻消耗机制验证记录

详细设计：[通用 ABI - 奎因 P 侵扰（Harrier）预标记普攻消耗机制详细设计](../../详细设计/wasm/通用ABI-奎因P侵扰Harrier预标记普攻消耗机制详细设计.md)。

## 1. 范围与证据边界

已闭环候选 `hero_skill|hero_quinn|P|侵扰`：`completed/full/generic_runtime`（G8 governed `migrated` exact override；保留 raw baseline provenance）。Wiki：请求 `Template:Data Quinn/I`，解析 `Template:Data Quinn/Harrier`；page `1308953` / rev `4024765` / timestamp `2026-06-03T00:49:03Z`；canonical raw bytes `2390`；SHA256 `740debfb3b72dd7f926337f7eb4adbe3a65c88caec227ca16e00dff6634f798c`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/quinn-p.json`；sourceCount **仍为 12**（9 active + 3 generators；无新源）。本地 raw materialization 亦为 `2390` bytes / SHA256 `08853c2c25ada7769e25908123dbb56f7b14dc0c1479a8a5842693874849a731`——**local raw materialization caveat**；sidecar/pages 为权威身份；**故意不断言**字节等价，**不是**源矛盾。边界：`level18_preexisting_harrier_target_single_basic_attack_consume; bonus_physical_120_plus_0_40_bonus_ad; preserve_heightened_senses_arm; no_mark_generation_ability_application_duration_reveal_valor_targeting_monster_bonus_r_disable_parry_or_other_levels`。governed tags 序：`on_hit`、`formula_on_hit`、`bonus_ad_ratio`、`copyable_on_hit_false`、`provider_target_state_consume`。合同：level18 预存在 Harrier 目标上 owner `basic_attack_hit` → 同既有 W provider 有序 arm `heightened_senses_active=1` → 恰好一笔非暴击/不可复制物理 `120+0.40*(resolvedAD-baseAD)`（嵌套二元 `add`）→ consume mark（Backend `20110+20252` / Wasm `source`+`provider_target`）；无 mark 不触发。交叉：bonusAD80→raw152/armor100 mitigated76；baseline raw120/mitigated60；t0/t3000 两次 AA 仅一次 P bonus；W→P 与 P→W listener 顺序结果相同。**不**宣称 mark generation / duration / Valor / monster75 / R disable / parry / W AS 幅度校正或完整 Harrier/游戏保真；**未**声称总体 Goal 完成。

本文件由 **Cursor 文档/治理切片**（`FROZEN_PLAN_REV: quinn-p-harrier-premarked-consume-phase-a-v2`；DESIGN_REVIEW READY `run-e139d9f9-e2bb-4333-835a-8f186c6d4008`，strict `grok-4.5`，effort high，fast false，runDelta0/diff0，2037 parseable，55 unique direct tool calls completed，无 truncation/orphans，无 user decision；较早 v1 REVISE 因一步 orphaned wrong-path read **不是**干净门控；selector/`20110+20252` 发现已吸收进 v2；运行时/审计已提交）创建。下列验证结果按实现与驱动复验记录抄录；**未**在本切片重跑实现测试。记录日期权威为 **2026-07-24**。

本轮**未**执行 live migration、Admin publish、push 或 browser E2E。本切片**未** rebuild SQLite / **未** `--fix-headers`。**无**生产 Wasm 或 Web 写入/commit。

| Worktree / 阶段 | Commit / Run | 内容 | 证据地位 |
| --- | --- | --- | --- |
| DESIGN_REVIEW READY | `run-e139d9f9-e2bb-4333-835a-8f186c6d4008` | READY；2037 parseable；55 calls completed；runDelta0/diff0；无 truncation/orphans；无 user decision | **接受门控**；v1 REVISE 非干净门控；selector 发现已吸收 |
| Backend owning / 集成 | owning `0a6301e`；集成 `12d9281`；`run-391e437d-0b99-49de-9570-1b6eeadf208b` | delta3/outside0；960 events；46 unique calls completed；无 truncation；focused8/8；full Maven **797/797**；无 live seed | 接受 |
| Wasm exact | `7c84b36`；`run-a3e0519c-b956-4b5d-8f23-b0c7560026a9` | delta1/outside0；1010 events；61 unique calls；一笔 orphaned read-only grep；无 truncation；diff 独立复核；`-count=100` + full Go PASS | 接受 |
| Web | 无本机制写入 | 资产保持 `1,169,377` / `65A4…C6A0` 同步不变 | 接受；test-only Wasm 追加后资产未变 |
| 审计 | `7c81a6b`；`run-9d0ecd29-e7bd-45d5-9361-824faba46b1b` | G8/Unified/registry/Batch-G；delta6/outside0；1042 events；92 unique calls completed；无 truncation；仅 Quinn P 语义对象变化 | 接受 |

## 2. 验证结果（实现轮抄录）

### 2.1 Wiki 身份

| 验证 | 结果 |
| --- | --- |
| request / resolved template / page / rev / timestamp / canonical bytes / SHA | PASS；`Template:Data Quinn/I` → `Template:Data Quinn/Harrier` / 1308953 / 4024765 / 2026-06-03T00:49:03Z / 2390 / `740debfb…798c` |
| sidecar | `数据参考/lol-wiki-current-champions/normalized/generic/quinn-p.json` |
| local raw caveat | 2390 bytes / SHA `08853c2c…a731`；sidecar/pages 权威；非字节等价主张；非源矛盾 |
| sourceCount | 仍为 12（9 active + 3 generators）；无新源 |
| only-one-row invariant | G8/Unified 对该 candidateKey 仅一行；ordered keys 不变 |

### 2.2 Wasm / Go

| 验证 | 结果 |
| --- | --- |
| focused `generic_quinn_harrier_premarked_consume_test.go` `-count=100` | PASS |
| `go test -count=1 ./...` | PASS |
| 标准 `scripts/build-wasm.ps1` TinyGo / Wasm build | PASS；产物 **1,169,377** bytes；SHA256 `65A4C6F848E614791509A9C849518A3D50C2EF1AF4FBCFA55823E56CA1D7C6A0`（相对既有标准 build **未变**） |
| Node canonical compile/run/release smoke | PASS |
| exact commit | `7c84b369688d67017182e090cc5dc88fdef15d37` |
| 实现 run | `run-a3e0519c-b956-4b5d-8f23-b0c7560026a9`；delta1/outside0；1010 events；61 unique calls；一笔 orphaned read-only grep；无 truncation；diff 独立复核 |
| 生产 Wasm 写入/commit | **无** |

### 2.3 Backend

| 验证 | 结果 |
| --- | --- |
| owning focused JUnit | PASS（8/8）；owning `0a6301e70a85c6e677c8ce26a746d170bafe784f` |
| owning full Maven | PASS（**797/797**）；集成 `12d92810147ccfb626edfc3e26795551c01c2585` |
| 实现 run | `run-391e437d-0b99-49de-9570-1b6eeadf208b`；delta3/outside0；960 events；46 unique calls completed；无 truncation |
| seed 合同 | `db/game_manage/seeds/lol_generic_quinn_p_harrier_premarked_consume_seed.sql` + `LolGenericQuinnPHarrierPremarkedConsumeSeedSqlTest` + README；扩展既有 W provider；W 行 check-only；`20110+20252`；嵌套二元 `120+0.40*bonusAD` |
| live seed execution | **未**执行 |

### 2.4 Web

| 验证 | 结果 |
| --- | --- |
| 本机制 Web 源码 / 资产写入 / commit | **无** |
| 当前源资产 | **1,169,377** / SHA256 `65A4C6F848E614791509A9C849518A3D50C2EF1AF4FBCFA55823E56CA1D7C6A0`（与标准 Wasm build 精确一致；本轮 test-only Wasm 追加后**保持同步且不变**） |
| Playwright / live E2E | **未**执行 |
| 当前状态说明 | Web 资产对本 test-only Wasm 追加保持同步不变；**不是** bilateral runtime 替代 |

### 2.5 G8 / Unified

| 验证 | 结果 |
| --- | --- |
| G8 / Unified / registry / Batch-G checks | PASS；242/254 keys/order 不变；仅 Quinn P 记录/机制语义变化（metadata source hash/generatedAt 除外） |
| G8 governed 最终字段 | `genericClassification=migrated`；exact 五 tags（序同上）；空 `remainingGap`；保留 raw baseline provenance |
| Unified 254 | sourceCount 12；completed 78 / partial_actionable 0 / ready_to_implement 0 / blocked_runtime 95 / blocked_data 3 / out_of_scope 72 / regression_only 5 / stale_or_duplicate 1 |
| coverage | full 78 / partial 3 / none 173 |
| actionable | 0 |
| G8 242 | migrated 68 / partial 4 / blocked 101 / OOS 69 |
| Wiki-only registry check | candidate 242；migrated 48 / partial 5 / blocked 120 / OOS 69 |
| `implementation_gap_no_unresolved_data_fields` | 78 |
| `actionableKeyCount=0` | 当前事实；**不是**停工条件；**未**声称总体 254 机制 Goal 完成 |

### 2.6 审计切片

| 验证 | 结果 |
| --- | --- |
| 审计 commit | `7c81a6b04d3085dbefee93055b9cfbcb32460059` |
| 审计 run | `run-9d0ecd29-e7bd-45d5-9361-824faba46b1b`；runDelta6 / outside0；1042 events；92 unique calls completed；无 truncation；四 generator checks PASS；直接语义比较证明 G8/Unified key order 不变且仅 Quinn P 对象变化 |
| live migration / Admin publish / push / browser E2E | 未执行 |

### 2.7 设计门控笔记

| 验证 | 结果 |
| --- | --- |
| 有效设计门控 | READY `run-e139d9f9-e2bb-4333-835a-8f186c6d4008` |
| 较早 v1 | `quinn-p-harrier-premarked-consume-phase-a-v1` 为 `REVISE`；因一步 orphaned wrong-path read **不是**干净门控；selector/`20110+20252`（Wasm `source`+`provider_target`）发现已吸收进 v2 |

## 3. 本 Cursor 切片执行的治理命令

| 验证 | 结果 |
| --- | --- |
| `task_rules.json` JSON 语法 | PASS（tasks=91） |
| `node tools/task-governance/cli.mjs check` | PASS（tasks=91；invalid_rules/duplicate_assignments/missing_docs/invalid_headers/unassigned_docs 全 0；只读；**未** rebuild SQLite；**未** `--fix-headers`） |
| `git diff --check` / 变更路径核对 | PASS；仅四条 allowlist 路径变更 |
| `node tools/agent-governance/cli.mjs check`（只读） | 既有 peer content_drift=3：`task_rules.json` @ `damage_viewer_project_planning` / `damage_backend_dev` / `damage_web_dev`；仅报告；**不** sync |

## 4. 已实现边界

已实现：level18 预存在 Harrier 目标上 owner 普攻消耗；同既有 W provider 有序 arm active → 单次非暴击/不可复制物理 `120+0.40*(resolvedAD-baseAD)`（嵌套二元）→ consume mark（`20110+20252` / source+provider_target）；bonusAD80→152/76 与 baseline120/60；无 mark 不触发；t0/t3000 仅一次；双 listener 顺序相等；Web 资产与当前 build 同步且本轮不变。排除（completed-boundary exclusions；**非** remaining data/runtime blockers；**非**已建模近似）：mark generation（Q/E/Skystrike/Valor）、duration/reveal/overwrite/cooldown、targeting/AI、monster75、R disable、parry、levels1–17、multitarget/loadout/crit/replication、W AS magnitude correction、live/E2E/full-game/full-skill fidelity。`actionableKeyCount=0` **不是**停工条件；**未**声称总体 Goal 完成；**未**声称排除行为已实现或完整 Harrier 保真。
