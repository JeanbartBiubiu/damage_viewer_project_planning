TASK_KEY: planning-validation-milestones
DOC_TYPE: 测试记录
WORKSTREAM: planning
STATUS: done
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-06-07

# V2 Batch Q DPS 联动配置编辑与校验成熟度测试记录 2026-06-07

关联计划：[V2-BatchQ-DPS联动配置编辑与校验成熟度计划.md](../../详细设计/最小验证/V2-BatchQ-DPS联动配置编辑与校验成熟度计划.md)

## 1. 变更概述

Batch Q 本轮完成两个实现面：

1. Web admin skill editor 增加 `mechanicsConfig.dpsPassiveEffects` 只读摘要、error/warning 校验和保存阻断。
2. Backend `PostgresWriteStore` 增加 `dpsPassiveEffects` 最小结构校验，并补 Batch P seed 正反测试。

本轮没有修改 Wasm runtime，也没有新增真实卢登 spell-hit 用户流。

## 2. Cursor 执行记录

Web Cursor run：

```text
agent=agent-b6f0996d-709d-456c-b7b8-7addb6c0bfa1
run=run-dc38178f-3f11-4acf-8349-1237f40594f3
model={"id":"composer-2.5","params":[{"id":"fast","value":"false"}]}
status=finished
artifact=C:\project\damage_wasm_dev\.agents\artifacts\cursor-batchq-web-admin
```

Backend Cursor run：

```text
agent=agent-f76dc939-32ee-477f-8ade-ba8ccd4a8e49
run=run-9d6219ad-ac0d-4fa8-ad4b-a23058ec7e4d
model={"id":"composer-2.5","params":[{"id":"fast","value":"false"}]}
status=finished
artifact=C:\project\damage_wasm_dev\.agents\artifacts\cursor-batchq-backend-schema
```

Backend publish-chain regression Cursor run：

```text
agent=agent-8435a40e-c481-4bc5-b1e2-4a3c9855bbc0
run=run-3be9473d-5812-44d0-b81c-e64be430014b
model={"id":"composer-2.5","params":[{"id":"fast","value":"false"}]}
status=finished
artifact=C:\project\damage_wasm_dev\.agents\artifacts\cursor-batchq-backend-publish-test
```

## 3. 自动化验证

### 3.1 Web build

```powershell
cd C:\project\damage_web_dev\web
npm run build
```

结果：

```text
status=pass
tsc -b passed
vite build passed
wasm asset=tinygo_engine_v2-CMMVm9Yi.wasm 537.53 kB
known warning=Some chunks are larger than 500 kB after minification
```

说明：chunk size warning 为既有 Vite 构建提示，不是 Batch Q 新失败。

### 3.2 Backend targeted test

```powershell
cd C:\project\damage_backend_dev\server\data_manage
mvn -Dtest=KatarinaMvpImportMainTest test
```

结果：

```text
status=pass
Tests run: 19
Failures: 0
Errors: 0
Skipped: 0
```

覆盖：

1. Batch P 3071/3075 seed `dpsPassiveEffects` 可被保存链接受。
2. `dpsPassiveEffects` 非数组被拒绝。
3. `ownerRole=ally` 被拒绝。
4. `trigger.event=on_unknown_event` 被拒绝。
5. `operations` 非数组被拒绝。
6. `operation.targetRole=source` 被拒绝。

### 3.3 Backend publish-chain regression test

新增 publish-chain regression 后补充：

```powershell
cd C:\project\damage_backend_dev\server\data_manage
mvn -Dtest=PostgresWriteStorePublishTest test
```

结果：

```text
status=pass
Tests run: 7
Failures: 0
Errors: 0
Skipped: 0
```

覆盖：

1. 发布链拒绝 `dpsPassiveEffects` 非数组。
2. 发布链拒绝 passive 非 object。
3. 发布链拒绝 `ownerRole=ally`。
4. 发布链拒绝 `trigger` 非 object。
5. 发布链拒绝 `trigger.event=on_unknown_event`。
6. 发布链拒绝 `operations` 非数组。
7. 发布链拒绝 operation 非 object。
8. 发布链拒绝 `operation.targetRole=source`。
9. 上述失败均保持 `markVersionCurrent` 未调用。

### 3.4 Backend full test

```powershell
cd C:\project\damage_backend_dev\server\data_manage
mvn test
```

结果：

```text
status=pass
Tests run: 69
Failures: 0
Errors: 0
Skipped: 0
```

说明：测试输出包含 Mockito dynamic agent warning 和 `AdminEditLogHelperTest` 中预期的 fail-open 日志；不影响测试结果。

### 3.5 Diff checks

```powershell
cd C:\project\damage_web_dev
git diff --check

cd C:\project\damage_backend_dev
git diff --check
```

结果：

```text
status=pass
```

## 4. 浏览器 smoke

临时启动：

```powershell
cd C:\project\damage_backend_dev\server\data_manage
APP_AUTH_JWT_DISABLED=true mvn spring-boot:run

cd C:\project\damage_web_dev\web
npm run dev -- --host 127.0.0.1 --port 5173
```

健康检查：

```text
GET http://127.0.0.1:8080/api/games -> 200
GET http://127.0.0.1:5173 -> 200
```

Playwright admin smoke：

```powershell
npx --yes --package @playwright/cli playwright-cli open http://127.0.0.1:5173/#/skills
```

结果：

```text
status=pass
verified:
- item_3071_black_cleaver_carve_dps_v2 编辑弹窗可见 DPS Passive 摘要
- 摘要可见 on_damage_dealt / stat_modifier / targetRole=target 证据
- 将 ownerRole 从 attacker 改为 ally 后，页面显示 /mechanicsConfig/dpsPassiveEffects/0/ownerRole 错误
- 保存按钮被禁用
```

说明：本轮 smoke 使用了本地临时 Playwright 脚本执行断言，脚本位于 `.agents/artifacts/batchq-live-smoke/`，不进入提交物。提交后的正式复核入口以上述页面路径和断言清单为准，不依赖该临时脚本文件存在。

Playwright DPS page smoke：

```powershell
npx --yes --package @playwright/cli playwright-cli open http://127.0.0.1:5173/#/wasm-validation-v2-dps-stacking-passive
```

结果：

```text
status=pass
verified:
- V2 DPS Batch H 页面加载 current bundle
- 页面出现 Active Status
- 页面正文包含 ok
```

说明：本轮 smoke 使用了本地临时 Playwright 脚本执行断言，脚本位于 `.agents/artifacts/batchq-live-smoke/`，不进入提交物。提交后的正式复核入口以上述页面路径和断言清单为准，不依赖该临时脚本文件存在。

清理：

```text
8080 stopped
5173 stopped
```

停止 5173 时 `netstat` 输出包含 PID 0 的 TIME_WAIT 记录，尝试停止 Idle 被系统拒绝；实际监听的 Vite node 已停止。

## 5. 结论

Batch Q 当前自动化与页面 smoke 通过。配置层新增的错误拦截不会影响 Batch P 的真实装备正向配置；非法 ownerRole、非法 trigger.event、非法 operations 和非法 targetRole 已有 Web/Backend 双侧保护。

残余风险：

1. Web 当前仍无前端单元测试框架，前端校验依赖 build 和 Playwright smoke。
2. Batch Q 不解决真实 `on_spell_hit` 用户流；卢登仍需另开 Batch R。
3. Batch Q 不解决兰顿真实 crit damage context；`critOnly=true` 只做 warning 可见化。
