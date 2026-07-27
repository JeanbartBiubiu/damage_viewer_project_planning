TASK_KEY: wasm-generic-min-validation-coverage-audit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: active
EXECUTION_MODEL: gpt-cursor
LAST_TRACKED_AT: 2026-07-20

# V2 Batch 3073 过载机制闭环计划

## 方案版本

`experimental-hexplate-3073-v1`

## 数据真源与边界

- 唯一数值真源：League Wiki `Module:ItemData/data`；`current-items.raw.lua` revid `4030984`，SHA256 `e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d`。
- item `3073` 经典静态面板：`ad=40`、`attack_speed=0.20`、`hp=450`。
- ranged 1v1 伤害分支：终极技能成功施放后获得 `+50% bonus attack speed`，持续 `8000ms`，冷却 `30000ms` 且从终极施放开始计时。
- 明确排除：Hexcharged 的 30 终极技能急速、`+20% movement speed`、melee `35%/14%` 分支、Arena、非英雄/多目标、live migration/publish。

## 跨层合同

- Backend 新增自包含幂等 seed 与静态 SQL contract test；复用 game-local `62010 ability/ultimate`、reserved `20190 refresh_duration`、`20205 ability_started`、`20212 source_owner`，不新增 DDL、reserved vocabulary 或生产 Java runtime。
- Provider `provider_item_3073_overdrive` 挂载 `item_3073`，状态为 `overdrive_active`（max1/8000ms）和 `overdrive_cooldown`（max1/30000ms），均 `refresh_on_write`；默认值 0 由注释记录，因为表无 default 列。
- Ability `ability_item_3073_overdrive_ultimate` 使用 `ability_kind/active(20130)`、`cast_origin=champion`；`62010` 只通过 `type_relations` 绑定，不写入 `ability_kind_type_id`。
- Arm listener 使用 `ability_started + ability/ultimate + source_owner` 全匹配，冷却为 0 时按 active/cooldown 两个 state-change step 武装。
- Attack-speed modifier 使用 `percent_add(20173)`，值为 `0.50 * overdrive_active`；无专用 runtime 分支。

## Wasm 证据

新增 `generic_experimental_hexplate_3073_test.go`，覆盖 CompileGeneric/RunGeneric、Wiki 数值、类型/施法来源、终极匹配、非终极拒绝、`+50% AS`、`8000ms` 到期、`30000ms` 冷却边界与重复施放。测试不声称移速或终极急速已实现。

## 验证与停止条件

- Backend focused/full Maven；Wasm focused/full Go test 与 `go run ./cmd/bench`。
- 任何 Wiki/hash 不可复核、62010/表契约冲突、需要 DDL/生产 runtime、越界写入或把移速/急速误报为完成时停止。
