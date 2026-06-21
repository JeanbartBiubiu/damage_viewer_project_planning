TASK_KEY: planning-validation-milestones
DOC_TYPE: 详细设计
WORKSTREAM: planning
STATUS: draft
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-06-21

# V2 Batch W DPS 装备可选验证标签与页面筛选开关计划

关联概要：[验证里程碑V2](../../概要设计/验证里程碑V2.md)

前置发布检查：[V2-BatchU-3-Published契约检查与发布前Preflight计划](./V2-BatchU-3-Published契约检查与发布前Preflight计划.md)

前置录入辅助：[V2-BatchV-DPS装备被动模板与录入辅助计划](./V2-BatchV-DPS装备被动模板与录入辅助计划.md)

## 1. 文档边界

本文是 current published bundle 内部数据分层的详细设计。目标是在同一个 current bundle 同时保留“已自测可用于 Wasm 模拟页面选择”的数据和“已发布但仍待验证/待处理”的数据。

本方案不改变 `published_bundle_snapshots` 的含义。`published bundle` 只表示数据已经进入 current 对外快照；`single_attacker_dps_ready` 才表示该数据已经通过当前 V2 DPS 页面/adapter/Wasm 证据链验证，默认可以在 Wasm 相关模拟页面中选择。

第一版只收敛 `single_attacker_dps` 装备候选，尤其是 `WasmValidationV2DpsPage` 的攻击方装备和目标侧装备选择。英雄、技能、状态、符文、增强符文等后续按同一模型扩展，不在本批一次性铺开。

## 2. 当前事实

1. Web V2 DPS 页面通过 `loadPublishedBundleSnapshot(apiBaseUrl, selectedGameId)` 读取 current version 和 published bundle。
2. 装备选择项当前来自 `tinygoV2DpsAdapter.ts` 的 `listV2DpsEquipmentOptions(bundle)` 与 `listV2DpsTargetEquipmentOptions(bundle)`。
3. 攻击方装备候选先由 `adcCompletedEquipmentIds(bundle)` 从 `bundle.typeRelations` 解析 `adc_completed_item` 得到。
4. 现有 `reserved_type` 是全局稳定语义注册表；实际业务挂载应通过 `types.reserved_type_id` 找到 game-local concrete type，再由 `type_relations` 挂到具体 `equipment`。
5. `published_bundle_snapshots` 已经是发布快照真源，不能再用“已发布 type”表达页面可选状态，否则会和版本发布语义冲突。
6. 既有经验要求页面默认/预设不能只看 item 是否存在，而要看完整 readiness 契约。

## 3. 术语

1. `published`：数据进入 `published_bundle_snapshots.bundle_json`，可由 current version / bundle API 读取。
2. `ready`：数据已通过当前 `single_attacker_dps` 验证链，允许在 Wasm V2 DPS 页面默认候选中出现。
3. `unverified`：数据已在 current published bundle 中，但未挂 `single_attacker_dps_ready`，只能在测试开关下选择。
4. `base selectable`：满足现有业务分类的装备，例如 `adc_completed_item` 或目标侧 defensive/passive 候选。
5. `filtered selectable`：`base selectable` 再叠加页面 readiness filter 后的最终选择项。

## 4. 目标

1. 增加稳定 reserved type 语义：`single_attacker_dps_ready`。
2. 不新增 DB schema，仅通过 seed、game-local type 和 `type_relations` 标记数据 readiness。
3. Wasm V2 DPS 页面默认只展示已验证 ready 的装备候选。
4. 页面提供测试开关，能主动查看全部或仅未验证装备，方便继续跑待处理数据。
5. 页面导出/证据中保留当前筛选模式、ready/unverified 计数和被选装备的 readiness 状态。
6. 当前 published bundle 仍然可以包含未验证数据；未验证数据不因为不可默认选择而从 bundle 移除。
7. 保持 `single_attacker_dps` 与未来其他 Wasm 模拟 lane 的 readiness 语义可扩展。

## 5. 非目标

1. 不把 type 命名为“已发布”。
2. 不修改 `published_bundle_snapshots`、`game_versions` 或发布快照读取语义。
3. 不改 TinyGo Wasm runtime、ABI、DPS 调度或被动执行逻辑。
4. 不把未验证数据从 current bundle 删除。
5. 不在第一版为所有 targetCategory 建完整治理 UI。
6. 不自动判定某条数据是否 ready；ready 标记由验证闭环后的数据操作显式维护。
7. 不把测试开关默认持久化成所有用户的全局行为。

## 6. 所有权边界

数据侧拥有：

1. 哪些装备已通过 `single_attacker_dps` 验证。
2. game-local concrete type 的创建与 `type_relations` 标记。
3. 验证通过/撤销验证的变更记录和发布节奏。

Backend 拥有：

1. `reserved_type` seed 兼容。
2. `types.reserved_type_id` 和 `type_relations` 在 bundle 中的稳定输出。
3. 发布快照继续包含 ready 与 unverified 的完整数据。

Web 拥有：

1. 从 `bundle.types` 和 `bundle.typeRelations` 解析 readiness。
2. Wasm 页面默认筛选、测试开关、计数和导出 evidence。
3. 对缺失 ready type 或无 ready 候选时的清晰提示。

Wasm 拥有：

1. 已存在的 `single_attacker_dps` 计算、blocked 输出和证据字段。
2. 不感知 DB readiness type，不参与页面候选筛选。

Planning 拥有：

1. 本详细设计、后续 Cursor prompt、测试记录和 task governance 映射。

## 7. 数据契约

### 7.1 Reserved Type

新增 reserved type 建议：

| reservedTypeId | key | name | parent |
| --- | --- | --- | --- |
| `10002` | `wasm_simulation_readiness_group` | Wasm 模拟验证状态 | 无 |
| `20010` | `single_attacker_dps_ready` | 单攻击方 DPS 已验证可选 | `10002` |

说明：

1. `10002` 是分组语义，后续可挂 `m2_action_panel_ready`、`m3_single_skill_ready` 或其他 lane。
2. `20010` 是当前第一版实际使用的 readiness 语义。
3. ID 需在实现前再次检查 `reserved_type` 当前内容，确认没有冲突。

### 7.2 Game-local Concrete Type

不要直接把 `20010` 当成装备挂载用的 `type_id`。按现有 seed 注释和模型，应为 `lol` 创建一个 game-local type：

```json
{
  "typeId": 30000以上未占用ID,
  "name": "single_attacker_dps_ready",
  "description": "V2 single_attacker_dps 页面默认可选；仅表示已完成当前验证闭环",
  "reservedTypeId": 20010
}
```

Web 侧必须通过 `types.reservedTypeId === 20010` 找到 concrete typeId，再匹配 `typeRelations`。如果没有找到 concrete typeId，页面应视为 ready type 未配置，而不是默认放开所有装备。

### 7.3 Equipment Relation

已验证装备挂载示例：

```json
{
  "typeId": "<lol 中 reservedTypeId=20010 的 concrete typeId>",
  "targetCategory": "equipment",
  "targetId": "3124",
  "extend": {
    "scope": "single_attacker_dps",
    "verifiedAt": "2026-06-21",
    "evidence": "文档记录/测试记录/wasm/..."
  }
}
```

第一版只要求 `typeId + targetCategory + targetId` 生效。`extend` 是可选证据补充，不作为页面筛选必要条件。

未验证装备不需要额外 negative tag。未挂 `single_attacker_dps_ready` 即为 unverified。

## 8. Web 筛选契约

### 8.1 Filter Mode

新增页面级筛选模式：

```ts
type V2DpsReadinessFilterMode = 'ready' | 'all' | 'unverified';
```

语义：

1. `ready`：默认模式，只显示 `base selectable` 且已挂 `single_attacker_dps_ready` 的装备。
2. `all`：测试模式，显示全部 `base selectable` 装备。
3. `unverified`：测试模式，只显示 `base selectable` 中未挂 ready 的装备。

### 8.2 解析函数

建议在 `tinygoV2DpsAdapter.ts` 增加纯函数：

```ts
type V2DpsReadinessSummary = {
  readyTypeConfigured: boolean;
  readyEquipmentItemIds: Set<string>;
  unverifiedEquipmentItemIds: Set<string>;
  baseSelectableEquipmentItemIds: Set<string>;
};
```

解析步骤：

1. 构建 `typeById = new Map(bundle.types.map(type => [type.typeId, type]))`。
2. 找到所有 `type.reservedTypeId === RESERVED_TYPE_IDS.SINGLE_ATTACKER_DPS_READY` 的 concrete typeId。
3. 遍历 `bundle.typeRelations`，只收集 `targetCategory === 'equipment'` 且 `typeId` 属于 ready concrete typeId 的 `targetId`。
4. 与现有 `adcCompletedEquipmentIds(bundle)` 或目标侧候选集合取交集，得到最终 ready/unverified 集合。
5. 不用 type name 或 `extend.role` 推断 ready 状态，避免和装备分类混淆。

### 8.3 选择项函数

调整或新增函数：

```ts
listV2DpsEquipmentOptions(bundle, readinessFilterMode)
listV2DpsTargetEquipmentOptions(bundle, readinessFilterMode)
inspectV2DpsReadiness(bundle)
```

兼容策略：

1. 旧调用默认等同 `ready`。
2. 如果 ready type 未配置，`ready` 模式返回空候选并显示缺配置提示。
3. `all` 模式仍允许使用 `base selectable`，但页面必须显示“测试模式：包含未验证数据”。
4. `unverified` 模式允许主动筛出待验证装备，方便逐个跑页面输出。

## 9. 页面 UX

`WasmValidationV2DpsPage.tsx` 增加一个紧凑控制：

1. 默认值：`ready`。
2. 控件文案：
   - `已验证`
   - `全部`
   - `未验证`
3. 当模式不是 `ready` 时显示 warning tag：`测试模式：可能包含未验证数据`。
4. 显示计数：`已验证 N / 未验证 M / 基础候选 T`。
5. 若 `ready` 模式下候选为 0：
   - ready type 未配置：提示先创建 `single_attacker_dps_ready` concrete type 并挂载关系。
   - ready type 已配置但无装备：提示 current bundle 中暂无已验证装备。
6. 切换到 `unverified` 时，不自动运行；用户仍需明确选择装备并点击运行。

## 10. Evidence 输出

页面导出 JSON 或运行证据应追加：

```json
{
  "readinessFilter": {
    "mode": "ready",
    "readyTypeConfigured": true,
    "readyEquipmentCount": 12,
    "unverifiedEquipmentCount": 37,
    "selectedEquipmentReadiness": [
      { "itemId": "3124", "ready": true }
    ]
  }
}
```

如果测试模式运行未验证装备，证据必须能看出 `ready=false`，避免后续报告把探索性输出误写成已验证闭环。

## 11. 写入范围

### 11.1 Backend / DB

允许写入：

1. `C:\project\damage_backend_dev\db\game_manage\reserved_types_seed.sql`
2. 如两个 worktree 保持镜像：`C:\project\damage_wasm_dev\db\game_manage\reserved_types_seed.sql`
3. 必要的 README/设计说明同步，限于说明 reserved type 语义。

不允许写入：

1. DB schema 表结构。
2. `published_bundle_snapshots` 读写逻辑。
3. 发布算法和版本 current 语义。

### 11.2 Web

允许写入：

1. `C:\project\damage_web_dev\web\src\config\reservedTypes.ts`
2. `C:\project\damage_web_dev\web\src\engine\tinygoV2DpsAdapter.ts`
3. `C:\project\damage_web_dev\web\src\pages\WasmValidationV2DpsPage.tsx`
4. `C:\project\damage_web_dev\web\src\engine\tinygoV2DpsAdapter.test.ts`
5. 必要时补充相邻类型文件。

不允许写入：

1. TinyGo Wasm runtime。
2. Wasm ABI bridge，除非导出 evidence 需要但应先证明现有路径不够。
3. Admin 大型治理 UI。

## 12. 实施顺序

1. DB seed：新增 `wasm_simulation_readiness_group` 与 `single_attacker_dps_ready` reserved type。
2. 数据准备：在 `lol` 中创建 concrete type，`reservedTypeId=20010`。
3. 数据标记：把已经自测通过的装备挂 `single_attacker_dps_ready` relation。
4. Web config：新增 `RESERVED_TYPE_IDS.SINGLE_ATTACKER_DPS_READY`。
5. Adapter：实现 readiness 解析和 filter mode 过滤。
6. Page：增加模式切换、计数、提示和 evidence 输出。
7. Tests：覆盖 ready/all/unverified 三种过滤，以及 ready type 未配置的行为。
8. Browser smoke：用 current bundle 验证默认只显示 ready，测试模式能选择 unverified。

## 13. 验证命令

Backend / DB：

```powershell
cd C:\project\damage_backend_dev\server\data_manage
mvn test
```

Web：

```powershell
cd C:\project\damage_web_dev\web
npm run build
```

页面 smoke：

1. 启动后端并确认 `GET /api/games/lol/versions/current` 成功。
2. 启动 Web dev server。
3. 打开 V2 DPS 页面。
4. 默认 `已验证` 模式下只出现已挂 ready 的装备。
5. 切换 `未验证` 后能看到待处理装备。
6. 运行一个未验证装备时导出 evidence 中 `ready=false` 且 `mode='unverified'`。

治理：

```powershell
cd C:\project\damage_wasm_dev
node tools/task-governance/cli.mjs rebuild
node tools/task-governance/cli.mjs docs planning-validation-milestones
```

## 14. Cursor Prompt: Web Gate

目标：实现 V2 DPS 页面基于 `single_attacker_dps_ready` reserved type 的装备候选筛选和测试开关。

目标 repo / branch：

1. `C:\project\damage_web_dev`
2. 当前分支按实际 `git branch --show-current` 为准。

允许写入：

1. `web/src/config/reservedTypes.ts`
2. `web/src/engine/tinygoV2DpsAdapter.ts`
3. `web/src/pages/WasmValidationV2DpsPage.tsx`
4. `web/src/engine/tinygoV2DpsAdapter.test.ts`

非目标：

1. 不修改 TinyGo Wasm runtime。
2. 不修改后端 API。
3. 不把 `published` 命名用于 readiness type。
4. 不重构整个 V2 DPS 页面。

实现要求：

1. 新增 `SINGLE_ATTACKER_DPS_READY = 20010` reserved type 常量。
2. 通过 `type.reservedTypeId === 20010` 找 concrete typeId。
3. 默认装备选择只返回 ready 装备。
4. 页面增加 `ready/all/unverified` 控制。
5. evidence 中输出当前筛选模式和所选装备 readiness。
6. ready type 未配置时默认模式不应静默放开全部装备。

验证命令：

```powershell
cd C:\project\damage_web_dev\web
npm run build
```

停止条件：

1. 如果发现当前 bundle 类型结构不足以解析 `reservedTypeId`，停止并报告需要后端 bundle 字段补齐。
2. 如果页面 evidence 没有现成扩展点，不要大改导出体系，先最小化把 readiness 附到已有导出对象。
3. 如遇无关脏改，不要回滚，报告并绕开。

## 15. Cursor Prompt: Data Gate

目标：补充 reserved type seed，并准备 `lol` 的 `single_attacker_dps_ready` concrete type 和 relation 标记路径。

目标 repo / branch：

1. `C:\project\damage_backend_dev`
2. 如需要同步设计镜像，再处理 `C:\project\damage_wasm_dev\db\game_manage\reserved_types_seed.sql`。

允许写入：

1. `db/game_manage/reserved_types_seed.sql`
2. 必要的 backend README/设计说明小段落。
3. 若已有 seed/import 工具负责写 type relations，可最小化补充 runbook 或脚本参数。

非目标：

1. 不改表结构。
2. 不改发布快照语义。
3. 不自动把所有 current bundle 装备标 ready。
4. 不把未验证装备删除。

实现要求：

1. 添加 `10002/20010` reserved type 和父子关系。
2. 写清楚 game-local concrete type 必须用 `reservedTypeId=20010`。
3. 写清楚装备 relation 挂载到 `targetCategory='equipment'`。

验证命令：

```powershell
cd C:\project\damage_backend_dev\server\data_manage
mvn test
```

停止条件：

1. 如果 live DB 已有 ID 冲突，停止并报告实际冲突 ID。
2. 如果 `type_relations` FK 导致不能直接挂 reserved id，不要绕过 FK；必须创建 concrete type。

## 16. 风险与回滚

1. 风险：ready type 未配置导致默认页面无候选。处理：显示明确配置缺失提示，并允许测试模式 `all` 临时查看。
2. 风险：误把未验证运行结果当成闭环证据。处理：evidence 必须输出 `mode` 和 `ready=false`。
3. 风险：直接用 reserved id 写 `type_relations` 触发 FK 问题。处理：始终通过 game-local concrete type。
4. 回滚：移除 Web filter 逻辑或切回 `all` 默认即可恢复旧选择行为；数据侧移除 ready relations 即可撤销某个装备默认可选状态。
