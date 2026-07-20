TASK_KEY: wasm-generic-min-validation-coverage-audit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: active
EXECUTION_MODEL: gpt-cursor
LAST_TRACKED_AT: 2026-07-20

# V2 Batch 2512 开战弹幕机制闭环计划

## 方案版本

`opening-barrage-2512-v3`

## 数据真源

- 唯一数值真源：League Wiki `Module:ItemData/data`；`current-items.raw.lua` 是下载原文，`current-items.normalized.json` 是本地派生索引。
- item：`2512` / Fiendhunter Bolts / Opening Barrage
- Wiki item manifest：revid `4030984`，raw Lua content SHA256 `e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d`
- 采用 Wiki 当前经典模式语义：终极技能施放后，8 秒内下 3 次普攻获得 50% bonus attack speed；强制暴击造成常规暴击伤害的 80%；若该攻击原本会暴击，则保留常规暴击分支并额外造成该攻击 pre-mitigation damage 的 15% true damage；45 秒冷却从终极技能施放开始。
- `Night Vigil` 的 30 ultimate haste 不进入单目标伤害闭环。

## 数据/运行时分工

- Backend seed 负责 item/provider/ability/listener/attribute modifier 的可发布合同，不把数值写死进 generic runtime。
- Backend 现有表已能承载该合同，但 reserved vocabulary 尚缺 `command/crit`、`stage/crit_chance_pre_settlement`、`stage/crit_multiplier_forced_branch`、`stage/crit_multiplier_natural_branch`；v3 为这些 generic ABI token 分配新的 reserved type，并为 `ability/ultimate` 分配冲突保护的 game-local type。无 DDL/Java runtime 变更。
- Backend active ultimate 使用 `ability_kind/active(20130)`；`ability/ultimate(62010)` 只通过 `type_relations` 挂到 ability，`cast_origin='champion'`。不得把 game-local type 写入 `ability_kind_type_id`。
- Backend crit pipeline 行沿用现有表的非空占位约定 `target_attr_key='hp'`；AS modifier 使用 `value_policy/percent_add(20173)`；seed 对既有 `ability/basic_attack(62003)` 做双向冲突保护/ensure。
- TinyGo generic runtime 复用现有 `event/ability_started`、`event/damage_instance`、`event/basic_attack_hit`、provider timed state、per-cast throttle 和 unified crit pipeline。
- Web 本批不新增 DTO 或页面字段；generic evidence 继续通过现有 `damage` / `emitted_event` 输出。

## 状态与事件合同

Provider `item:2512` 使用三个 provider-scope 状态：

- `opening_barrage_window`：default `0`、max `1`、duration `8000ms`、`refresh_on_write`；仅由匹配 `event/ability_started + ability/ultimate + event/source_owner` 的 listener 在冷却为 0 时置 1。
- `opening_barrage_charges`：default `0`、max `3`、untimed；同一 listener 置为 3，普攻命中 listener 每次扣 1。窗口和充能分离，扣充能不刷新 8 秒窗口。
- `opening_barrage_cooldown`：default `0`、max `1`、duration `45000ms`、`refresh_on_write`；与窗口 arm 同时置 1，冷却期间阻止再次 arm。

攻击侧行为：

- source modifier：`attack_speed` `percent_add = 0.50 * window * (charges >= 1)`。
- source crit pipeline：`crit_chance_pre_settlement` 在窗口且有充能时 `override 1`；`crit_multiplier_forced_branch` 在同条件下 `multiply 0.80`；natural branch 保持常规 `crit_damage`。
- `event/damage_instance + ability/basic_attack + event/source_owner` listener 使用 `perCastThrottleMs=1`，只在每个普攻 cast 的第一条 damage instance 上执行一次；条件为窗口有效、有充能且 `event.damage.originalCritChance > 0`，追加 `0.15 * event.damage.naturalBranchRawAmount * event.damage.originalCritChance` 的 true damage。该 listener 不扣充能，避免多段普攻在同一 cast 内被提前关闭。
- `event/basic_attack_hit + event/source_owner` listener 在攻击所有伤害完成后扣 1 充能；充能归零后 modifier 立即失效。

## 非目标与边界

- 不实现随机暴击；使用 generic 的 deterministic expected-crit 语义。
- 不实现地图、距离、非英雄目标、secondary target、隐身、移动速度或完整 item haste 轮转。
- 不声称支持 Arena item `222512` 的不同数值。
- 不新增专用 2512 runtime 分支；若方案评审发现统一能力不足，先停在最小通用扩展。

## 证据与验证

- Wasm：新增 `generic_fiendhunter_bolts_2512_test.go`，覆盖 Wiki 交叉数值、ultimate arm、8 秒边界、45 秒 cooldown、三次充能、第四次不强化、自然/强制暴击两分支、15% pre-mitigation true damage、护盾/抗性管道和 per-cast 多段保护。
- Backend：扩充 `reserved_types_seed.sql` 的统一 crit vocabulary；新增 `lol_generic_fiendhunter_bolts_2512_seed.sql` 与对应 SQL contract test，验证 Wiki item 静态属性、provider/modifier/listener/operation、manifest/hash、状态 schema 和数值。
- 最小验证命令：Wasm 聚焦、`go test -count=1 ./...`、`go run ./cmd/bench`、必要时 TinyGo/Node smoke；Backend 聚焦与全量 Maven；三个清单生成器 `--check`。
- 停止条件：任何数据值不能从 Wiki manifest 复核、统一暴击/事件快照语义出现冲突、Cursor 发生越界写入，或验证未通过时，不更新为 completed。
