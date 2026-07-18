TASK_KEY: web-console-non-wasm-iteration
DOC_TYPE: 测试记录
WORKSTREAM: web
STATUS: tracked
EXECUTION_MODEL: cursor-grok-4.5
LAST_TRACKED_AT: 2026-07-18

# 非 Wasm 最小回归清单

更新时间：2026-07-18

本文档是可复用的**检查清单**，不是某次已通过的 live 验证报告。后续迭代按固定顺序勾选并填写下方结果模板；**不得**因本文档存在而声称已执行 live 跑通。

## 1. 范围

默认非 Wasm 路径覆盖：

- 系统总览（`#/overview`）
- 版本发布（`#/workspace`）
- 图片缓存（`#/images`）
- 最小 Admin 子集（见固定顺序）

明确排除：

- 通用 Wasm 页的 compile / run / release
- Wasm ABI
- 后端写入自动化

以下路由**不在**默认最小 Admin 子集内：

- `#/entity-growth`
- `#/entity-provider-mount`
- `#/direct-damage-ability`

## 2. 最小环境与数据

| 前置 | 说明 |
| --- | --- |
| API 可达 | 前端已配置的 API 基址可连通 |
| 已选 `gameId` | 工作台上下文中已选择游戏 |
| 独立观察 | 分别观察当前版本与 combat-data state；两侧互不抹掉 |

语义约定：

- `GET .../versions/current` 返回 404 是合法的 `no-current` 观察，**不是** inspect failure。
- 任何 publish 或 Admin 写操作均为**可选**；须使用可丢弃的 game/version，并持有授权 admin token。
- **不得**仅为完成清单而对生产环境发起写操作。

## 3. 固定顺序

严格按下列顺序执行：

1. 静态命令（工作目录 `web/`）：
   - `npm run lint`
   - `npm run typecheck`
   - `npm run test`
   - `npm run build`
2. `#/overview`
3. `#/workspace`：只读观察；可选受控 publish，若执行则随后核验 `#/overview` 与 `#/combat-data/entities`
4. `#/images`
5. 最小 Admin 子集（顺序固定）：
   - `#/entity-setup`
   - `#/provider-setup`
   - `#/ability-setup`
   - `#/effect-sequence-setup`
   - `#/effect-step-setup`
   - `#/combat-data/entities`

路由注意：

- 覆盖实体分表时必须走 **`#/combat-data/entities`**。
- 裸路径 `#/combat-data` 会重定向到 registry 首个资源（当前为 `progression-schema`），**不能**当作 intentional `#/combat-data/entities` 覆盖。

## 4. 记录规则

| 情况 | 记法 |
| --- | --- |
| 缺授权导致受保护写未执行 | `not-run`（不是通过） |
| API / 契约错误 | 失败 |
| 本清单通过 | **不要求**通用 Wasm 验证 |
| 触及 Wasm / ABI / host 或相关 publish gate | 在本默认清单之外，额外跑既有 `npm run smoke:wasm-generic` |

## 5. 结果记录模板

后续迭代复制填写。留空或写 `not-run` 即可；**勿**在未执行时勾选通过。

```text
DATE:
ENVIRONMENT: (API base / gameId / 是否生产)
OPERATOR:

[ ] lint / typecheck / test / build
[ ] #/overview（含 current / combat-data 独立观察；404 current → no-current）
[ ] #/workspace 只读观察
[ ] #/workspace 受控 publish（可选；缺授权 → not-run）
    若执行：#/overview + #/combat-data/entities 核验
[ ] #/images
[ ] #/entity-setup → #/provider-setup → #/ability-setup → #/effect-sequence-setup → #/effect-step-setup → #/combat-data/entities

可选受控写：
- 是否执行：yes / no / not-run
- 失败或跳过原因：

结论：pass / fail / partial（说明）
说明：本次文档变更本身不构成 live 跑通证据。
```
