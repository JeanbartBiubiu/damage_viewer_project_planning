# 挺进破坏者主动触发补录

本目录保存挺进破坏者 item_6631_active 的主动命中触发补录准备证据。范围只有：运行时确认该技能命中英雄后，在 CURRENT_TARGET 上执行已经存在的 active_hit。

冻结规则使用 SKILL_HIT，事件明细只写 sourceSkillKey=item_6631_active；条件为 TARGET_CATEGORY_CHECK 且类别只有 CHAMPION；动作目标上下文为 CURRENT_TARGET，效果键为 active_hit。perTargetCooldown 和 maxTriggersPerProcess 均为 null。

本批不重复创建 active_hit，不补减速、自身移动速度、范围、衰减、主动施放过程或冷却，也不新增技能伤害事件分支。SKILL_HIT 请求不臆测 useKind 字段。

文件用途：

- 01-来源方案.md：来源、现有组成、冻结边界和停止条件。
- 准备只读.mjs：读取固定来源并执行真实后端 GET，只在本目录生成证据。
- 02-冻结请求.json：唯一待执行的规则 POST。
- 03-来源快照.json：来源文件散列、挺进破坏者候选和客户端关键值。
- 04-写入前现值.json：目标全部非规则组成、引用目录以及全量规则列表和详情保护快照。
- 05-只读准备报告.json：READY 或 REVISE、GET 数量、状态统计、基线和单一 POST 边界。

最低检查（在仓库根目录执行）：

    node --check "数据参考/全量录入-2026-09/交叉试录/挺进破坏者主动触发补录/准备只读.mjs"
    node "数据参考/全量录入-2026-09/交叉试录/挺进破坏者主动触发补录/准备只读.mjs"

脚本使用本机管理接口的 GET。若存在 DAMAGE_ENTRY_TOKEN，只使用环境变量中的认证值，不把认证值写入证据；未设置时按当前本机认证配置发送无认证 GET。脚本不执行 Git 操作，不发送 POST、PUT、PATCH 或 DELETE。

脚本成功后，主负责人应独立核对 02-冻结请求.json，然后只执行其中唯一 POST。返回 201 后立即 GET 规则详情，检查 SKILL_HIT、sourceSkillKey、CHAMPION、CURRENT_TARGET、active_hit 和两个空冷却字段。证据只覆盖来源、管理数据读状态和写前保护，不覆盖业务写入后的回读、浏览器或战斗运行时。
