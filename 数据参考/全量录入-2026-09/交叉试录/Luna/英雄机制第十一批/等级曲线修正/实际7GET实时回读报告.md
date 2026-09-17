# 英雄11七项实时GET独立回读

结论：通过。请求文件散列：`922f213e781fea8ab8cec893f8cec096382cfaca2cd2e7518958a8e7df636599`。本次只读请求7条，业务写入：0。

本次脚本直接向本地管理接口读取6个参数和1个公式，逐项记录状态、完整返回对象和对象散列。6个参数实时值均为 `RUNTIME_INPUT`，`fixedValue` 与 `levelValues` 均为 `null`；参数键、公式键、名称、排序和类型等身份字段保持。

格温实时公式确认是“0.67×实际对英雄伤害”与“等级上限基础值+0.07×总法强”的较小值。独立算例得到6.7、37、67；缺少 `heal_cap_level` 时拒绝计算。

这份证据只证明本次接口实时GET返回值和表达式核对，不证明战斗运行或页面验收。

## 实时对象散列

- /skills/irelia_p/parameters/single_stack_attack_speed_percent：HTTP 200；SHA-256（返回JSON）`b51506f9040c51d932e1fa6a5ada761ad9d83bddd43b3154d0eb3f2121a3aa1a`
- /skills/irelia_w/parameters/final_physical_reduction_percent：HTTP 200；SHA-256（返回JSON）`6fedbe27189a9711848f2bd813a180fe49169ab48e63ee2847e240504983ff64`
- /skills/fiora_p/parameters/passive_heal_amount：HTTP 200；SHA-256（返回JSON）`5c480d203e0cfd55be489a7ae401bbc3fdd9644f53e271142b0d8029cf20b8b7`
- /skills/gwen_p/parameters/heal_cap_level：HTTP 200；SHA-256（返回JSON）`e08f9d924fed6527b26aa9d84f9bd95710436e620170b24972078f2657934a35`
- /skills/camille_p/parameters/passive_cooldown_seconds：HTTP 200；SHA-256（返回JSON）`98025c3cf664ffe32715f0c4d70239ba37a2573d0348a056e5227b241f649564`
- /skills/camille_p/parameters/shield_level_ratio：HTTP 200；SHA-256（返回JSON）`3f501e745b6c0651541fe50964c0b78453e481d72f62c90f86124d6c7fcc56e2`
- /skills/gwen_p/formulas/passive_heal_amount：HTTP 200；SHA-256（返回JSON）`8d59b3171972c832ff69c6c3624b9f21f214ee44bca08b940e7d01e872609c29`

## 检查结果

- 通过：/skills/irelia_p/parameters/single_stack_attack_speed_percent实时GET状态为200
- 通过：/skills/irelia_p/parameters/single_stack_attack_speed_percent实时返回字段匹配修正请求
- 通过：/skills/irelia_p/parameters/single_stack_attack_speed_percent身份字段与修正前一致
- 通过：/skills/irelia_w/parameters/final_physical_reduction_percent实时GET状态为200
- 通过：/skills/irelia_w/parameters/final_physical_reduction_percent实时返回字段匹配修正请求
- 通过：/skills/irelia_w/parameters/final_physical_reduction_percent身份字段与修正前一致
- 通过：/skills/fiora_p/parameters/passive_heal_amount实时GET状态为200
- 通过：/skills/fiora_p/parameters/passive_heal_amount实时返回字段匹配修正请求
- 通过：/skills/fiora_p/parameters/passive_heal_amount身份字段与修正前一致
- 通过：/skills/gwen_p/parameters/heal_cap_level实时GET状态为200
- 通过：/skills/gwen_p/parameters/heal_cap_level实时返回字段匹配修正请求
- 通过：/skills/gwen_p/parameters/heal_cap_level身份字段与修正前一致
- 通过：/skills/camille_p/parameters/passive_cooldown_seconds实时GET状态为200
- 通过：/skills/camille_p/parameters/passive_cooldown_seconds实时返回字段匹配修正请求
- 通过：/skills/camille_p/parameters/passive_cooldown_seconds身份字段与修正前一致
- 通过：/skills/camille_p/parameters/shield_level_ratio实时GET状态为200
- 通过：/skills/camille_p/parameters/shield_level_ratio实时返回字段匹配修正请求
- 通过：/skills/camille_p/parameters/shield_level_ratio身份字段与修正前一致
- 通过：/skills/gwen_p/formulas/passive_heal_amount实时GET状态为200
- 通过：/skills/gwen_p/formulas/passive_heal_amount实时返回字段匹配修正请求
- 通过：/skills/gwen_p/formulas/passive_heal_amount身份字段与修正前一致
- 通过：实时回读正好包含6个参数和1个公式
- 通过：6个参数均为RUNTIME_INPUT且没有固定或等级默认值
- 通过：格温实时公式为实际伤害治疗与HealCap的MIN
- 通过：实时公式独立算例：治疗低于上限
- 通过：实时公式独立算例：治疗超过上限
- 通过：实时公式独立算例：高上限下治疗未超过
- 通过：实时公式缺少heal_cap_level时拒绝计算

结构化证据：`C:\project\damage_web_dev\.agents\artifacts\hero11-root-review\实际7GET实时回读.json`。
