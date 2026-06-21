TASK_KEY: wasm-min-validation-data-spec
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: pending

# LoL MVP Type Taxonomy 说明

## 字段
- `key`：稳定类型 key，建议你先做一张 `key -> type_id` 映射表，再批量导入 `types`
- `parent_key`：父类型 key；为空表示顶级类型
- `name`：展示名
- `applies_to`：建议挂载目标，和 `type_relations.target_category` 对应关系大致如下：
  - `character` -> `character`
  - `skill` -> `skill`
  - `equipment` -> `equipment`
  - `type` -> `type`
  - 多值时用 `|` 分隔，表示这个类型可以复用在多个目标类别
- `source`：
  - `local.*`：直接来自你仓库现有数据口径
  - `modeling.*`：为了 MVP 落库补充的建模类型

## 关系表生成建议
- `types`：每一行 `key` 生成一条 type 记录
- `type_relations`：对所有 `parent_key` 非空的行，生成一条 `child -> parent` 的 `target_category = type` 关系

## 这份表的用途
- 技能相关：技能范围、结构、效果、伤害、控制、护盾、暴击、位移、资源、触发
- 装备相关：装备标签、装备层级、装备机制
- 符文/天赋相关：符文路径、槽位、效果、当前 MVP 用到的基石符文
- 海克斯相关：强化稀有度、强化效果类型
