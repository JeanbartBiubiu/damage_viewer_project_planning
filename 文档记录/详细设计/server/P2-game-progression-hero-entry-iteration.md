TASK_KEY: server-p2-game-progression-hero-entry
DOC_TYPE: 详细设计
WORKSTREAM: server
STATUS: draft
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-04-30

# P2 游戏阶段配置 + 英雄属性录入优化 迭代方案

## 关联任务

- 任务名称：P2 按 `game_id` 配置阶段制度 + 英雄录入体验优化
- 任务目标：消除硬编码 `1~18` 级依赖；属性自动展开减少手工操作
- 任务类型：全栈迭代（DB + 后端 API + 前端页面改造）
- 工作流模块：server / web
- 关联背景：原后端整改 TODO 中的 P2 阶段制度问题已由本方案承接。

## 背景

1. **阶段硬编码**：当前 `StatsByLevelEditor` 和 `heroStats.ts` 中将级别数硬编码为 `18`（LOL 经典等级）。不同游戏可能存在 `1~20`、`1~30`、`1~3★`、`1~4★` 等阶段制度，需要全局可配置。
2. **属性手动添加效率低**：`BaseStatsEditor` 和 `StatsByLevelEditor` 均采用"先点击**添加属性**再选择 attrKey"的模式，用户每次录入一个新英雄需手工添加 20+ 行属性，效率极低且易遗漏。
3. **两区分离增加认知成本**：baseStats（基础属性）与 statsByLevel（每级属性快照）分属两个独立编辑区，用户需自行判断某个属性该填哪个区域。

## 目标

| # | 目标 | 验收标准 |
|---|------|----------|
| G1 | 游戏阶段制度全局可配置 | 切换不同 `game_id` 时，录入界面阶段列数自动变化；不符合该游戏阶段制度的数据无法入库 |
| G2 | 属性自动展开 | 新增/编辑英雄时，所有该游戏已定义的属性自动预填为行，用户直接填数值即可 |
| G3 | baseStats 与 statsByLevel 合并为统一矩阵 | 一行 = 一个属性，列 = base 值 + Lv1 ~ LvN，减少认知成本 |
| G4 | 移除硬编码 `18` | 前端不再有任何 `length: 18` 或 `level > 18` 的硬编码 |

## 范围

### 包含

- DB：新增 `game_progression_schema` 表
- 后端：新增阶段配置 CRUD API；英雄写入时对阶段范围做语义校验
- 前端：改造英雄编辑弹窗，合并属性矩阵，动态阶段列
- 前端：`games` 列表或上下文中携带阶段配置信息

### 不包含

- 技能/装备录入页面的阶段相关改造（后续单独迭代）
- 属性定义分组/分类管理（不新增 attr_type 过滤，全部展开）
- 历史数据迁移（已有 LOL 数据保持 18 级不受影响）

---

## 方案

### 一、DB 层：`game_progression_schema` 表

```sql
CREATE TABLE public.game_progression_schema (
    game_id          varchar(64) NOT NULL REFERENCES public.games(game_id),
    progression_kind varchar(16) NOT NULL DEFAULT 'LEVEL'
                     CHECK (progression_kind IN ('LEVEL', 'STAR')),
    stage_min        int         NOT NULL DEFAULT 1,
    stage_max        int         NOT NULL DEFAULT 18,
    stage_label      varchar(32) NOT NULL DEFAULT 'Lv',
    require_all_stages boolean   NOT NULL DEFAULT true,
    updated_at       timestamp   NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_game_progression_schema PRIMARY KEY (game_id),
    CONSTRAINT ck_stage_range CHECK (stage_min >= 1 AND stage_max >= stage_min AND stage_max <= 100)
);

COMMENT ON TABLE  public.game_progression_schema IS '按游戏配置的阶段制度（等级/星级）';
COMMENT ON COLUMN public.game_progression_schema.progression_kind IS 'LEVEL=等级制, STAR=星级制';
COMMENT ON COLUMN public.game_progression_schema.stage_label IS '前端展示标签前缀，如 Lv / ★';
COMMENT ON COLUMN public.game_progression_schema.require_all_stages IS '是否要求填满所有阶段（true=缺阶段报错）';
```

**设计要点**：
- 一个 `game_id` 对应一条阶段配置，主键 = `game_id`。
- 不纳入版本管理（属于游戏级别全局元数据，与 `games` 表同级）。
- `stage_label` 支持前端直接渲染列头（`Lv1` / `★1`）。
- 若某游戏未配置，后端 fallback 返回默认 `{LEVEL, 1, 18, "Lv", true}`。

### 二、后端 API

#### 2.1 阶段配置接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/admin/games/{gameId}/progression-schema` | 获取阶段配置 |
| `PUT` | `/api/admin/games/{gameId}/progression-schema` | 创建/更新阶段配置 |

**GET 响应示例**：
```json
{
  "gameId": "lol",
  "progressionKind": "LEVEL",
  "stageMin": 1,
  "stageMax": 18,
  "stageLabel": "Lv",
  "requireAllStages": true
}
```

**PUT 请求体**：
```json
{
  "progressionKind": "LEVEL",
  "stageMin": 1,
  "stageMax": 18,
  "stageLabel": "Lv",
  "requireAllStages": true
}
```

**业务规则**：
- 若表中无该 `game_id` 记录，GET 返回默认值（不报 404）。
- PUT 执行 UPSERT。
- `stageMax` 上限 100，`stageMin` ≥ 1。

#### 2.2 英雄写入校验增强

现有 `PUT /api/admin/games/{gameId}/heroes/{heroId}` 保存逻辑增加：

1. 查询该 `game_id` 的 `game_progression_schema`（无则取默认 18 级）。
2. 对 `statsByLevel` 中的阶段范围校验：
   - 每个属性的数组长度 = `stageMax - stageMin + 1`。
   - 不允许存在超出 `[stageMin, stageMax]` 的阶段 key。
3. 若 `require_all_stages = true`，所有适用属性必须 **每个阶段都有值**（可为 0，不可缺阶段）。
4. 校验失败返回 `400` + 明确错误信息。

#### 2.3 Public API / Bundle 影响

`game_progression_schema` 作为游戏元数据，需在以下接口中暴露给前端：
- `GET /api/games` 响应扩展：每个 `GameSummary` 增加 `progressionSchema` 字段。
- 或单独 `GET /api/games/{gameId}/progression-schema`（Public，无需鉴权）。

**建议**：在 `GET /api/games` 中 inline 返回，减少前端请求数。

### 三、前端改造

#### 3.1 类型扩展

```typescript
// types/api.ts
export type GameProgressionSchema = {
  progressionKind: 'LEVEL' | 'STAR';
  stageMin: number;
  stageMax: number;
  stageLabel: string;
  requireAllStages: boolean;
};

// GameSummary 扩展
export type GameSummary = {
  gameId: string;
  gameName: string;
  gameImgUrl?: string;
  progressionSchema?: GameProgressionSchema;
};
```

#### 3.2 合并属性矩阵组件 `HeroStatsMatrixEditor`

替换当前的 `BaseStatsEditor` + `StatsByLevelEditor`，合并为统一矩阵。

**布局设计**：

```
┌─────────────┬────────┬────────┬────────┬───┬────────┐
│  属性       │  base  │  Lv1   │  Lv2   │...│  Lv18  │
├─────────────┼────────┼────────┼────────┼───┼────────┤
│ ♥ hp        │  570   │  570   │  625   │...│  2120  │
│ ⚔ ad        │   58   │   58   │   61   │...│  112   │
│ 🛡 armor    │   28   │   28   │   31   │...│  87    │
│ ...         │  ...   │  ...   │  ...   │...│  ...   │
│ ⬆ ad_g      │  3.2   │   —    │   —    │...│   —    │
└─────────────┴────────┴────────┴────────┴───┴────────┘
```

**核心行为**：

| 特性 | 说明 |
|------|------|
| 自动展开 | 打开弹窗时，读取当前 `game_id` 的所有 `attribute_definitions`，自动生成每个属性一行 |
| 列数动态 | 根据 `progressionSchema.stageMin ~ stageMax` 动态渲染列头和输入格 |
| 列头标签 | 使用 `stageLabel` + 阶段号，如 `Lv1` / `★1` |
| 默认值 | 每个属性行的 base 列和阶段列默认填 `attributeDefinition.defaultValue`（通常为 `0`） |
| 已有数据回填 | 编辑已有英雄时，已录入的值回填到对应单元格，未录入的属性行保持默认值 |
| base 列 | 固定在左侧，对应 `baseStats[attrKey]` |
| 阶段列 | 对应 `statsByLevel[attrKey][levelIndex]` |
| 仅 base 的属性 | 某些属性（如成长系数 `ad_g`）只需填 base 值，阶段列显示为禁用/灰色 `—` |
| 行不可删除 | 所有已定义属性行固定展示，不提供删除按钮（确保完整性） |
| 行排序 | 按属性定义的返回顺序（或按 `attrKey` 字母序） |
| 虚拟滚动 | 属性数量较多（50+）时，矩阵区域使用虚拟滚动保证性能 |
| 水平滚动 | 阶段列数多时（18+），列区域水平滚动，属性名列固定 |

**关于 "仅 base" vs "有阶段数据" 的判断**：

当前没有在 `attribute_definitions` 上标记哪些属性需要逐级填写。方案：

- **默认策略**：所有属性都展开 base + 阶段列，用户可以选择不填阶段列（值保持 0）。
- 保存时，若某属性的阶段列全为 0 且 base 有值，则仅存入 `baseStats`，不写入 `statsByLevel`。
- 若某属性的阶段列有非零值，则存入 `statsByLevel`。
- 这样**不需要额外的元数据**来区分，由用户的实际填写行为决定。

#### 3.3 `heroStats.ts` 重构

```typescript
// 新增类型
export type HeroStatsMatrixRow = {
  attrKey: string;
  attrName: string;          // 从 attribute_definitions 取
  baseValue: number;          // 对应 baseStats[attrKey]
  levelValues: number[];      // 对应 statsByLevel[attrKey]，长度 = stageMax - stageMin + 1
};

// 新增：从 JSON 解析为矩阵
export function parseHeroStatsMatrix(
  baseStatsText: string,
  statsByLevelText: string,
  definitions: AttributeDefinition[],
  stageCount: number
): HeroStatsMatrixRow[];

// 新增：从矩阵序列化为 JSON
export function stringifyHeroStatsMatrix(
  rows: HeroStatsMatrixRow[]
): { baseStatsText: string; statsByLevelText: string };

// 移除 createLevelArray 的硬编码 18
export function createLevelArray(length: number, fillValue = 0): number[];
```

**解析逻辑**：
1. 遍历所有 `definitions`，每个 `attrKey` 生成一行。
2. 从 `baseStats` JSON 中取 `baseValue`，取不到则用 `definition.defaultValue ?? 0`。
3. 从 `statsByLevel` JSON 中取 `levelValues` 数组，长度归一化为 `stageCount`。
4. 排序：有数据的行优先，其次按 `attrKey` 字母序。

#### 3.4 弹窗改造 (`modal.tsx`)

**改动点**：

1. 移除 `<BaseStatsEditor>` 和 `<StatsByLevelEditor>` 两个独立组件引用。
2. 替换为 `<HeroStatsMatrixEditor>` 统一矩阵组件。
3. `formData` 中仍保留 `baseStatsText` + `statsByLevelText`（JSON 文本），矩阵组件内部双向同步。
4. 传入 `progressionSchema`（从上层 context 获取）和 `definitions`。
5. "高级 JSON 编辑" 折叠区保留，继续支持手动 JSON 编辑双向同步。

#### 3.5 阶段配置管理入口

在**系统管理 / 游戏管理**页面中（若有），或在英雄管理页面顶部，增加：

- 显示当前游戏的阶段配置摘要：`"等级制 Lv1 ~ Lv18, 要求填满全部阶段"`。
- 可编辑按钮 → 弹窗修改阶段配置（调用 PUT 接口）。
- 修改后刷新英雄编辑器的列数。

---

## 数据与接口影响

| 层 | 影响项 | 变更类型 |
|----|--------|----------|
| DB | 新增 `game_progression_schema` 表 | 新增 |
| 后端 | `GET/PUT /api/admin/games/{gameId}/progression-schema` | 新增接口 |
| 后端 | `GET /api/games` 响应扩展 `progressionSchema` 字段 | 兼容扩展 |
| 后端 | `PUT heroes` 增加阶段范围校验 | 增强校验 |
| 前端 | `GameSummary` 类型扩展 | 兼容扩展 |
| 前端 | 新增 `GameProgressionSchema` 类型 | 新增 |
| 前端 | 新增 `HeroStatsMatrixEditor` 组件 | 新增（替代旧组件） |
| 前端 | `heroStats.ts` 重构 | 兼容重构 |
| 前端 | `modal.tsx` 改造 | 改造 |
| 前端 | `apiClient.ts` 新增 progression-schema 接口 | 新增 |

**向后兼容**：
- `GET /api/games` 新增字段为可选，老前端不受影响。
- `statsByLevel` JSON 格式不变（`{ attrKey: number[] }`），后端无破坏性变更。
- 未配置 `game_progression_schema` 的游戏，fallback 默认 `1~18`，与现状一致。

---

## 实施步骤

### Phase 1：后端 — 阶段配置（2 天）

| 步骤 | 内容 |
|------|------|
| 1.1 | 执行 DDL：创建 `game_progression_schema` 表 |
| 1.2 | 新增 `GameProgressionSchema` 实体 + MyBatis Mapper |
| 1.3 | 新增 `ProgressionSchemaController`（admin）：GET / PUT |
| 1.4 | 扩展 `GET /api/games` 响应，inline 返回 `progressionSchema` |
| 1.5 | 为 LOL 插入默认记录：`{LEVEL, 1, 18, "Lv", true}` |

### Phase 2：后端 — 英雄写入校验（1 天）

| 步骤 | 内容 |
|------|------|
| 2.1 | `HeroesService.putHero()` 中引入阶段校验逻辑 |
| 2.2 | 校验 `statsByLevel` 数组长度 = `stageMax - stageMin + 1` |
| 2.3 | `require_all_stages` 时检查不可缺阶段 |
| 2.4 | 补充集成测试（`ControllerPublishFlowIT` 增加阶段校验用例） |

### Phase 3：前端 — 合并矩阵组件（3 天）

| 步骤 | 内容 |
|------|------|
| 3.1 | `types/api.ts` 新增 `GameProgressionSchema`，扩展 `GameSummary` |
| 3.2 | `apiClient.ts` 新增 `getProgressionSchema` / `putProgressionSchema` |
| 3.3 | `heroStats.ts` 重构：新增 `HeroStatsMatrixRow` 类型、`parseHeroStatsMatrix`、`stringifyHeroStatsMatrix`，`createLevelArray` 接受动态长度 |
| 3.4 | 新增 `HeroStatsMatrixEditor` 组件：统一矩阵、固定左列、虚拟滚动 |
| 3.5 | 改造 `modal.tsx`：替换双编辑器为 `HeroStatsMatrixEditor`，传入 `progressionSchema` + `definitions` |
| 3.6 | 保留"高级 JSON 编辑"折叠区的双向同步 |

### Phase 4：前端 — 阶段配置管理 UI（1 天）

| 步骤 | 内容 |
|------|------|
| 4.1 | 英雄管理页顶部显示当前游戏阶段配置摘要 |
| 4.2 | 提供编辑弹窗修改阶段配置 |
| 4.3 | 修改后自动刷新英雄编辑器的矩阵列数 |

### Phase 5：回归验证（1 天）

| 步骤 | 内容 |
|------|------|
| 5.1 | LOL 游戏：verify 18 级矩阵录入 → 保存 → 读取回显一致 |
| 5.2 | 模拟其他游戏（如 TFT 3 星制）：verify 3 级矩阵录入正常 |
| 5.3 | 未配置阶段的游戏 fallback 18 级，行为与迭代前一致 |
| 5.4 | 已有英雄数据编辑回显 — 无数据丢失 |
| 5.5 | Publish 后 bundle 中 `statsByLevel` 格式无变化 |

---

## 验收或检查方式

- [ ] 切换不同 `game_id` 时，录入界面阶段列数自动变化（如 18 级 → 3 星）。
- [ ] 新增英雄时，所有属性行自动展开，无需手动添加。
- [ ] baseStats 与 statsByLevel 在同一矩阵中编辑，列包含 base + Lv1~LvN。
- [ ] 不符合该游戏阶段制度的数据保存时后端返回 400。
- [ ] 代码中不再有 `length: 18` 或 `level > 18` 的硬编码。
- [ ] 已有 LOL 英雄数据编辑回显正常，无数据丢失。
- [ ] Publish 后 bundle 格式向后兼容。

## 风险与待确认项

| # | 风险/待确认 | 应对 |
|---|-------------|------|
| R1 | 50+ 属性 × 18 级 = 900+ 输入格，矩阵渲染性能 | 虚拟滚动 + 行懒加载；属性名列固定 |
| R2 | 某些属性只需 base 值不需要逐级数据，用户可能困惑 | 保存时自动判断：阶段列全 0 → 仅存 baseStats；tooltip 提示 |
| R3 | 修改阶段配置后已有英雄数据不兼容（如从 18 级改为 20 级） | 扩展时自动补 0；缩短时截断并发出确认提示 |
| R4 | `statsByLevel` 存储格式变动影响 Wasm 引擎消费 | 格式不变（`{ attrKey: number[] }`），仅数组长度变化；Wasm 端按数组实际长度读取 |

## 治理记录

- `2026-04-04`：首次创建，基于 P2 待办项 + 英雄录入体验优化需求撰写迭代方案。
