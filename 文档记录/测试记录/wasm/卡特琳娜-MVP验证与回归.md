TASK_KEY: wasm-katarina-mvp
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: pending

# 卡特琳娜 MVP 验证与回归

## 1. 测试范围

本轮只验证卡特琳娜 MVP 闭环，不验证完整平台能力。

覆盖范围：
- `DB` 最小种子数据与发布版本
- `server` 的版本创建、写入、publish、`current`、`bundle`
- `web` 的 `current + bundle` 拉取与场景页
- `wasm` 协议兼容 runtime 的 `S0 / S1` 运行结果

MVP 数据基线：
- `gameId = lol`
- `versionCode = mvp_katarina_001`
- 2 个 hero
- 2 个 skill
- 2 个 item
- 1 个 rate 属性样例 `hp_regen -> hp`

参考文件：
- [`最小验证/卡特琳娜-MVP实施方案.md`](./卡特琳娜-MVP实施方案.md)
- [`最小验证/卡特琳娜-MVP种子数据.json`](./卡特琳娜-MVP种子数据.json)
- [`wasm/卡特琳娜MVP运行协议.md`](../wasm/卡特琳娜MVP运行协议.md)

## 2. 最小验证链路

推荐按下面顺序执行。

1. 创建版本
2. 写入 MVP 属性、英雄、技能、装备
3. 执行 `publish`
4. 校验 `GET /api/games/{gameId}/versions/current`
5. 校验 `GET /api/games/{gameId}/versions/{versionId}/bundle`
6. 打开 Web 的卡特 MVP 页面
7. 执行 `S0 平A x10`
8. 执行 `S1 完整 R`
9. 对比样本点、总伤害、剩余生命、持续时间

最小通过标准：
- `current` 返回的 `versionCode` 是 `mvp_katarina_001`
- `bundle` 中存在卡特、假人、平A、R、2 件装备
- Web 页面可完成至少一次 `S0` 和一次 `S1`
- 运行结果不是空对象，且样本点有序

## 3. 本轮必须检查的回归点

### 3.1 后端契约回归

- `attributeDefinitions` 必须返回 `valueKind`
- `rate` 属性必须返回 `rateTargetAttrKey`
- `publish` 后 `bundle.meta.dataHash` 必须可用于 `ETag`
- `current` 与 `bundle` 的 `versionId` 必须一致
- `bundle` 里不应缺失 MVP 需要的 hero / skill / item

### 3.2 数据回归

- `hero_katarina` 的基础属性必须存在
- `hero_dummy_10000hp_100ar_100mr` 的防御属性必须存在
- `skill_katarina_basic_attack` 必须作为普攻入口
- `skill_katarina_r` 必须作为 R 入口
- `item_blade_of_the_ruined_king` 和 `item_nashors_tooth` 必须可被前端识别

### 3.3 运行回归

- `S0` 的命中数必须是 10
- `S1` 的多段数必须与配置一致
- 同一 `bundle + input` 重跑结果应稳定
- 样本点 `tMs` 必须递增

### 3.4 前端回归

- `current` 拉取成功后再拉 `bundle`
- `bundle` 缺少 MVP 资源时页面必须给出明确错误
- 场景切换不会破坏已加载的 bundle
- 装备切换只影响输入，不应改动 bundle 本体

## 4. 无 IT 数据库时的本地验证

本地只做编译、构建和静态验证，不跑集成数据库。

推荐执行：

```powershell
cd server/data_manage
mvn -q -DskipTests compile
mvn -q -DskipTests test-compile
```

```powershell
cd web
npm run build
```

本地再检查这几个文件：
- [`server/data_manage/src/main/java/xyz/game/datamanage/service/PostgresWriteStore.java`](../server/data_manage/src/main/java/xyz/game/datamanage/service/PostgresWriteStore.java)
- [`server/data_manage/src/test/java/xyz/game/datamanage/integration/ControllerPublishFlowIT.java`](../server/data_manage/src/test/java/xyz/game/datamanage/integration/ControllerPublishFlowIT.java)
- [`web/src/pages/KatarinaMvpPage.tsx`](../web/src/pages/KatarinaMvpPage.tsx)
- [`web/src/engine/runtime.ts`](../web/src/engine/runtime.ts)

无 IT 数据库时的最低检查项：
- 后端能编译
- 前端能构建
- 卡特 MVP 页面能在代码层引用 `current + bundle` 和运行层
- `wasm` 协议文档和 `web` runtime 的字段名一致

## 5. 有 IT 数据库后的 server 集成验证

IT 环境必须补跑这条链路：

1. 插入 `games`、`owner_categories`
2. 创建版本
3. 写入 MVP 属性、英雄、技能、装备
4. 发布版本
5. 读取 `current`
6. 读取 `bundle`
7. 验证 `bundle` 中的 MVP 资源完整
8. 验证 `valueKind/rateTargetAttrKey` 在 `bundle` 中可见

推荐重点看这几个断言：
- `versionCode == mvp_katarina_001`
- `bundle.meta.dataHash` 非空
- `bundle.heroes.length == 2`
- `bundle.skills.length == 2`
- `bundle.items.length == 2`
- `hp_regen.valueKind == rate`
- `hp_regen.rateTargetAttrKey == hp`

如果 IT 环境可跑完整测试，优先执行：
- `server/data_manage/src/test/java/xyz/game/datamanage/integration/ControllerPublishFlowIT.java`

## 6. Web 侧 S0 / S1 期望检查项

### 6.1 S0

输入特征：
- `plan.type = basic_attack`
- `count = 10`
- `skillId = skill_katarina_basic_attack`
- self 装备可为空或仅使用 MVP 两件装备

期望检查项：
- 结果页显示动作标签为平A
- `executedHits == 10`
- `samples` 非空
- `tMs` 递增
- `totalDamageToEnemy > 0`

### 6.2 S1

输入特征：
- `plan.type = cast_skill`
- `skillId = skill_katarina_r`
- `skillLevel = 3`

期望检查项：
- 结果页显示动作标签为 R
- `executedHits` 与多段数一致
- `samples` 非空
- `actionDurationMs` 非 0
- `lastSample.enemyHp` 低于初始值

### 6.3 页面级检查

- 页面必须先能读到 `current`
- 页面必须再读到 `bundle`
- 如果 bundle 缺资源，页面要显示原因，不允许静默失败
- 装备切换后重新运行，结果应变化或至少被重新计算

## 7. 边界测试建议

- `versionCode` 错误时，发布后不应拿到可用 `current`
- `heroId` 缺失时，Web 场景页应直接报错
- `itemId` 不存在时，runtime 应返回语义错误
- `valueKind = rate` 但未填 `rateTargetAttrKey` 时，后端应拒绝
- `plan.count = 0` 时，runtime 应拒绝
- `stop.maxSeconds <= 0` 时，runtime 应拒绝
- `bundle` 缺少 `skill_katarina_r` 时，页面应阻断运行

## 8. 回归测试建议

- 每次改 `bundle` 字段后，重跑一次后端编译和前端构建
- 每次改 `attributeDefinitions` 契约后，重跑发布流测试
- 每次改 `run input` 或 `result` 结构后，重跑 `S0 / S1`
- 每次改卡特数据时，检查 `bundle` 和 `runtime` 的字段名是否同步
- 每次改 `ETag/dataHash` 计算逻辑时，检查 `current` 与 `bundle` 是否仍一致

## 9. 失败复现步骤

### 9.1 发布失败

1. 用 IT 数据库创建版本 `mvp_katarina_001`
2. 写入 attribute / hero / skill / item
3. 故意把 `hp_regen.valueKind` 改成 `rate`
4. 不填写 `rateTargetAttrKey`
5. 执行 `publish`

预期：
- 后端应返回语义错误
- 不应生成可用 `current`

### 9.2 Bundle 缺资源

1. 发布时故意少写 `skill_katarina_r`
2. 打开 Web 的卡特 MVP 页面
3. 运行 `S1`

预期：
- 页面应提示 bundle 缺少 MVP 资源
- 不应进入运行层

### 9.3 运行输入非法

1. 打开卡特 MVP 页面
2. 让场景输入的 `plan.count = 0`
3. 点击运行

预期：
- runtime 返回 `INVALID_INPUT`
- 页面显示可读错误

### 9.4 场景输出异常

1. 用正确 bundle 跑 `S0`
2. 再跑 `S1`
3. 对比样本点数量、`executedHits`、`actionDurationMs`

预期：
- 两次结果不同，但都应稳定可复现

## 10. 测试结论

当前本轮测试结论是：

- 后端契约闭环已经具备可编译验证条件
- Web 侧已经具备 `current + bundle` 和 MVP 场景页的构建条件
- `wasm` 侧已明确运行协议，当前可用同协议 runtime 占位
- 还缺 IT 数据库上的真实集成跑通结果，因此“端到端实跑”仍需在具备 `IT_DB_URL` 的环境补最终确认

当前可判定为：
- `编译级通过`
- `协议级收敛`
- `端到端运行待 IT 环境最终确认`
