TASK_KEY: wasm-engine-v2-architecture
DOC_TYPE: 概要设计
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-06

# WASM 前后端对齐整改方案

本文是 Wasm 通用计算引擎进入实现前的 W0 对齐方案，回答后端、前端和 Wasm core 如何分工、哪些整改必须先对齐、以及各阶段如何验证。需求边界见 [WASM通用计算引擎需求对齐记录.md](../../需求澄清/wasm/WASM通用计算引擎需求对齐记录.md)，Wasm 系统概要见 [WASM概要设计.md](./WASM概要设计.md)，实现契约见 [WASM详细设计.md](../../详细设计/wasm/WASM详细设计.md)。

## 1. 结论

W0 要先做，但 W0 不要求先改后端或前端代码。

推荐顺序：

```text
W0 对齐方案
  -> A1 Wasm ABI 与 session registry
  -> B1 canonical DTO / compile / fixture
  -> C-F Wasm core runtime
  -> 后端 canonical publish/catalog contract
  -> 前端 Worker adapter 与页面验收
  -> 真实后端数据到前端图表的端到端验收
```

原因：

1. A1 只建立目标 ABI、FrameKind 200+、outbox、session registry 和错误 DTO，不依赖后端/前端。
2. B1 会把 `CompileRequest`、`RunRequest`、`CombatantDefinition`、`ProviderDefinition`、`AbilityDefinition` 等 canonical DTO 固化；B1 前必须让后端/前端知道不能继续按旧 DTO 口径理解输入输出。
3. 后端和前端的代码整改应在 B1 fixture 稳定后启动，否则会围绕尚未落盘的字段重复返工。

## 2. 非目标

W0 不做以下事情：

1. 不修改 `C:\project\damage_backend_dev` 代码。
2. 不修改 `C:\project\damage_web_dev` 代码。
3. 不新增后端 API 细节设计。
4. 不新增前端页面交互详细设计。
5. 不把旧 `EngineBundleV2`、`ActionTemplateV2`、`single_attacker_dps` 继续包装成新通用引擎主线。

W0 的产物是跨模块共识和后续开发门禁；具体代码任务应拆到后端详细设计、前端详细设计或 Cursor prompt。

## 3. 模块分工

### 3.1 后端

后端负责版本数据和 canonical catalog 的发布边界。

P0 默认职责：

1. 从数据库、seed 或导入产物中输出版本化的 canonical catalog 数据。
2. 把旧表、旧字段、旧页面术语转换为 canonical `combatant/provider/ability/typeKey` 语义。
3. 维护 `schemaVersion`、`schemaHash`、`rulesHash` 的可追踪来源。
4. 在发布层尽早校验 type relation 深度、环、未知 reserved type、缺失引用等问题。
5. 提供 contract test，证明输出不会出现旧 Wasm 禁用字段。

后端不负责：

1. 持有 Wasm compiled session。
2. 执行 `engine_compile` 或 `engine_run`。
3. 保存前端本地 override patch。
4. 根据前端图表展示需求二次拼接 `series[]`。

### 3.2 前端

前端负责用户选择、覆盖值、Worker 生命周期和图表消费。

P0 默认职责：

1. 从后端 canonical catalog 或现有 bundle 中选择 source、target、provider 和 ability。
2. 在进入 Wasm ABI 前应用用户数字覆盖，生成最终 canonical payload。
3. 持有浏览器 Worker、Wasm 实例、`sessionId` 和墙钟超时保护。
4. 调用 `engine_compile`、`engine_run`、`engine_release_session`。
5. 消费 `summary`、`series[]`、`warnings[]`、`evidence`，不从底层日志重建主时间线。
6. 对比类模拟由前端/Worker 编排多次 single run，复用 compiled session 或在 hash 变化后重新 compile。

前端不负责：

1. 在 UI 层保留 `skill_mounts`、`ActionTemplateV2` 等旧结构后直接透传给 Wasm。
2. 解释 compiled artifact。
3. 在 Wasm 外绕过 `summary/series` 自行定义另一套计算结果口径。

### 3.3 Wasm

Wasm 负责 canonical JSON 的编译和确定性运行。

P0 默认职责：

1. 只接受 canonical `CompileRequest` 与 `RunRequest`。
2. compile 阶段做 schema、引用、type、formula、operation 校验，并在已知 schema 内 collect-all。
3. run 阶段只读 compiled session，并从 `initialSnapshot` 创建单次隔离 runtime state。
4. 输出 chart-ready `DoneResult` 或结构化 `EngineError`。
5. 在 `internal/testkit/fixtures/generic_p0_*.json` 中沉淀跨模块 contract fixture。

Wasm 不负责：

1. 读取数据库。
2. 识别旧后端表名或旧前端页面字段。
3. 记住用户 override 来源。
4. 为后端或前端保留两套输入术语。

## 4. Materialize 默认方案

P0 采用两段式 materialize：

1. 后端发布 canonical catalog/base definitions：版本、类型、provider、ability、公式、规则定义。
2. 前端/Worker 根据用户选择、目标、覆盖值和采样策略 materialize 成 run-ready `CompileRequest` / `RunRequest`。

这样做的理由：

1. 用户 override 当前是前端本地行为，应在进入 Wasm 前合并成最终数字。
2. Wasm core 可以先用 fixture 验证，不需要等待后端实时 materialize API。
3. 后端后续若提供场景级 materialize API，也必须输出同一 canonical schema，不能引入第二套 DTO。

W0 评审点：如果决定让后端 P0 直接生成完整场景级 `CompileRequest`，需要另开后端详细设计，并明确前端 override 如何参与 hash、缓存和回放。

## 5. 共享契约真源

推荐默认真源：

1. 文档真源：`WASM详细设计.md`。
2. 可执行 contract 真源：Wasm B1 产出的 Go DTO + `internal/testkit/fixtures/generic_p0_*.json`。
3. 后端验证：读取 fixture 或生成等价 payload，断言无旧字段、hash 稳定、可被 Wasm compile 接受。
4. 前端验证：读取 fixture 或 mock catalog，断言 Worker adapter frame、DTO shape、图表消费字段与 fixture 一致。

暂不建议在 W0 阶段新增跨仓 shared package。原因是 schema 还未由 B1 代码落盘，过早抽 shared package 会把尚未稳定的 DTO 再复制一次。B1 后可以评估从 Go DTO 或 JSON schema 生成 TypeScript 类型。

## 6. 禁用旧口径

后端和前端整改时，以下词只能出现在 legacy、compat、迁移说明、负例 fixture 或旧页面内部，不得进入新 Wasm ABI payload：

| 旧口径 | P0 替代 |
| --- | --- |
| `EngineBundleV2` | `CompileRequest` |
| `ActionTemplateV2` | `AbilityDefinition` / driver event |
| `skill` 作为 Wasm 路径根 | `ability` |
| `skill_mounts` | provider mount |
| `definitionKey` | `definitionRef` |
| 数组式 `attributes/resources` | object map |
| `single_attacker_dps` | legacy/compat fixture 或回归对照 |
| `target_category=hero` | canonical type/tag 或 selector |

任何 worker 如果需要把旧数据送入新 Wasm，必须先写 adapter 转换为 canonical payload。

## 7. 分阶段验收

### 7.1 W0 验收

W0 通过条件：

1. 三方边界明确：后端 catalog，前端 scenario materialize + Worker，Wasm compile/run。
2. B1 前不得让后端或前端自行定义 `CompileRequest` 方言。
3. 禁用旧口径清单进入后续 Cursor prompt。
4. 共享 fixture 真源位置明确。

验证：

```powershell
git diff --check -- 文档记录/概要设计/wasm/WASM前后端对齐整改方案.md
node tools/task-governance/cli.mjs docs wasm-engine-v2-architecture
```

### 7.2 A1 验收

A1 只验证 Wasm ABI 外壳：

1. `FrameKindGenericCompile=200`
2. `FrameKindGenericRun=201`
3. `FrameKindGenericReleaseSession=202`
4. `FrameKindGenericCompileResult=210`
5. `FrameKindGenericDone=211`
6. `FrameKindGenericError=212`
7. `FrameKindGenericSnapshot=213`

后端/前端不参与 A1 代码验收。

### 7.3 B1 验收

B1 开始后，后端/前端必须按 fixture 对齐，不再自由解释字段：

1. Wasm 产出 canonical DTO 和 `generic_p0_*` fixture。
2. 后端可以用 fixture 反向确认 catalog/materialize 输出目标。
3. 前端可以用 fixture 反向确认 Worker adapter 和图表字段。
4. 如后端/前端发现字段无法落地，应回到 `WASM详细设计.md` 修订，而不是在各自仓库局部改名。

### 7.4 后端验收

后端整改完成条件：

1. 真实版本数据能生成 canonical catalog 或等价 payload。
2. 输出不包含旧 Wasm 禁用字段。
3. `attributes/resources` 为 object map。
4. provider mount 使用 `definitionRef`。
5. type key 使用 canonical `domain/name`。
6. hash 可追踪且同输入稳定。
7. 至少一个后端 contract test 的输出可被 Wasm B1+ compile 接受。

### 7.5 前端验收

前端整改完成条件：

1. Worker adapter 使用目标 ABI，不调用旧 `engine_init/engine_begin_run/engine_step` 作为新主线。
2. 前端覆盖值在进入 Wasm 前合并到 canonical payload。
3. 页面图表消费 `summary` 和 `series[]`。
4. 页面能展示 compile/run error 的 `code/path/ref/message`。
5. 对比类模拟由前端/Worker 编排多次 run，runtime state 隔离。
6. Playwright 覆盖最小用户流：选择对象、运行、看到 summary/series、看到 warning/error。

### 7.6 端到端验收

端到端验收只在 Wasm core、后端 catalog、前端 Worker adapter 都稳定后进行。

最小链路：

```text
后端当前版本数据
  -> canonical catalog / payload
  -> 前端选择 source/target + override
  -> Worker engine_compile
  -> Worker engine_run
  -> 页面 summary/series 图表
```

通过条件：

1. 同一输入重复运行结果一致。
2. hash mismatch 能明确阻断 run。
3. compile 多错误能一次返回。
4. final snapshot、summary、series 的关键数值一致。
5. 页面不依赖 legacy DPS lane。

## 8. 开发门禁

进入 B1 前：

1. Cursor prompt 必须引用本 W0 文档和 `WASM详细设计.md` 的旧口径黑名单。
2. Cursor prompt 必须明确：后端/前端不在 B1 写入范围。
3. B1 必须产出 fixture，供后端/前端后续 contract test 使用。

进入后端整改前：

1. B1 DTO 与 fixture 已稳定。
2. 后端 prompt 限定写入 `C:\project\damage_backend_dev`。
3. 后端 prompt 明确不启动 Wasm runtime，只输出 canonical catalog/payload contract。

进入前端整改前：

1. A1 目标 ABI 可通过 Node smoke。
2. B1 fixture 可被 Worker adapter 单测或 mock 读取。
3. 前端 prompt 限定写入 `C:\project\damage_web_dev`。
4. 前端 prompt 明确旧 DPS 页面或旧 adapter 只能作 compat，不作为新主线。

## 9. 待确认事项

当前只有一个需要在 B1 后确认的设计分叉：

推荐方案：Wasm B1 的 Go DTO + `internal/testkit/fixtures` 作为 executable contract 真源；后端和前端各自消费 fixture 或生成类型。

备选方案：另建跨仓 shared schema package，后端、前端、Wasm 同时依赖。

本方案默认采用推荐方案。只有当后端和前端需要在 B1 完成前并行大规模开发 DTO 代码时，才切到备选方案。
