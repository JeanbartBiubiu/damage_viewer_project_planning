TASK_KEY: wasm-generic-draven-spinning-axe
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-14

# 通用 ABI 德莱文 Q 旋转飞斧 Spinning Axe 机制验证记录

详细设计：[通用 ABI - 德莱文 Q 旋转飞斧（Spinning Axe）rank5 初斧机制详细设计](../../详细设计/wasm/通用ABI-德莱文Q旋转飞斧SpinningAxe机制详细设计.md)。

## 1. 范围与提交

已闭环候选为 Draven Q / Spinning Axe **rank5 初斧**（游戏语义 `partial`）：Q cast 武装 source-owner timed `spinning_axe_ready`（max1、5800ms、`refresh_on_write`）；首次 `basic_attack_hit` 造成 physical `raw = 60 + 1.15 * (resolvedAD - baseAD)`，`copyable_on_hit=false`，随后 consume。交叉：AD162/base62、armor100 → raw175、mitigated87.5。英雄 baseline level1：hp675 / mana361 / ad62 / AS0.679 / armor29 / MR30 / hpregen3.75 / manaregen8.05；`statsByLevel` complete，AD growth 3.6。

| Worktree | Commit | 内容 |
| --- | --- | --- |
| Backend | `b948aef` | `lol_generic_draven_spinning_axe_seed.sql` 与静态 SQL 契约测试 |
| Wasm | `121b339` | Q cast arm / timed ready / first-hit physical consume 与 G8 JSON/CSV 重生成 |
| Web | `b36e48d` | combat-data assembler 的 Spinning Axe 投影回归 |

跨 worktree 交付提交已齐；本 Planning 记录只固化证据，不执行 live migration、Admin publish 或浏览器对 live backend 的 E2E。接斧 rearm、双斧上限、45 mana、8s CD、其它 rank、落地位移、W/E/R 均未建模。

## 2. Backend

| 验证 | 结果 |
| --- | --- |
| `mvn -Dtest=LolGenericDravenSpinningAxeSeedSqlTest test` | PASS，11/11 |
| `mvn test` | PASS，286/286 |

静态合同确认 rank5 初斧 only：ability_started 武装、timed `spinning_axe_ready` max1/5800/`refresh_on_write`、首次 hit physical formula、`copyable_on_hit=false`；无接斧 rearm、双斧、mana/CD、其它 rank、W/E/R、DDL 或自动 publish。

## 3. Wasm

| 验证 | 结果 |
| --- | --- |
| Draven Spinning Axe target test | PASS：Q cast arms ready；first hit raw175 / armor100⇒87.5；consume；独立公式 |
| `go test` / build / smoke / bench | PASS（全量目标回归） |

实现只复用现有 provider state、ability_started 武装、basic_attack_hit consume 与 physical/armor pipeline，无 runtime/DDL 扩展。

## 4. Web

| 验证 | 结果 |
| --- | --- |
| combatDataAssembler projection / Vitest | PASS（本批次） |
| `npm run lint` | PASS（本批次） |
| `npm run typecheck` | PASS（本批次） |
| build | PASS（本批次） |

Assembler 回归确认 rank5 初斧合同投影；未宣称 live publish、接斧或完整英雄技能轮转。

## 5. G8 与治理

`node 最小验证/数据/build-generic-g8-adc-passive-coverage-audit.mjs --check` PASS。Draven Q exact generic 为 `partial`，证据指向本 task，并允许 `sourceWorktree=wasm`（与 backend 并列）。Batch-G 该行 `already_covered` 且 `levelDataStatus=complete`。聚合为 `migrated=20 / partial=5 / blocked=179 / out_of_scope=38`；migrated-only 为 `8.26%`（all）/`9.80%`（in-scope），migrated+partial 为 `10.33%`（all）/`12.25%`（in-scope）。证据记录 25 条。Input SHA-256 `4b882f720c36a25e38a8ce01d957d6dfa7cf247d8f488aec8c26d14ba1721fd4`。

`node tools/task-governance/cli.mjs rebuild` 与 task/docs query 通过。rebuild 报告的既有 unassigned docs / 缺失 review archive 与本任务无关，未修改。本项不宣称 G8 全量 goal 已完成。

## 6. 残余风险

已实现：rank5 初斧 Q cast→timed ready→首次普攻物理加成与抗性结算。未建模：接斧 rearm、双斧 cap、45 mana、8s CD、其它 rank、landing movement、W/E/R、live migration/publish/E2E。后续不得把本 partial 误计为完整旋转飞斧闭环。
