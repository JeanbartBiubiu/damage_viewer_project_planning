TASK_KEY: wasm-generic-min-validation-coverage-audit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: active
EXECUTION_MODEL: gpt-cursor
LAST_TRACKED_AT: 2026-07-20

# V2 Batch 6610 光盾打击机制闭环计划

## 方案版本

`sundered-sky-6610-v2`

## 数据真源与边界

- 唯一数值真源：League Wiki `Module:ItemData/data`；`current-items.raw.lua` revid `4030984`，SHA256 `e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d`。
- item `6610` 经典静态面板：`hp=400`、`ad=45`、`ability_haste=10`。
- 当前经典模式 1v1 伤害分支：对英雄的下一次普通攻击必定暴击；Wiki `critical damage|60|80` 表示当前总暴击伤害 `160%`（`60% bonus damage`），其中 `80%` 是 Infinity Edge ratio，不是 melee 分支；每个目标冷却 `10000ms`。
- 明确排除：治疗、溢出治疗转临时额外生命、Infinity Edge/其它暴击伤害修改器组合、Arena 特殊文本、非英雄、多目标长期并存状态、live migration/publish。

## 现有能力与实现合同

- 不新增 TinyGo 生产 runtime、ABI 字段、DDL 或 reserved vocabulary；Backend worktree 的 `reserved_types_seed.sql` 已有 `20277-20280`，复用现有 C2 暴击阶段：
  - `command/crit`
  - `stage/crit_chance_pre_settlement`
  - `stage/crit_multiplier_natural_branch`
  - `stage/crit_multiplier_forced_branch`
- Provider `provider_item_6610_lightshield_strike` 挂载 `item_6610`，声明 `state_scope/provider_target` 状态 `lightshield_strike_cooldown`：default0、max1、`duration_ms=10000`、`refresh_duration`。
- 三个 `channel/basic_damage` pipeline modifier 共享条件 `provider.target_state.lightshield_strike_cooldown == 0`：
  - 暴击概率 `override 1`
  - 自然暴击分支乘数 `override 1.60`
  - 强制暴击分支乘数 `override 1.60`
- 同时以 absolute `override 1.60` 覆盖 natural/forced 两个分支，禁止照搬 2512 的 forced `multiply 0.80`；确保基础暴击率 `p=0/0.25/1` 时本次强化攻击都精确为 `1.60 × raw`，不会产生 `p` 相关混合乘数；本批次明确只证明无 Infinity Edge/无其它暴击伤害修改器的单装备合同。
- Listener 匹配 `event/basic_attack_hit + event/source_owner`；当目标冷却为 0 时，在伤害与 emit 完成后对当前 target 写 `provider_target cooldown=1`。因此本次攻击先获得强化，后续攻击在 `[hit, hit+10000ms)` 不强化，精确到期后重新可用。
- 当前 generic host 为 1v1 单目标；provider_target 的多目标长期并存能力不作为本批次完成条件。

## Backend 写入范围

- 新增 `db/game_manage/seeds/lol_generic_sundered_sky_6610_seed.sql`。
- 新增 `server/data_manage/src/test/java/xyz/game/datamanage/db/LolGenericSunderedSky6610SeedSqlTest.java`。
- Seed 必须幂等、自包含 ensure/reuse `item_6610`、写 Wiki 静态属性、provider/state/formulas/modifiers/listener/sequence/state-change detail 和 item mount；仅 material change 推进 candidate revision。
- 不修改 `reserved_types_seed.sql`、Schema、生产 Java、其它现有 seed；实际 Backend worktree 已有 `command/crit` 与三个 crit stage，且 2512 Backend seed/test 已落地；不 DELETE、不自动 publish。

## Wasm 证据范围

- 新增 `wasm/tinygo_engine_v2/internal/runtime/generic_sundered_sky_6610_test.go`。
- 必须走真实 `CompileGeneric -> RunGeneric`，覆盖：
  - Wiki 静态数值和编译后 state/modifier/listener 契约
  - `p=0/0.25/1` 均得到 `chanceEffective=1` 与 `1.60 × raw`
  - natural/forced 权重保留但两个乘数均为 `1.60`
  - 第一次命中后 provider_target 冷却写入
  - `9999ms` 仍冷却、`10000ms` 精确重新可用
  - 冷却期间普通攻击回到基础 expected-crit 结果
  - 不把治疗、多目标、非英雄或其它暴击装备组合误报为完成

## Web 与治理

- Web 不新增字段：现有 combat-data DTO/assembler 已承载 provider_target state、pipeline modifier、condition formula 和 crit stages；仅做路径/现有测试证据核对，不修改 Web。
- 完成后刷新 G8 与 unified 生成物、`--check`、剩余阻塞汇总和本任务 docs 映射；治理只运行 `rebuild/check/docs`，不运行 `--fix-headers`。

## 验证与停止条件

- Backend focused Maven test、全量 `mvn test`。
- Wasm focused test、`go test -count=1 ./...`、`go run ./cmd/bench`。
- G8/unified 生成与 `--check`、相关文件 `git diff --check`、governance rebuild/check/docs。
- 若 Wiki 经典模式不能支持 absolute `1.60`、现有 C2 pipeline 无法在 provider_target 条件下同时覆盖 natural/forced、Backend worktree 缺失 `20277-20280`、必须修改生产 runtime/Schema/Web ABI，或 Cursor 出现越界写入，则停止并回到方案评审。
