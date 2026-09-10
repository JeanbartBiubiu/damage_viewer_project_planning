# 第五十批修订一独立根审计

审计结论：174个写前请求的请求体、效果结果必填字段、候选稳定标识、当前节点白名单、二元操作、全等级数组、整数排序、生命周期和运行输入约束均通过；固定快照中的技能最高等级逐槽匹配。所有非空伤害类型、属性、乘区和吸收伤害类型引用均能在当前固定目录找到，当前没有非空状态键。

窄语义结论：乌迪尔Q普通附伤、Q普通最大生命附伤、Q觉醒最大生命附伤、乌迪尔R普攻脉冲、艾希Q强化普攻这5个 BASIC_ATTACK 伤害结果当前都写作RESULT。补查后，本地艾希Q原始记录明确spellshield=false，公开Wiki也显示Not Blocked，因此艾希Q当前聚合结果建议改为null；乌迪尔Q三个结果和乌迪尔R脉冲仍没有逐效果护盾事实，不能把RESULT或null当成已证。候选冻结文件保持不变。

艾希Q证据：本地 [ashe-q.wikitext](C:/project/damage_viewer_project_planning/数据参考/lol-wiki-current-champions/raw/ashe-q.wikitext:10) 的原始记录说明五箭、物理伤害、每次只施加一次攻击特效，第20行是spellshield=false，第25-26行说明首段基础伤害和后四段非反应伤害；本地 [generic_ashe_rangers_focus_test.go](C:/project/damage_wasm_dev/wasm/tinygo_engine_v2/internal/runtime/generic_ashe_rangers_focus_test.go:20) 的消费者测试确认每次强化普攻只发一个basic_attack_hit并拆分五箭。公开交叉资料 [League Wiki: Template:Data Ashe/Ranger's Focus](https://wiki.leagueoflegends.com/en-us/Template%3AData_Ashe/Ranger%27s_Focus) 显示Counters Spell shield为Not Blocked，并同样记载on-hit只施加一次。公开页是当前Wiki抓取结果，未标注16.17/16.17.1；候选固定源版本仍优先。

乌迪尔证据：本地固定源文本、DataValues和三个计算树没有护盾范围字段，本地没有相应的护盾消费者；[League Wiki: Template:Data Udyr/Bridge Between](https://wiki.leagueoflegends.com/en-us/Template%3AData_Udyr/Bridge_Between) 只说明觉醒雷电与on-hit是不同组成，返回的spellshield参数为空，也没有给出Q附伤或R脉冲的阻挡粒度。对应 [Wilding Claw](https://wiki.leagueoflegends.com/en-us/Template%3AData_Udyr/Wilding_Claw) 与 [Wingborne Storm](https://wiki.leagueoflegends.com/en-us/Template%3AData_Udyr/Wingborne_Storm) 页面本次访问受robots限制。公开资料未标注16.17/16.17.1，不能把页面缺值或访问受限推成null。

最小处理是保留五个结果确定的参数、公式、伤害类型、普攻传递和直接来源；对艾希Q可按Not Blocked证据把当前聚合结果改为null，或先拆分原始五段。四个乌迪尔范围字段补逐效果来源或业务确认前，按录入标准撤出未确认效果，参数、公式和源值证据仍可保留；不要用null或其他合法范围填未知。

契约证据：[法术护盾闭环详细设计.md](C:/project/damage_viewer_project_planning/文档记录/详细设计/项目/法术护盾闭环详细设计.md:118)、[角色技能数据录入标准流程.md](C:/project/damage_viewer_project_planning/文档记录/详细设计/项目/角色技能数据录入标准流程.md:235)、[特殊交互与前序结果联动管理详细设计.md](C:/project/damage_viewer_project_planning/文档记录/详细设计/项目/特殊交互与前序结果联动管理详细设计.md:605)。项目盘点规则见 [效果与状态本地Wiki机制盘点.md](C:/project/damage_viewer_project_planning/文档记录/需求澄清/项目/效果与状态本地Wiki机制盘点.md:45)，要求扫描发现后回原始记录逐条核对。

本审计只读取固定输入、候选、计划、来源值、当前代码和公开资料，输出仅在本目录；API调用、数据库访问、浏览器操作、Git写入均为0。
