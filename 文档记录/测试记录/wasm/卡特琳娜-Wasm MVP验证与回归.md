TASK_KEY: wasm-katarina-mvp
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: pending

# 卡特琳娜 Wasm MVP 验证与回归

## 1. 测试范围

本轮只验证卡特琳娜最小闭环，不覆盖通用战斗系统。

覆盖对象：
- `server/data_manage` 的 `current + bundle` 读链路
- `web/src/engine/worker.ts` 到真实 Wasm 的运行链路
- `wasm/katarina_mvp_engine` 的最小结算逻辑
- `web/src/pages/KatarinaMvpPage.tsx` 的 S0 / S1 场景页

固定样本：
- `gameId = lol`
- `versionCode = mvp_katarina_001`
- `hero_katarina`
- `hero_dummy_10000hp_100ar_100mr`
- `skill_katarina_basic_attack`
- `skill_katarina_r`
- `item_blade_of_the_ruined_king`
- `item_nashors_tooth`

本轮必须覆盖：
- `S0` 平A x10
- `S1` 完整 R
- 无装备
- 单件装备
- 双装备
- `bundle/current`
- `worker -> wasm -> done`

## 2. 风险点

- 当前 Wasm 工程采用 raw ABI bridge，不是 `wasm-bindgen`，验证时要盯住内存读写是否稳定。
- Web worker 依赖 `web/src/engine/wasm/katarina_mvp_engine.wasm` 产物，产物缺失会直接导致页面初始化失败。
- 当前最容易出错的是装备属性合并和技能参数映射，尤其是“覆盖”与“累加”的区别。
- `worker` 当前是一次性 run 后回传结果，不做复杂增量流式控制，取消逻辑只做 worker 侧短路。
- 真实 Wasm 目前只覆盖 MVP，任何超出 S0/S1 的输入都应视为未覆盖风险。

## 3. 边界测试建议

建议至少补下面这些边界：
- `stop.maxSeconds = 0`，应返回 `INVALID_INPUT`
- `plan.count = 0`，应返回 `INVALID_INPUT`
- `heroId` 不存在，应该返回 `SEMANTIC_ERROR`
- `itemId` 不存在，应该返回 `SEMANTIC_ERROR`
- `skillId` 不存在，应该返回 `SEMANTIC_ERROR`
- `overrides.baseStats` 包含未知属性 key，应该返回 `SEMANTIC_ERROR`
- 无装备、单装备、双装备三档下都应能跑通 S0 / S1
- 双装备结果不应低于无装备结果
- `bundle` 缺少 `hero_katarina` 或 `skill_katarina_r` 时，页面应显式报错，不应静默运行
- `ETag` 不一致或 bundle 过期时，应强制重拉而不是复用旧结果

## 4. 回归测试建议

建议把以下项作为每次变更后的固定回归：
- 后端 `GET /api/games/lol/versions/current` 返回 `mvp_katarina_001`
- 后端 `GET /api/games/lol/versions/69/bundle` 能返回完整 MVP bundle
- Web 页面能加载 current 和 bundle
- Web worker 能加载 `katarina_mvp_engine.wasm`
- `S0` 返回非空 samples，`executedHits == 10`
- `S1` 返回非空 samples，`actionDurationMs > 0`
- 无装备 vs 破败 vs 纳什 vs 双装备都能跑完
- 双装备 `totalDamageToEnemy > 无装备 totalDamageToEnemy`
- `worker -> wasm -> done` 协议不变，页面仍能拿到 `tick` 和 `done`

建议的数值检查：
- `S0` 基线伤害应接近当前 Wasm smoke 测试结果
- `S1` 基线伤害应接近当前 Wasm smoke 测试结果
- 同一 bundle 与同一输入重复运行，结果应一致

## 5. 失败复现步骤

### 5.1 复现 current / bundle 失败

1. 启动后端。
2. 请求 `GET /api/games/lol/versions/current`。
3. 如果不是 `mvp_katarina_001`，说明发布链路或当前环境有问题。
4. 请求 `GET /api/games/lol/versions/69/bundle`。
5. 如果 bundle 缺少卡特、假人、平A、R、两件装备，说明发布内容不完整。

### 5.2 复现 worker -> wasm 失败

1. 启动 Web。
2. 打开 `#/katarina-mvp`。
3. 如果页面在 `engineState=error` 或 bundle 加载失败，检查 `web/src/engine/wasm/katarina_mvp_engine.wasm` 是否存在。
4. 如果浏览器控制台报 Wasm instantiate 失败，检查产物是否和当前源码同步。

### 5.3 复现装备伤害异常

1. 在场景页中选择 `S0`。
2. 先跑无装备。
3. 再只选 `item_blade_of_the_ruined_king`。
4. 再只选 `item_nashors_tooth`。
5. 再同时选择两件装备。
6. 如果任一装备组合的 `totalDamageToEnemy` 低于无装备，说明装备属性累加或攻击力 / 法强映射有问题。

### 5.4 复现数值不一致

1. 用同一个 bundle 和同一个输入连续运行两次。
2. 对比 `executedHits`、`totalDamageToEnemy`、`actionDurationMs`、`samples`。
3. 任一字段不一致，说明存在非确定性或者状态污染。

## 6. 测试结论

当前仓库状态下，真实 Wasm MVP 的最小验证路径已经具备：
- `wasm/katarina_mvp_engine` 可编译出 `.wasm`
- `web/src/engine/worker.ts` 已经接入 Wasm bridge
- `web/src/pages/KatarinaMvpPage.tsx` 仍沿用 `current + bundle` 入口
- 真实 smoke 结果已确认双装备伤害高于无装备

当前更像是“可验证、可回归”的状态，不是“通用 Wasm 引擎完成”的状态。

建议结论：
- `S0` / `S1` 可以作为每次改动后的主回归用例
- 无装备 / 单装备 / 双装备必须作为最小黄金矩阵
- `current + bundle` 和 `worker -> wasm -> done` 应作为平台层固定回归点

## 7. 参考命令

构建 Wasm：
```powershell
cd wasm/katarina_mvp_engine
C:\Users\Administrator\.cargo\bin\cargo.exe build --target wasm32-unknown-unknown --release
```

刷新 Web 产物：
```powershell
powershell -ExecutionPolicy Bypass -File wasm/katarina_mvp_engine/build-web-wasm.ps1
```

构建 Web：
```powershell
cd web
npm run build
```

人工检查：
- `GET /api/games/lol/versions/current`
- `GET /api/games/lol/versions/69/bundle`
- `#/katarina-mvp` 页面中的 `S0` / `S1`
