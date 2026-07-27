TASK_KEY: wasm-generic-min-validation-coverage-audit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: gpt-cursor
LAST_TRACKED_AT: 2026-07-20

# V2 Batch 3032 疾风骤雨机制闭环计划

## 方案版本

`yun-tal-flurry-3032-v2`

## 数据真源与边界

- 唯一数值真源：League Wiki `Module:ItemData/data`；`current-items.raw.lua` revid `4030984`，SHA256 `e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d`。
- item `3032` 经典静态面板为 `ad=50`、`attack_speed=40%`、初始暴击率 `0`；静态属性与同装备“熟能生巧”已有独立闭环，本批次不重写。
- Flurry / 疾风骤雨：对敌方英雄发起普攻后获得 `30% bonus attack speed`，持续 `6000ms`，冷却 `30000ms`；每次 on-hit 缩短该冷却 `1000ms`，若该攻击暴击则总缩短 `2000ms`。
- 当前 1v1 generic host 不模拟逐箭/弹道飞行；按用户边界以该次真实基础攻击的 `event/damage_instance` 结算点代替 launch/hit 时间差。

## 统一暴击与减冷却语义

- 当前 canonical runtime 是确定性 expected-crit，不生成随机“本次暴击=true/false”。Flurry 必须复用 C2 damage-instance 快照，不另建随机暴击分支。
- listener 匹配 `event/damage_instance + ability/basic_attack + event/source_owner`，并设置正数 `perCastThrottleMs`，保证同一 basic-attack cast 的多 damage operation/on-hit 只触发一次。
- 冷却缩减公式读取命中事件冻结值 `event.damage.effectiveCritChance`，按 `1000 + 1000 * clamp(q,0,1)` 毫秒计算；`q=0/0.25/1` 分别缩短 `1000/1250/2000ms`。强制暴击把 `q` 提升到 1，因此与自然暴击统一处理。
- 使用 damage-instance 冻结值，不读取命中后“熟能生巧”新增层数导致的 live `crit_chance`，避免当前攻击反向享受后置叠层。

## 通用 runtime 原语

- 新增 operation kind `state_duration_change`，复用现有 `OperationDefinition` 字段：`target=source|self`、`ref=<stateKey>`、`amount=<milliseconds formula>`、`valuePolicy=subtract`、`types=[state_scope/provider|state_scope/provider_target]`。
- 该 operation 只允许命中已声明 `durationMs>0` 的 timed provider state；compile collect-all 拒绝未知 state、无定时元数据、非 subtract policy、缺 amount/ref、非法 target/scope 和无 provider context。
- 运行语义：先 lazy-expire；若当前计时器未激活则 no-op；对 `amount` 做 finite/non-negative 校验并确定性四舍五入到整数毫秒；`expireAt=max(nowMs, expireAt-deltaMs)`。它不改变 state 数值、不刷新 duration；若缩减后到期，立即恢复 defaultValue 并清零 timer。
- provider_target 同样支持；缩短后调度新的更早 expiry。既有较晚 expiry 事件必须通过 expected expiry 校验成为 stale no-op，不得二次清理新周期。
- 真实目标 Backend worktree `C:\project\damage_backend_dev` 已有 `value_policy/subtract` `20176`、`event/damage_instance` `20217`、`command/crit` 与 `20277-20280` 暴击阶段，并已具备 `provider_listeners.per_cast_throttle_ms` 的 schema/log/mapper/service/test 链路；不得以 Wasm worktree 内旧 Backend 副本反向否定这些当前能力。
- 真实目标 Web worktree `C:\project\damage_web_dev` 已有 `ProviderListener.perCastThrottleMs`、generic `ListenerDefinition.perCastThrottleMs`、assembler 透传与兼容性测试。
- 本批唯一新增 reserved vocabulary 是 `operation/state_duration_change`（使用当前未占用 `20281`，父类 `10015`）；不得重复新增或覆盖上述现有类型与字段。

## 3032 provider 合同

- 新建独立 provider `provider_item_3032_yun_tal_flurry` 并作为第二个 provider mount 到 `item_3032`；不修改“熟能生巧” provider/seed 的职责。
- provider state：
  - `flurry_active`: default 0、max 1、duration `6000ms`、`refresh_on_write`。
  - `flurry_cooldown`: default 0、max 1、duration `30000ms`、`refresh_on_write`。
- provider modifier：owner-self `attack_speed`、`percent_add`、值 `0.30 * provider.state.flurry_active`。
- 单 listener 的 operation 顺序固定：
  1. 当 `flurry_cooldown==0` 时把 `flurry_active` override 为 1；
  2. 当 `flurry_cooldown==0` 时把 `flurry_cooldown` override 为 1；
  3. 对 `flurry_cooldown` 执行 `state_duration_change/subtract`，amount 为 expected-crit 缩减公式。
- 因此触发攻击也在 damage-instance 结算时缩短新启动的冷却；冷却期间后续命中只执行第 3 步，且不会刷新 6 秒攻速窗。

## 写入范围

### Backend

- 在真实 Backend worktree 修改 `db/game_manage/seeds/reserved_types_seed.sql`，仅追加 `20281 operation/state_duration_change` 及父类映射，保留既有 `20176`、`20217`、`20277-20280` 和其它脏改。
- 新增 `db/game_manage/seeds/lol_generic_yun_tal_flurry_3032_seed.sql`。
- 新增 `server/data_manage/src/test/java/xyz/game/datamanage/db/LolGenericYunTalFlurry3032SeedSqlTest.java`。
- 不修改旧 `lol_generic_yun_tal_practice_makes_lethal_seed.sql` 及其测试；旧测试继续证明旧 seed 自身未混入 Flurry。

### Wasm

- 最小修改 `internal/model/generic_compile.go`、`internal/compile/generic.go`、`internal/runtime/generic_execution.go`、`internal/runtime/generic_provider_state.go`，必要时在相邻新测试文件补 compile/runtime 契约。
- 新增 `internal/runtime/generic_yun_tal_flurry_3032_test.go`；不得修改 canonical fixture。
- 不新增 ABI JSON 字段，不修改 legacy DPS。

### Web

- 无新增写入：真实 Web worktree 已投影 `perCastThrottleMs`，operation/valuePolicy/type catalog 均为字符串透传。复用现有 assembler contract test 做回归；不得修改 Wasm worktree 内的旧 Web 副本。

## 验证

- Backend focused：新 seed SQL contract test 与 reserved vocabulary 相关测试。
- Backend full：`mvn test`。
- Wasm focused：compile contract + 3032 runtime tests，覆盖 `q=0/0.25/1`、首次攻击启动并缩减、6s AS 到期、不刷新 buff、30s 冷却多次缩短、精确重触发边界、同 cast 多 damage op 只减一次、强制暴击、无活动 timer no-op、负/非 finite fail-closed、stale expiry no-op。
- Wasm full：`go test -count=1 ./...` 与 `go run ./cmd/bench`。
- Web：运行包含 `castOrigin and perCastThrottleMs projection` 的 assembler targeted test，再执行现有全量 test/typecheck/build；若仅为已存在脏改的独立失败，不扩大本机制写入范围。
- 闭环后更新 G8/unified 生成器与 JSON/CSV、剩余阻塞汇总、task docs 映射；目标计数为 `completed +1`、`blocked_runtime -1`、`actionableKeyCount=0`。

## 非目标与停止条件

- 不实现 RNG、逐箭飞行、非英雄目标、多目标战斗、Arena、live migration/publish、commit/push。
- 不将同装备“熟能生巧”重算为新机制，不改旧 seed 边界。
- 若真实目标 worktree 中 damage-instance 无法稳定做到每 basic-attack cast 一次、`effectiveCritChance` 不是最终结算概率、reserved id `20281` 已占用、Backend/Web throttle 链路当前证据失效，或 timer stale-event 无法 fail-closed，则停止编码并返回证据。
