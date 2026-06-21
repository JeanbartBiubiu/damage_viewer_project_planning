TASK_KEY: wasm-min-validation-data-spec
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-05-10

# LoL竞技场静态文本快照说明

## 目的

在 V2 战斗引擎实现前，先把用于机制覆盖评估的 LoL 静态文本和数值描述落到本地，避免每次分析都临时联网抓取。

当前快照重点覆盖：

- 英雄文本
- 装备文本
- 符文文本
- 竞技场海克斯强化文本

## 数据来源

- Riot Data Dragon
  - `versions.json`
  - `languages.json`
  - `championFull.json`
  - `item.json`
  - `runesReforged.json`
- CommunityDragon
  - 远端路径：`latest/cdragon/arena/<locale>.json`
  - 本地快照输出：`communitydragon/latest/<locale>/arena.json`

说明：

- 英雄、装备、符文来自 Riot 官方 Data Dragon。
- 竞技场海克斯强化来自 CommunityDragon 的 Arena 数据目录。
- CommunityDragon 不是 Riot 官方开发者文档站点，但其内容基于 Riot 游戏资源整理，对 Arena Augments 的静态文本抓取目前可用。

## 抓取脚本

脚本路径：

- `tools/lol-static-data/fetch-lol-static-data.mjs`
- `tools/lol-static-data/classify-lol-static-data.mjs`

默认输出目录：

- `文档记录/详细设计/最小验证/数据/lol_竞技场静态文本快照`

默认抓取语言：

- `en_US` / `en_us`
- `zh_CN` / `zh_cn`

执行方式：

```powershell
node tools/lol-static-data/fetch-lol-static-data.mjs
node tools/lol-static-data/classify-lol-static-data.mjs
```

可选参数：

```powershell
node tools/lol-static-data/fetch-lol-static-data.mjs --output-root C:\tmp\lol-data
node tools/lol-static-data/fetch-lol-static-data.mjs --locales en_US:en_us,zh_CN:zh_cn
```

## 输出结构

```text
lol_竞技场静态文本快照/
  manifest.json
  summary.json
  versions.json
  languages.json
  分类汇总/
    summary.json
    mechanism_taxonomy.json
    entry_index.json
    group_summary.json
    tag_summary.json
    LoL竞技场静态数据分类汇总.md
  ddragon/
    <version>/
      en_US/
        championFull.json
        item.json
        runesReforged.json
      zh_CN/
        championFull.json
        item.json
        runesReforged.json
  communitydragon/
    latest/
      en_us/
        arena.json
      zh_cn/
        arena.json
```

## 用途边界

- 这些文件适合做“机制覆盖预评估”和文本抽样分析。
- 不等价于完整运行时行为定义。
- 召唤物、地形、位移、双人联动等超出当前 `1v1` 数值引擎边界的内容，后续仍要做过滤或转换。

## 分类汇总说明

`classify-lol-static-data.mjs` 会把原始快照进一步整理成“后续机制分析索引”：

- 英雄会拆成“被动/技能”原子入口
- 装备、符文、竞技场强化保持单条入口
- 每条入口都会得到：
  - 一级机制分组
  - 机制标签
  - `in_scope / needs_conversion / out_of_scope` 适配状态

当前分组口径主要服务于：

1. 先做数据分类汇总
2. 再按机制簇挑选 5 个样本做逐组分析
3. 尽量避免后续分组结论互相推翻
