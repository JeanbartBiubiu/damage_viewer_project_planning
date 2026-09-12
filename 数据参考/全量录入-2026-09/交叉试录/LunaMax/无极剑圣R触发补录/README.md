# 无极剑圣 masteryi_r 触发补录

本目录保存 masteryi_r/on_used 的只读候选材料。目标动作是执行已有 attack_speed、move_speed，没有任何业务写入。

文件说明：

- `01-来源方案.md`：固定来源、规则范围、排除项和相关但暂缓/待补项。
- `02-冻结请求.json`：精确拟议请求，供独立评审；本目录脚本不会发送它。
- `03-来源快照.json`：16.17/16.17.1 资料摘录及文件散列。
- `04-写入前现值.json`：目标技能组成、关系、图片、候选 404 和全局旧规则双轮 GET 保护快照。
- `05-只读准备报告.json`：GET 计数、基线、结果核对、建议状态和相关但暂缓/待补项。
- `体验报告.md`：管理录入范围与未覆盖行为的体验边界。

运行入口：

`powershell
$env:DAMAGE_ENTRY_TOKEN = (New-Guid).Guid
node ".\准备只读.mjs"
Remove-Item Env:DAMAGE_ENTRY_TOKEN
`

脚本只调用 GET；令牌不会写入或输出。
