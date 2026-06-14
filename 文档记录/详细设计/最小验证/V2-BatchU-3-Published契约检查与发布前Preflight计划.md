TASK_KEY: planning-validation-milestones
DOC_TYPE: 详细设计
WORKSTREAM: planning
STATUS: draft
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-06-13

# V2 Batch U-3 Published 契约检查与发布前 Preflight 计划

关联概要：[验证里程碑V2](../../概要设计/验证里程碑V2.md)

前置 U0 引用契约：[V2-BatchU-0-DPS装备引用契约与Preflight硬化计划](./V2-BatchU-0-DPS装备引用契约与Preflight硬化计划.md)

关联发布链路：[V2-BatchP-单攻击方DPS真实装备联动闭环计划](./V2-BatchP-单攻击方DPS真实装备联动闭环计划.md)

## 1. 文档边界

本文是 Batch U-3 的详细设计和 Cursor 执行真源。目标是把 U0 的 Web adapter 诊断前移到发布前检查，让错误的装备 skillRefs / ownerRole / mechanicsConfig 在发布前可见，避免进入 current bundle 后才在 DPS 页面暴露。

本批不改变 Wasm 运行时，不新增机制，不改装备数值。它只把“可运行页面诊断”升级成“发布契约检查”。

## 2. 目标

1. 复用或镜像 U0 的诊断 code：
   - `skillRefs_missing`
   - `skillRefs_empty`
   - `skillRefs_duplicate`
   - `skillRef_unknown_skill`
   - `skillRef_ownerType_mismatch`
   - `skillRef_ownerId_mismatch`
   - `skillRef_ownerRole_mismatch`
2. 在版本发布前对 item -> skillRefs -> item-owned skill -> `mechanicsConfig.dpsPassiveEffects` 做检查。
3. 发布页或发布结果能显示 item/skill/reason。
4. 支持 severity 策略：
   - `error`：阻止发布或要求明确 override。
   - `warning`：允许发布但必须可见。
   - `info`：仅提示。
5. 后端或 Web 侧至少一处有自动化测试覆盖。

## 3. 非目标

1. 不实现完整数据治理平台。
2. 不修复所有历史数据。
3. 不定义 unique passive / 重复装备规则。
4. 不新增 Wasm validation。
5. 不把 DPS 页面作为唯一发布检查入口。

## 4. 检查范围

第一版只检查 DPS 相关装备引用：

1. item 有 `skillRefs` 时，检查 refs 指向的 skill。
2. item 缺失或空 `skillRefs` 时，输出 warning/info，按 U0 策略处理。
3. skill 必须存在。
4. skill 必须 `ownerType=item`。
5. skill `ownerId` 必须等于 item id。
6. 引用 skill 的 `mechanicsConfig.dpsPassiveEffects` 如果存在：
   - attacker item 不应只有 target passive。
   - target item 候选必须有 `ownerRole=target` passive。
7. `mechanicsConfig.dpsPassiveEffects` 必须是数组；非数组为 error。

## 5. 架构选择

优先实现为 Web 发布前 preflight，原因：

1. U0 diagnostics 已经在 Web adapter 层成型。
2. 发布页更接近用户修复动作。
3. 不需要立刻改后端 API 契约。

如果发现发布过程必须由后端强制兜底，再拆一个 server gate：

1. 后端保存/发布时只做结构性检查。
2. 不引入装备语义数值判断。
3. 不阻断旧数据迁移，除非 severity 策略明确。

## 6. 写入范围

### 6.1 Web Gate

允许写入：

1. `C:\project\damage_web_dev\web\src\engine\tinygoV2DpsAdapter.ts` 或抽出的 diagnostics helper。
2. `C:\project\damage_web_dev\web\src\pages\VersionPublishPage.tsx`
3. 发布页直接相关的 service/type/test 文件。
4. U0 adapter 测试文件，补发布前检查测试。

禁止写入 Wasm / Backend / DB。

### 6.2 Backend Gate 可选

只有 Web preflight 不足时，允许最小写入：

1. `C:\project\damage_backend_dev\server\data_manage\src\main\java\xyz\game\datamanage\service\PostgresWriteStore.java`
2. 发布相关 controller/service 测试。

后端 gate 不应扩成完整业务规则引擎。

## 7. 输出契约

发布前检查输出建议：

```ts
interface PublishedContractDiagnostic {
  scope: 'dps_equipment_skill_refs';
  itemId?: string;
  itemName?: string;
  skillId?: string;
  skillName?: string;
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
}
```

页面展示要求：

1. 按 severity 分组。
2. error 默认阻止发布。
3. warning 允许发布，但发布确认区必须可见。
4. 每条必须能定位到 item/skill。

## 8. 测试矩阵

| 用例 | 输入 | 预期 |
| --- | --- | --- |
| item 缺失 refs | item 无 `skillRefs` | warning/info，可见 |
| item 空 refs | `skillRefs=[]` | warning/info，可见 |
| unknown skill | ref 指向不存在 skill | error |
| ownerType 错 | ref 指向 hero skill | error |
| ownerId 错 | item A ref item B skill | error |
| duplicate refs | 重复 skill id | warning，去重 |
| target ownerRole mismatch | target 候选装备无 target passive | warning/error |
| mechanicsConfig 类型错 | `dpsPassiveEffects` 非数组 | error |
| 正常装备 | refs 和 owner 均正确 | 无 error |

## 9. 验证命令

Web：

```powershell
cd C:\project\damage_web_dev\web
npm test -- --run tinygoV2DpsAdapter
npm run build
```

如果改后端：

```powershell
cd C:\project\damage_backend_dev\server\data_manage
mvn test
```

页面 smoke：

1. 打开发布页。
2. 使用含错误 refs 的 fixture 或 mock bundle。
3. 确认 error 可见且阻止发布。
4. 使用正常数据确认不阻塞发布。

## 10. Cursor Prompt：Web Gate

```text
目标：实现 Batch U-3 Web 发布前 Published Contract Preflight，把 U0 的 DPS equipment skillRefs diagnostics 前移到版本发布页。

执行模型：Cursor composer-2.5，fast=false。

允许写入：
- C:\project\damage_web_dev\web\src\engine\tinygoV2DpsAdapter.ts 或抽出的 diagnostics helper
- C:\project\damage_web_dev\web\src\pages\VersionPublishPage.tsx
- 发布页直接相关的 service/type/test 文件
- U0 adapter 测试文件

只读参考：
- C:\project\damage_viewer_project_planning\文档记录\详细设计\最小验证\V2-BatchU-3-Published契约检查与发布前Preflight计划.md
- C:\project\damage_viewer_project_planning\文档记录\详细设计\最小验证\V2-BatchU-0-DPS装备引用契约与Preflight硬化计划.md

非目标：
- 不改 Wasm runtime。
- 不改 backend，除非 Web preflight 无法接入发布流程。
- 不修复历史数据。
- 不定义 unique passive 或重复装备规则。

实现要求：
1. 抽出或复用 U0 diagnostics helper。
2. 发布前检查 item skillRefs 链路。
3. 发布页显示 diagnostics，error 阻止发布或进入明确 override 流。
4. 添加测试覆盖 unknown skill、ownerType 错、ownerId 错、duplicate refs、正常数据。

停止条件：
- 如果发布页无法获得完整 bundle/resource 数据，停止并报告需要后端或 service 前置。
- 如果需要大改发布流程，停止并拆分。
```

## 11. Cursor Prompt：Backend Gate 可选

```text
目标：在后端发布链路增加最小 DPS equipment skillRefs 结构检查，仅在 Web preflight 不足时执行。

执行模型：Cursor composer-2.5，fast=false。

允许写入：
- C:\project\damage_backend_dev\server\data_manage\src\main\java\xyz\game\datamanage\service\PostgresWriteStore.java
- 发布相关测试文件

非目标：
- 不新增 DB schema。
- 不做装备数值语义校验。
- 不修复历史数据。

实现要求：
1. 发布时检查 mechanicsConfig.dpsPassiveEffects 为数组。
2. 检查 item skillRefs 指向存在 skill 且 ownerType/ownerId 正确。
3. 输出可定位 error message。
4. mvn test 通过。

停止条件：
- 如果需要改 API response 契约或 DB schema，停止并报告。
```

## 12. 完成定义

1. 发布页或后端发布链路能暴露 DPS equipment skillRefs 错误。
2. error 级问题不会静默进入 current bundle。
3. warning 级问题可见且可审计。
4. 正常数据不被误阻断。
5. 自动化测试覆盖主要错误类型。
6. U0 页面 preflight 和 U3 发布 preflight 的 code 语义一致。
