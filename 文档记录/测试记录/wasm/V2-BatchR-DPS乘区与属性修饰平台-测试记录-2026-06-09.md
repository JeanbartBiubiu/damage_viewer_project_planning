TASK_KEY: planning-validation-milestones
DOC_TYPE: 测试记录
WORKSTREAM: planning
STATUS: done
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-06-09

# V2 Batch R DPS 乘区与属性修饰平台测试记录 2026-06-09

关联计划：[V2-BatchR-DPS乘区与属性修饰平台计划.md](../../详细设计/最小验证/V2-BatchR-DPS乘区与属性修饰平台计划.md)

## 1. 变更概述

Batch R 本轮完成单攻击方 DPS 的乘区与属性修饰平台落地：

1. TinyGo V2 bundle 接入 `coefficientBuckets`，compile 层校验 bucket domain、stage、attr 引用、aggregation 和 bucketConfig。
2. DPS runtime 新增 coefficient bucket resolver，并接入 `hp_change` 与 `attribute` 两个 domain。
3. `damage_modifier` / `stat_modifier` 保持旧配置兼容；带 `bucketKey` 的配置进入统一 resolver。
4. Web 侧把 published bundle 的 `coefficientBuckets` 传入 TinyGo bundle，并在技能结构化编辑器里暴露 `bucketKey`、`valueSpec`、`conditions`、`priority`、`evidenceKey`。
5. 本轮额外修复 ABI outbox：Batch R 6 条曲线 done payload 超过旧 256 KiB outbox 时会被静默丢弃，现已改为 1 MiB 默认容量，并让超大优先帧返回 `E_QUEUE_OVERFLOW`。
6. 本轮追加结构化 evidence：`effectBreakdown[].coefficientBucket` 现在携带 `domain`、`stageKey`、`bucketKey`、`raw`、`result`、`candidates`、`skipped`，页面不再只依赖 `message` 字符串判断乘区细节。

## 2. Cursor 执行记录

Outbox 修复 Cursor run：

```text
agent=agent-8653e18c-2d68-4634-9f82-7e7d6e0686d0
run=run-d11e12d6-e0cc-4ec3-ae01-ca164a6675b5
model={"id":"composer-2.5","params":[{"id":"fast","value":"false"}]}
status=finished
artifact=C:\project\damage_wasm_dev\.agents\artifacts\batch-r-outbox-fix-001
```

Wasm 结构化 evidence 修复 Cursor run：

```text
agent=agent-7155b766-b0f4-4462-897d-3da041904222
run=run-ffedd8a7-ef33-4acd-8d2e-211bb2fa253d
model={"id":"composer-2.5","params":[{"id":"fast","value":"false"}]}
status=finished
artifact=C:\project\damage_wasm_dev\.agents\artifacts\batch-r-structured-evidence-wasm-fix-002
```

Web 结构化 evidence 类型补齐 Cursor run：

```text
agent=agent-6915ce11-8637-447d-b00c-7008c3dede3a
run=run-aff66a82-176c-4f3c-a5f2-ed493a5e21fd
model={"id":"composer-2.5","params":[{"id":"fast","value":"false"}]}
status=finished
artifact=C:\project\damage_wasm_dev\.agents\artifacts\batch-r-structured-evidence-web-type-001
```

## 3. 自动化验证

### 3.1 Wasm Go tests

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test -count=1 ./...
```

结果：

```text
status=pass
runtime / compile / abi package tests passed
```

覆盖要点：

1. `coefficientBuckets` 编译契约与无 bucket 旧 bundle 兼容。
2. hp_change 同桶相加、跨 stage 应用、flat clamp、target armor 与旧 incoming modifier 兼容。
3. attribute bucket 写入 resolved attributes，并覆盖 3153 Batch R AD flat bonus。
4. ABI outbox oversized non-priority frame 仍可丢弃；oversized priority frame 返回 `E_QUEUE_OVERFLOW`。
5. 多曲线 DPS session 能返回 done frame，不再出现 code 0 + empty outbox。
6. `hp_change` / `attribute` 的 `coefficientBucket.candidates` 结构化证据可被断言；条件未命中时输出 skipped-only evidence，且不触发 passive、不改变数值。

### 3.2 Wasm native benchmark

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go run ./cmd/bench
```

结果：

```text
status=pass
samples=100 avg_us=273.45 max_us=1050.00
```

### 3.3 Wasm build and Node smoke

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1
node .\scripts\smoke-node.mjs
node .\scripts\bench-node.mjs --iterations 10 --warmup 2
```

结果：

```text
status=pass
dist\tinygo_engine_v2.wasm size=674684 bytes
sha256=EB90A67229E4DE62185BEB7B6E0E06AC31FF34DC5C10102F1FFC034810522DCA
exports include engine_init, engine_begin_run, engine_outbox_ptr, engine_outbox_len, engine_outbox_clear
bench-node mean=2.173ms p95=3.118ms max=3.118ms
```

该 Wasm 已同步到：

```text
C:\project\damage_web_dev\web\src\engine\wasm\tinygo_engine_v2.wasm
```

### 3.4 Web build

```powershell
cd C:\project\damage_web_dev\web
npm run build
```

结果：

```text
status=pass
tsc -b passed
vite build passed
wasm source=C:\project\damage_web_dev\web\src\engine\wasm\tinygo_engine_v2.wasm
wasm sha256=EB90A67229E4DE62185BEB7B6E0E06AC31FF34DC5C10102F1FFC034810522DCA
wasm size=674684 bytes
known warning=Some chunks are larger than 500 kB after minification
```

说明：chunk size warning 为既有 Vite 构建提示，不是 Batch R 新失败。

### 3.5 Governance and diff checks

```powershell
cd C:\project\damage_wasm_dev
node tools/task-governance/cli.mjs rebuild
node tools/task-governance/cli.mjs docs planning-validation-milestones
git diff --check -- wasm/tinygo_engine_v2 db/task_doc_governance/task_rules.json "文档记录/详细设计/最小验证/V2-BatchR-DPS乘区与属性修饰平台计划.md"

cd C:\project\damage_web_dev
git diff --check -- web/src web/src/engine/wasm/tinygo_engine_v2.wasm
```

结果：

```text
status=pass
tasks=36
header_updates=0
unassigned_docs=0
```

## 4. Backend current bundle 检查

后端服务：

```text
baseUrl=http://localhost:8080
gameId=lol
currentVersion=v2_batch_r_coefficient_buckets_001
```

当前 bundle 摘要：

```text
coefficientBucketsCount=2
skillsCount=50
itemsCount=518
```

Batch R buckets：

```text
batch_r_attacker_ad_flat_bonus
domain=attribute
stageKey=attribute/flat_bonus
targetAttrKey=ad
aggregation=add
valueUnit=flat_delta

batch_r_hp_final_amp
domain=hp_change
stageKey=hp_change/final/post_mitigation
aggregation=add
valueUnit=percent_delta
```

Batch R sample skills：

```text
item_3075_batch_r_hp_probe_dps_v2
item_3153_batch_r_coeff_probe_dps_v2
```

## 5. ABI outbox 回归证据

复现旧问题时，同一 prepared input 的 6 条 curve 会出现：

```text
wasmHash=4065fdedfe21
engine_begin_run code=0
outboxLen=0
frameCount=0
```

修复后复验：

```text
wasmHash=653e88a32f2389a58bd225e102f4d41bd612d1dc854116b513a855b20a9122e1
engine_begin_run code=0
outboxLen=287258
frameKinds=[13]
donePayloadLen=287242
```

证据文件：

```text
C:\project\damage_web_dev\output\playwright\batch-r-node-direct-after-outbox-fix.json
C:\project\damage_web_dev\output\playwright\batch-r-direct-done-summary-after-outbox-fix.json
```

## 6. Playwright 页面验收

页面：

```text
http://127.0.0.1:5173/#/wasm-validation-v2-dps
```

操作流：

1. 打开 V2 DPS 页面。
2. 确认 current version 为 `v2_batch_r_coefficient_buckets_001`。
3. 在“目标装备 (全局)”选择 `3075 / 荆棘之甲`。
4. 点击“运行”。
5. 切换到 `破败王者之刃 / vayne-3153` curve。
6. 展开“原始明细”，检查 effectBreakdown / Wasm Frames。

页面断言结果：

```text
status=pass
allPass=true
wasmHashPrefix=eb90a67229e4
targetEquipment=3075 armor+70 / hp+350
selectedTargetContains3075=true
activeCurve=破败王者之刃 / ok
single_attacker_dps did not return=false
WASM error=false
openedRawDetails=true
coefficientBucket=true
candidates=true
applied=true
hasStructuredRaw=true
batch_r_hp_final_amp=true
batch_r_attacker_ad_flat_bonus=true
```

页面证据：

```text
C:\project\damage_web_dev\output\playwright\batch-r-structured-page-proof-final.json
C:\project\damage_web_dev\output\playwright\batch-r-structured-page-proof-final.png
```

结构化 evidence 摘要：

```text
effectBreakdown[].coefficientBucket.domain=hp_change
stageKey=hp_change/final/post_mitigation
bucketKey=batch_r_hp_final_amp
raw/result/evidenceKeys present
candidates[0].sourceType=item
candidates[0].passiveId=item_3075_batch_r_hp_final_reduction_dps_v2
candidates[0].operationKind=coefficient_modifier
candidates[0].applied=true
```

## 7. 结论

Batch R 当前达成开发验收：

1. 乘区 bucket 契约进入 Wasm compile/runtime。
2. hp_change 和 attribute 两条 adapter 链路都能由 published bundle 数据驱动。
3. 3075 目标侧减伤 bucket 和 3153 攻击侧 AD flat bucket 已在同一次页面 flow 中验证。
4. 新 Wasm 已同步到 Web 并通过页面实际运行。
5. 原 outbox 容量导致的 code 0 + empty outbox 问题已修复，并有 ABI 黑盒回归证据。
6. 结构化 `coefficientBucket` evidence 已贯通 Wasm 输出、Web 类型和页面原始明细。

残余风险：

1. `critOnly` 仍依赖后续真实 crit context 接入；当前 expected crit 策略下仍按 blocked/warning 接入点处理。
2. Batch R 只完成乘区与属性修饰平台及代表性样例，更多真实装备、天赋、海克斯数据补录仍需按后续批次推进。
