import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
if(process.argv.length!==2)throw new Error('只生成依赖依据');
const here=path.dirname(fileURLToPath(import.meta.url));
const read=name=>JSON.parse(fs.readFileSync(path.join(here,name),'utf8'));
const source=read('冻结来源.json'),inventory=read('逐项机器清单.json'),current=read('范围外挂载只读.json');
const byId=new Map(source.items.map(x=>[x.id,x]));
function evidence(id,quote){const row=byId.get(id),field=Object.entries(row.text).find(([,value])=>value.includes(quote));assert(field,`${id}:${quote}`);return{runeKey:row.runeKey,field:field[0],exactText:quote};}
const notes=new Map([
 [8137,{related:[],keep:'只排除守卫感知和显形，不删除通用英雄目标可见性数据。',boundary:'在两份冻结符文文本中未见其他符文以第六感发现次数作为战斗系数；没有读取玩法程序，不能据此断言所有英雄技能无间接视野依赖。'}],
 [8141,{related:[],keep:'只排除守卫生命/时长，不把守卫生命值写入角色hp，也不删除其他来源的英雄生命属性。',boundary:'未见62符文原文直接引用深入守卫的层数或持续时间；涉及守卫目标的其他角色技能需按各自范围核对，当前不虚构引用。'}],
 [8135,{related:[{runeKey:'rune_8105',kind:'相同进度概念，状态共享未证实',evidence:[evidence(8135,'你首次参与击杀每位独特的敌方英雄时'),evidence(8105,'8x赏金猎人层数')]},{runeKey:'rune_8106',kind:'相同进度概念，状态共享未证实',evidence:[evidence(8135,'赏金猎人效果'),evidence(8106,'6+5x赏金猎人层数')]}],keep:'金币奖励排除，独特英雄参与击杀的业务事实仍可能供无情猎手、终极猎人使用；不因寻宝被排除就删除层数生产。',boundary:'共同中文名称不能证明三个符文共享同一个内部状态实例；各来源计数关系另核。'}],
 [8306,{related:[{runeKey:'rune_8143',kind:'触发类别可能重合，具体归属未证实',evidence:[evidence(8306,'引导2秒后闪烁到一个新位置'),evidence(8143,'闪烁')]},{runeKey:'rune_8275',kind:'召唤师技能分类需核，未确认为满足触发',evidence:[evidence(8306,'当【闪现】尚未冷却完毕时，它会被替换为海克斯闪现'),evidence(8275,'在你施放一个召唤师技能后')]}],keep:'不实现空间移动，但须保留合法闪烁/位移事件的来源类别核对入口，以免漏掉猛然冲击等后续战斗收益。',boundary:'两条文字只证明可能相遇的事件概念，不足以确认海克斯闪现必然属于灵光披风的召唤师技能施放。'}],
 [8321,{related:[{runeKey:'rune_8316',kind:'最终装备输入依赖，非直接触发引用',evidence:[evidence(8321,'购买传说级装备'),evidence(8316,'每从装备中获得一种不同属性')]}],keep:'不计算返现，仍使用实际最终装备与属性输入，不能因为金币分支排除而删除已获得装备。',boundary:'没有证据表明返现直接提供多面手层数；层数来自最终装备属性，经济过程由本阶段排除。'}],
 [8465,{related:[{runeKey:'rune_8401',kind:'护盾事件资格仍需保留，当前单挑前提不成立',evidence:[evidence(8465,'你们两个都会获得一层'),evidence(8401,'在你获得一个新的护盾时')]}],keep:'本场景没有被守护友军，守护者不能发出自身护盾；其他合法自身护盾及护盾猛击的新护盾事件仍需保留。',boundary:'不把队友前置条件删除后建立守护者自身护盾，也不把护盾猛击一并排除。'}],
 [8446,{related:[{runeKey:'rune_8021',kind:'通用攻击进度需独立核对，不确认塔攻击权重',evidence:[evidence(8446,'你对防御塔的第三次攻击'),evidence(8021,'攻击和移动会积攒能量层数')]}],keep:'对塔附加伤害排除；通用攻击事件的目标类别以及其他符文已确认战前充能输入保留。',boundary:'冻结文字没有给出对塔攻击的具体充能权重，不能自行把爆破三击当作迅捷步法100层。'}]
]);
const entries=inventory.entries.filter(x=>x.scope==='范围外').map(row=>{const record=current.records.filter(x=>x.runeKey===row.runeKey&&x.status===200).at(-1);assert(record);return{runeKey:row.runeKey,name:row.name,excludedEffectReason:row.branches.map(x=>({summary:x.summary,reason:x.reason,evidence:x.evidence})),explicitNameReferencesInOtherFrozenRunes:source.items.filter(x=>x.id!==row.id&&Object.values(x.text).some(t=>t.includes(row.name))).map(x=>x.runeKey),currentMountedSkills:record.data,dependencyReview:notes.get(row.id)};});
assert.equal(entries.length,7);assert(entries.every(x=>x.dependencyReview));
fs.writeFileSync(path.join(here,'范围外跨技能依赖.json'),JSON.stringify({checkedAt:new Date().toISOString(),scope:'仅核对7项自身效果排除和必须保留的通用事实/潜在间接依赖；没有删除身份或已有技能',sourceScope:'两份冻结符文原对象及当前符文技能挂载GET，未遍历客户端玩法程序',entries},null,2)+'\n');
console.log(JSON.stringify({excludedIdentities:7,currentBindings:entries.reduce((n,x)=>n+x.currentMountedSkills.total,0),dependencyReviews:entries.length}));
