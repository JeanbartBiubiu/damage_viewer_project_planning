TASK_KEY: wasm-katarina-mvp
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: pending

# 卡特琳娜 MVP 实施方案

## 1. 目标

本轮只做一个最小闭环，验证这条链路能跑通：

`DB 落库 -> Server 创建版本/写入/Publish/产出 Bundle -> Web 拉取 current + bundle -> Wasm 运行最小输入并返回结果`

该闭环不追求完整还原卡特琳娜机制，只验证平台主链路成立。

---

## 2. MVP 子集

### 2.1 保留内容

- 游戏：`lol`
- 版本：`mvp_katarina_001`
- 英雄：2 个
  - `hero_katarina`
  - `hero_dummy_10000hp_100ar_100mr`
- 技能：2 个
  - `skill_katarina_basic_attack`
  - `skill_katarina_r`
- 装备：2 件
  - `item_blade_of_the_ruined_king`
  - `item_nashors_tooth`
- 场景：2 个
  - `S0`：无装备，平A 10 下
  - `S1`：无装备，完整 R

### 2.2 最小属性集合

首轮只保留会进入本次计算和展示的属性：

- `hp`
- `ad`
- `ap`
- `attack_speed`
- `armor`
- `magic_resist`
- `ability_haste`

可选但不阻断本轮闭环的属性：

- `move_speed`
- `physical_pen`
- `magic_pen`

### 2.3 本轮不做

- Q / W / E / 被动
- 6 装、符文、假人防御装备扩展
- type / type_relations / coefficient_buckets / status_action_control_rules 的业务使用
- formula_profiles / formula_bindings 的业务使用
- 真实 Wasm 二进制编译与 Worker 通信优化
- 多目标、多单位、打断、护盾、治疗

---

## 3. 模块边界

### 3.1 数据层

职责：存最小验证数据，不扩展到完整编辑器模型。

本轮必须落库的表：

- `games`
- `owner_categories`
- `game_versions`
- `attribute_definitions`
- `heroes`
- `skills`
- `items`

本轮允许保持空集但不删除的表：

- `types`
- `type_relations`
- `formula_profiles`
- `formula_bindings`
- `coefficient_buckets`
- `status_action_control_rules`

边界结论：

- 首轮 Bundle 可以继续输出这些空数组，但 MVP 业务不依赖它们。
- 这样可以最大化复用现有 `publish -> buildBundle` 链路，最小化改动面。

### 3.2 服务层

职责：复用现有后台版本管理和发布能力，保证 MVP 数据可以通过标准接口进入发布链。

本轮最小接口子集：

- `POST /api/admin/games/{gameId}/versions`
- `PUT /api/admin/games/{gameId}/attribute-definitions/{attrKey}`
- `PUT /api/admin/games/{gameId}/heroes/{heroId}`
- `PUT /api/admin/games/{gameId}/skills/{skillId}`
- `PUT /api/admin/games/{gameId}/items/{itemId}`
- `POST /api/admin/games/{gameId}/versions/{versionId}:publish`
- `GET /api/games/{gameId}/versions/current`
- `GET /api/games/{gameId}/versions/{versionId}/bundle`

边界结论：

- 不新增专用 MVP 接口。
- MVP 必须走正式 admin/public 链路，避免后续返工。

### 3.3 计算层

职责：定义一个可替换的最小运行协议，先跑出结果。

本轮计算范围：

- 1v1
- self + enemy
- action plan 仅支持：
  - `basic_attack` with `count`
  - `cast_skill` for `skill_katarina_r`
- 输出仅支持：
  - 总伤害
  - 最终剩余生命
  - 持续时间
  - 样本点列表

边界结论：

- 本轮计算层可以是“Wasm 适配接口 + 最小可运行实现”，不要求先落成真实 `.wasm` 二进制。
- 但输入输出结构必须明确，后续能替换为真实 Wasm。

### 3.4 展示层

职责：只做一个最小验证页，不做通用编辑器。

本轮页面职责：

- 拉取 `current`
- 拉取 `bundle`
- 选择 2 个场景之一
- 组装最小运行输入
- 展示运行结果

边界结论：

- 页面只服务卡特琳娜 MVP，不抽象成通用战斗平台页面。

### 3.5 测试层

职责：验证主链路，不追求覆盖率。

本轮最小验证点：

- 后端发布后能拿到 `current`
- 后端发布后能拿到包含卡特/假人/2 技能/2 装备的 `bundle`
- Web 能正确拉取并消费 `current + bundle`
- 运行层能对 `S0 / S1` 返回非空结果

---

## 4. 交付顺序

### 第 1 步：冻结 MVP 契约与数据子集

- 确认 2 hero / 2 skill / 2 item / 7 个属性
- 确认 ID 命名规则
- 确认场景只做 `S0 / S1`

产出：

- 本文档

### 第 2 步：准备最小验证数据

- 从 `最小验证/卡特琳娜.md` 和 `最小验证/数据/` 提取卡特基础属性、R 最小参数、2 件装备数值
- 整理成可直接调用 admin 接口写入的最小数据集

产出：

- 一份最小种子数据

### 第 3 步：打通后端发布闭环

- 用现有 admin 接口写入最小数据
- 发布版本
- 验证 `current + bundle`

产出：

- 一条可复跑的后端验证路径
- 至少一组发布流测试或运行脚本

### 第 4 步：定义最小运行协议

- 定义最小输入
- 定义最小输出
- 定义 `S0 / S1` 所需动作计划

产出：

- 可替换的 Wasm MVP 输入输出契约

### 第 5 步：完成 Web 最小场景页

- 消费 `current + bundle`
- 组装输入
- 调用运行层
- 展示结果

产出：

- 1 个最小验证页面

### 第 6 步：联调验收

- 完整走通一次 `S0`
- 完整走通一次 `S1`

产出：

- MVP 闭环确认结果

---

## 5. 现状缺口

## 5.1 当前已具备

- `db/game_manage/schema.sql` 已有核心实体表和版本化结构
- `server/data_manage` 已有：
  - 版本创建
  - 发布
  - `current`
  - `bundle`
  - hero / skill / item / attribute 的 admin upsert
- `web` 已有：
  - games / current / bundle 的基础调用能力
  - 基础页面骨架
- `wasm/` 已有：
  - 通用协议和设计文档

## 5.2 当前缺失

- 没有一份“卡特 MVP 最小数据集”作为正式种子
- 没有卡特 MVP 的专用验证页面
- 没有最小可运行的 Wasm 实现或等价适配层
- 现有设计文档偏通用，缺少一份明确的“MVP 子集裁剪方案”
- `attribute_definitions.value_kind / rate_target_attr_key` 在 DB 有设计，但服务层契约仍未完整透出

## 5.3 结论

本轮真正阻断闭环的不是大而全设计，而是以下 4 件事：

- 最小种子数据
- 最小运行协议
- 最小场景页
- 一条可复跑的验证路径

---

## 6. 低冲突写入建议

为避免多人同时修改同一文件，建议按目录切分：

### 6.1 方案与数据文档

建议写入范围：

- `最小验证/`

建议内容：

- MVP 实施方案
- 最小种子数据
- 验证路径说明

### 6.2 后端

建议写入范围：

- `server/data_manage/src/main/java/...`
- `server/data_manage/src/main/resources/mapper/...`
- `server/data_manage/src/test/java/...`
- `接口/game_manage/接口定义.md`

建议只动：

- attribute 定义契约补齐
- 最小发布流测试
- 必要的 bundle 字段同步

### 6.3 Wasm / 运行层

建议写入范围：

- `wasm/`
- 或 `web/src/.../engine/`

建议只动：

- 输入输出协议
- 最小 runner
- 不碰 Web 页面和服务请求层

### 6.4 Web 平台层

建议写入范围：

- `web/src/services/`
- `web/src/types/`
- `web/src/config/`
- `web/src/App.tsx`

建议只动：

- current + bundle 获取
- 通用状态管理
- 页面挂载入口

### 6.5 Web 场景页

建议写入范围：

- `web/src/pages/KatarinaMvpPage.tsx`
- `web/src/.../katarina-mvp/`

建议只动：

- 场景输入组装
- 结果展示
- 不改公共请求层

### 6.6 测试

建议写入范围：

- `server/data_manage/src/test/java/...`
- `最小验证/`

建议只动：

- 发布流验证
- 场景回归说明

---

## 7. 实施原则

- 先验证链路，再扩技能和规则
- 优先复用现有接口，不开旁路
- 优先固定最小输入输出，不提前泛化
- 本轮只要求 `S0 / S1` 跑通
- 所有新增契约变更必须同步记录到文档

---

## 8. 本轮完成定义

满足以下条件即可判定本轮 MVP 方案收敛完成：

- 已明确只做 2 hero / 2 skill / 2 item / 2 场景
- 已明确数据层、服务层、计算层、展示层、测试层边界
- 已明确实现顺序
- 已明确当前仓库哪些能复用、哪些仍缺
- 已明确多人并行时的低冲突写入范围
