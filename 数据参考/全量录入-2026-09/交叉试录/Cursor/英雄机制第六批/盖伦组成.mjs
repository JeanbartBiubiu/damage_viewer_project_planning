import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {begin,clean,pending,exclude,plan} from './英雄工具.mjs';
const before=JSON.parse(await readFile(new URL('./写前现值.json',import.meta.url),'utf8'));
const oldBase='C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09/';
const historical=[];for(const name of ['盖伦技能候选/盖伦技能录入候选.json','盖伦技能实录.json','盖伦效果回读-2026-09-07.md']){const raw=await readFile(oldBase+name);historical.push({path:oldBase+name,sha256:createHash('sha256').update(raw).digest('hex')});}
const mapping={
 garen_p:{damage_pause_ms:['DamageTimer',1000]},
 garen_q:{base_damage:['BaseDamage'],bonus_ad_ratio:['tADRatio',1,-1],move_speed_ratio:['MovementSpeedAmount'],move_duration_ms:['MovementSpeedDuration',1000],silence_duration_ms:['SilenceDuration',1000],attack_window_ms:['AttackWindow',1000]},
 garen_w:{resist_per_kill:['ResistGainOnKill'],resist_max:['ResistMax'],reduction_ratio:['DRPercent'],reduction_duration_ms:['DRDuration',1000],tenacity_ratio:['UpfrontTenacity'],upfront_duration_ms:['UpfrontDuration',1000],base_shield:['BaseShield'],bonus_hp_ratio:['ShieldHealthRatio']},
 garen_e:{base_damage_per_spin:['BaseDamagePerTick'],ad_ratio_per_spin:['ADRatioPerTick'],base_spins:['NumTicks'],as_per_spin:['ASPerTick'],duration_ms:['Duration',1000],shred_hits:['StacksToShred'],shred_ratio:['ShredAmount'],shred_duration_ms:['ShredDuration',1000],nearest_bonus:['NearestEnemyBonus'],crit_bonus_ratio:['CritMod']},
 garen_r:{base_damage:['BaseDamage'],missing_hp_ratio:['ExecuteDamage'],reveal_duration_ms:['RevealDuration',1000]}
};
for(const key of Object.keys(mapping)){
 const x=begin(key),old=before.skills[key].components;
 x.c.write=Object.fromEntries(Object.entries(old).map(([k,items])=>[({'internal-states':'internalStates','trigger-rules':'triggerRules'}[k]??k),items.map(v=>Object.fromEntries(Object.entries(v).filter(([k])=>!['gameId','skillKey','createdAt','updatedAt'].includes(k))))]));
 x.c.existingComponents=Object.fromEntries(Object.entries(x.c.write).map(([k,a])=>[k,a.length]));
 x.c.proofs.push({source:'既有实录证据与实时GET',historical,note:'保留原字段、说明和排序；不复制旧候选中尚未落库的占位组成。'});
 const values=p=>p.valueMode==='FIXED'?Array(x.c.maxLevel).fill(p.fixedValue):Object.values(p.levelValues);
 for(const[pkey,[name,scale=1,offset=0]]of Object.entries(mapping[key])){const raw=x.p.DataValues.find(v=>v.name===name)?.values;assert(raw,'当前命名值缺失 '+key+'/'+name);const expected=raw.slice(1,x.c.maxLevel+1).map(v=>clean(clean(v)*scale+offset)),p=x.c.write.parameters.find(v=>v.parameterKey===pkey);assert.deepEqual(values(p),expected);x.c.proofs.push({parameterKey:pkey,source:'当前根DataValues.'+name,raw,indexStart:1,scale,offset,expected,match:true});}
 if(key!=='garen_p'){const p=x.c.write.parameters.find(v=>v.parameterKey==='cooldown_ms'),expected=x.p.Cooldown.values.slice(1,x.c.maxLevel+1).map(v=>Math.round(v*1000));assert.deepEqual(values(p),expected);assert.deepEqual(expected,x.s.official.cooldown.map(v=>v*1000));x.c.proofs.push({parameterKey:'cooldown_ms',source:'当前Cooldown与官方cooldown',expected,match:true});}
 if(key==='garen_p'){
  const p=x.p.mSpellCalculations.RegenCalc,part=p.mFormulaParts[0];let current=clean(part.mLevel1Value),slope=clean(part.mInitialBonusPerLevel);const expected=[];for(let level=1;level<=18;level++){const b=part.mBreakpoints?.find(b=>b.mLevel===level);if(b?.mBonusPerLevelAtAndAfter!=null)slope=clean(b.mBonusPerLevelAtAndAfter);if(level>1)current=clean(current+slope);expected.push(clean(current*clean(p.mMultiplier.mNumber)));}assert.deepEqual(values(x.c.write.parameters.find(v=>v.parameterKey==='regen_ratio_per_5s')),expected);x.c.proofs.push({parameterKey:'regen_ratio_per_5s',source:'当前RegenCalc完整分段曲线；当前绑定Tooltip明确每5秒，优先于Summary每秒泛述',raw:p,expected,match:true});
  pending(x,'被动启停与8秒无伤害/未被敌方技能命中','现有动态生命回复效果已保存但无触发规则；需实际受伤或敌方技能影响判定、暂停、重置与恢复。每5秒是属性单位，不是直接治疗跳频。');exclude(x,'小兵与非史诗野怪伤害例外','本轮1V1不用专门分支；当前绑定扩展文本已保留。');
 }
 if(key==='garen_q'){pending(x,'清除减速、普攻重置、单次消费与沉默','既有移速和额外伤害独立保留；4.5秒内合法普攻消费、沉默与减速清除仍需组合，不能用普通施法完成冒充命中。');pending(x,'既有强化普攻伤害分类及法术护盾交互','旧实录保留SKILL/DIRECT且spellShieldBlockScope为空；新来源确证伤害总量，攻击附伤及沉默的阻挡颗粒与事件交付需单独复核，本轮不覆盖旧效果或直接新增触发。','来源');}
 if(key==='garen_w'){
  assert.equal(x.c.write.parameters.find(v=>v.parameterKey==='max_stacks').fixedValue,150);x.c.proofs.push({parameterKey:'max_stacks',source:'ResistMax / ResistGainOnKill',expected:150,match:true});
  pending(x,'永久双抗层数、主动减伤与防御过程','已保存0.2每击杀、30上限，以及独立护盾和韧性；击杀层数可由对局开始前已获得，因此保留该自身战斗依赖。永久层数来源/死亡保留、独立减伤乘区及主动启动仍未接入。');pending(x,'减伤与韧性来源组合','真实伤害是否排除及不同来源减伤/韧性按剩余比例合并需要独立目录，不使用属性加算区冒充伤害区。','系统');
 }
 if(key==='garen_e'){
  assert.equal(x.c.write.parameters.find(v=>v.parameterKey==='one').fixedValue,1);assert.equal(x.s.official.range[0],325);assert.equal(x.c.write.parameters.find(v=>v.parameterKey==='radius').fixedValue,325);
  x.c.proofs.push({source:'当前CriticalDamage完整修改树与角色根critDamageMultiplier',raw:x.p.mSpellCalculations.CriticalDamage,baseCriticalMultiplier:2,note:'原公式1 + .3 * (1 + 额外暴伤百分点)保持；当前公式无角色等级附加伤害。'});
  pending(x,'装备和等级攻速的圈数、实际每圈交付及冷却起点','当前文本明确仅装备及等级攻速每25%加一圈，旧NumberOfStrikes仅返回基础7；不读取所有临时额外攻速，也不猜取整、单跳时点或首次命中时刻。沿历史补丁证据保留旋转结束开始冷却，未建立空过程。');pending(x,'同目标六圈后的减抗与互斥伤害','既有普通与最近敌人伤害效果二选一；25%减甲的独立乘区、来源合并、六圈累计和刷新仍未配置。');exclude(x,'最近对象空间选择与范围半径执行','保存旧独立伤害及原半径参数，不删除历史记录；空间选择本轮不新增。');
 }
 if(key==='garen_r'){assert.equal(Math.round(x.p.spellCastTime*1000),435);assert.equal(x.s.official.range[0],400);pending(x,'实际英雄命中规则与施法失败边界','旧真实伤害效果继续保留；仅伤害没有施法行为过程，不能建立空延迟过程。本轮不改变既有技能命中颗粒或猜测失败返还。');exclude(x,'视野与施法距离执行','保留历史1000毫秒视野和400距离参数，依范围缩小不自动删除既有内容。');}
}
export {plan};
