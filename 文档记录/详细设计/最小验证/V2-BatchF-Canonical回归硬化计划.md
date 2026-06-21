TASK_KEY: planning-validation-milestones
DOC_TYPE: 详细设计
WORKSTREAM: planning
STATUS: draft
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-05-19

# V2 Batch F Canonical 回归硬化计划

关联概要：[验证里程碑V2.md](../../概要设计/验证里程碑V2.md)

关联总方案：[V2-单攻击方DPS协议与开发计划.md](./V2-单攻击方DPS协议与开发计划.md)

前置测试记录：

1. [V2-BatchA-单攻击方DPS-测试记录-2026-05-17.md](../../测试记录/wasm/V2-BatchA-单攻击方DPS-测试记录-2026-05-17.md)
2. [V2-BatchB-英雄被动首批-测试记录-2026-05-17.md](../../测试记录/wasm/V2-BatchB-英雄被动首批-测试记录-2026-05-17.md)
3. [V2-BatchC-ADC成装属性录入-测试记录-2026-05-17.md](../../测试记录/wasm/V2-BatchC-ADC成装属性录入-测试记录-2026-05-17.md)
4. [V2-BatchD-ADC装备被动-测试记录-2026-05-17.md](../../测试记录/wasm/V2-BatchD-ADC装备被动-测试记录-2026-05-17.md)
5. [V2-BatchE-1-单英雄多曲线DPS对比页-测试记录-2026-05-18.md](../../测试记录/wasm/V2-BatchE-1-单英雄多曲线DPS对比页-测试记录-2026-05-18.md)
6. [V2-BatchE-B-多英雄同装备DPS对比页-测试记录-2026-05-19.md](../../测试记录/wasm/V2-BatchE-B-多英雄同装备DPS对比页-测试记录-2026-05-19.md)

## 1. 目标

Batch A-E 已完成单攻击方 DPS 的功能主链：基础普攻、首批英雄被动、ADC 成装属性、首批装备被动、页面 A/B 对比展示。

Batch F 不继续扩英雄或装备覆盖面，只把总方案 9.1 的 canonical case 固化成回归门槛。目标是让后续任何 runtime、adapter、页面或发布链改动，都不能无声破坏以下语义：

1. 同时间点事件顺序。
2. 动态攻速和攻速 cap。
3. DoT 到期边界。
4. 同一次攻击内 hero passive、item on-hit、DoT apply 的来源顺序。
5. blocked 输出语义。
6. 暴击策略边界。

## 2. 非目标

1. 不新增完整 1v1、敌方动作或主动技能轮转。
2. 不扩全英雄、全装备、全符文验收。
3. 不引入新的前端页面；页面只做必要 smoke 和导出字段复核。
4. 不把缺少游戏人工基线的数值写成最终人工验收通过。
5. 不为了 canonical case 新增后端 DB 字段；优先用 runtime fixture 或现有 published bundle。
6. 不在 Batch F 实现 `seeded_random` 暴击完整机制；如果 runtime 仍只支持 `expected`，则把 `seeded_random` 固化为明确 blocked 或后续 backlog。

## 3. 写入范围

默认写入：

1. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver_test.go`
2. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver.go`，仅在测试暴露语义缺口时最小修复。
3. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\model\types.go`，仅在必须补导出证据字段时修改。
4. `C:\project\damage_wasm_dev\文档记录\测试记录\wasm\V2-BatchF-Canonical回归硬化-测试记录-2026-05-19.md`
5. `C:\project\damage_wasm_dev\db\task_doc_governance\task_rules.json`

默认只读参考：

1. `C:\project\damage_web_dev\web\src\engine\tinygoV2DpsAdapter.ts`
2. `C:\project\damage_web_dev\web\src\pages\WasmValidationV2DpsPage.tsx`
3. `C:\project\damage_wasm_dev\文档记录\详细设计\最小验证\V2-单攻击方DPS协议与开发计划.md`
4. Batch A-E 测试记录。

如需要页面 smoke，可在 `C:\project\damage_web_dev\web\output\playwright\` 放临时脚本；该目录作为本地证据缓存，不作为必须提交的源码。

## 4. Case 列表

### F1 同刻 Buff 失效

目标：验证攻速 buff 在下一次普攻时刻恰好结束时，同时间点优先级稳定。

最小 case：

1. attacker 初始攻速固定。
2. 添加一个临时攻速状态，`startTimeMs=0`，`durationMs` 恰好等于第二次攻击排程时刻。
3. 期望第二次攻击使用哪一个攻速必须在测试名和断言中写死，不允许依赖当前实现偶然顺序。

证据：

1. `attackIntervalTimeline` 包含 buff 生效前后 raw/effective attack speed。
2. `attackTimeline` 的第二次和第三次攻击时间点可解释。
3. `effectBreakdown` 或状态触发记录能说明 buff 生命周期。

建议测试名：

```text
TestSingleAttackerDPSCanonicalBuffExpiresAtNextAttackBoundary
```

### F2 攻速 Cap 临界值

目标：验证 `attackSpeedCap=3.0` 下，`2.99 / 3.0 / 3.01` 三个点的排程和导出字段稳定。

最小 case：

1. 三条 curve 同批运行。
2. 三条 curve 的 raw attack speed 分别为 `2.99`、`3.0`、`3.01`。
3. `attackSpeedCap=3.0`。

期望：

1. `rawAttackSpeed` 保留原始值。
2. `effectiveAttackSpeed` 不超过 `3.0`。
3. `attackIntervalMs` 对 `3.0` 和 `3.01` 一致，对 `2.99` 略大。
4. 如果 runtime 有 overflow 字段则断言 overflow；如果没有，至少断言 raw/effective 同时存在，避免 UI 误解。

建议测试名：

```text
TestSingleAttackerDPSCanonicalAttackSpeedCapBoundary
```

### F3 DoT 到期边界

目标：验证 DoT tick 恰好落在 `expireAt` 时的处理规则固定。

最小 case：

1. 使用现有 Teemo/Twitch 类 DoT fixture，或构造最小 DoT passive。
2. `tickIntervalMs=1000`，`durationMs` 让最后一个 tick 恰好等于 expireAt。
3. 断言 tick 是否包含 expireAt 必须与总方案一致：tick 先于过期。

证据：

1. `damageTimeline` 中 DoT tick 时间点完整。
2. 最后一个 tick 的 `timeMs == expireAt`。
3. `effectBreakdown` 保留 DoT source 和 tick 序号。

建议测试名：

```text
TestSingleAttackerDPSCanonicalDotTicksAtExpireBoundary
```

### F4 来源顺序

目标：验证同一次普攻触发 hero passive、item on-hit 和 DoT apply 时，输出 source metadata 和效果顺序稳定。

最小 case：

1. 一次 basic attack 同时带：
   - hero passive on-hit。
   - item passive on-hit。
   - DoT apply。
2. 目标双抗固定，避免伤害减免引入额外变量。
3. 不要求数值贴近真实游戏，只证明事件序和来源。

期望顺序：

1. basic attack direct damage。
2. hero passive on-hit。
3. item passive on-hit。
4. DoT apply。
5. 后续 DoT tick。

如 runtime 当前顺序不同，先按现有实现写出事实，再判断是否需要修复；不能让前端通过排序掩盖 runtime 顺序。

建议测试名：

```text
TestSingleAttackerDPSCanonicalSourceOrderForAttackPassivesAndDot
```

### F5 Blocked 语义

目标：验证缺数据时 curve 进入 blocked，且不影响同批其它 curve。

最小 case：

1. 同批两条 curve。
2. 第一条 curve 数据完整，输出 `ok`。
3. 第二条 curve 故意缺少 published passive、装备 stats、target snapshot 或公式引用之一。

期望：

1. 输出保留两条 curveResults。
2. 第一条 `status=ok`。
3. 第二条 `status=blocked`。
4. 第二条 `blockedReasons` 指向缺失项，不允许空数组。
5. blocked curve 的 timeline 为空或保持约定的安全空值。

建议测试名：

```text
TestSingleAttackerDPSCanonicalBlockedCurveDoesNotPoisonBatch
```

### F6 暴击策略边界

目标：固定当前暴击策略边界，防止页面或 adapter 暗示已支持未实现策略。

当前口径：

1. V2 DPS 首期使用 `critPolicy=expected`。
2. `seeded_random` 尚未作为 DPS 主链闭环能力。

最小 case：

1. `critPolicy=expected`：证明期望暴击会影响 basic attack damage，并且导出保留 `critPolicy=expected`。
2. `critPolicy=seeded_random`：如果 runtime 不支持，必须 blocked，并在 `blockedReasons` 中说明只支持 expected；如果后续实现 seeded_random，则新增确定 seed 下的命中序列断言。

建议测试名：

```text
TestSingleAttackerDPSCanonicalCritPolicyExpectedAndUnsupportedRandom
```

## 5. 页面与导出回归

Batch F 主体是 wasm runtime 回归。页面只做最小 smoke：

1. 打开 `#/wasm-validation-v2-dps`，运行默认页面 A，确认 4 条 curve 仍可导出。
2. 打开 `#/wasm-validation-v2-dps-multi-hero`，运行默认页面 B，确认多英雄同装备导出仍可用。
3. 导出 JSON 必须能找到：
   - `caseId`
   - `versionCode`
   - `simulationRules.critPolicy`
   - `curveResults[].attackIntervalTimeline`
   - `curveResults[].damageTimeline`
   - `curveResults[].targetHpTimeline`
   - `curveResults[].blockedReasons`
   - `curveResults[].effectBreakdown`

页面 smoke 不要求覆盖 F1-F6 的全部 synthetic case；F1-F6 的精确语义以 wasm test 为准。

## 6. 验证命令

Wasm：

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./internal/runtime -run "Canonical|SingleAttackerDPS" -count=1
go test ./...
go run ./cmd/bench
```

如修改 session、ABI 或 outbox：

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
node .\scripts\smoke-node.mjs
```

如需要同步 wasm 到 web：

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1
```

Web：

```powershell
cd C:\project\damage_web_dev\web
npm run build
```

Docs：

```powershell
cd C:\project\damage_wasm_dev
node tools/task-governance/cli.mjs rebuild
```

收尾：

```powershell
cd C:\project\damage_wasm_dev
git -c safe.directory=C:/project/damage_wasm_dev diff --check

cd C:\project\damage_web_dev
git -c safe.directory=C:/project/damage_web_dev diff --check
```

## 7. 通过标准

1. F1-F6 每个 canonical case 至少有一个命名测试或明确的 deferred 记录。
2. 新增/更新测试能证明 `attackIntervalTimeline`、`damageTimeline`、`targetHpTimeline`、`blockedReasons` 和 `effectBreakdown` 的关键字段。
3. `go test ./...` 通过。
4. `go run ./cmd/bench` 通过，且没有明显性能退化说明。
5. 如果改动影响 wasm 产物或 ABI，Node smoke 通过。
6. 页面 A/B 的最小 smoke 不退化。
7. 新增测试记录并纳入 `planning-validation-milestones` 治理映射，`unassigned_docs: 0`。

## 8. 交付记录要求

Batch F 完成后新增测试记录：

```text
文档记录/测试记录/wasm/V2-BatchF-Canonical回归硬化-测试记录-2026-05-19.md
```

测试记录必须包含：

1. 每个 canonical case 的测试名、命令和结果。
2. 如果某 case deferred，写明阻塞原因和后续条件。
3. 页面 A/B smoke 结果。
4. 是否需要用户补游戏截图。默认 F1-F6 是 synthetic runtime 语义，不需要用户截图；如果引入真实英雄/装备数值验收，再单独列截图需求。
5. `node tools/task-governance/cli.mjs rebuild` 结果。
