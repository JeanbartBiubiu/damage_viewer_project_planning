import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const source='装备符文/装备全量处置清单.json';
const bytes=fs.readFileSync(path.join(root,source));
const items=JSON.parse(bytes).items;
const links={
  '26.1':'https://www.leagueoflegends.com/en-sg/news/game-updates/patch-26-1-notes/',
  '14.1':'https://www.leagueoflegends.com/en-us/news/game-updates/patch-14-1-notes/',
  '14.10':'https://www.leagueoflegends.com/en-au/news/game-updates/patch-14-10-notes/',
  '26.9':'https://www.leagueoflegends.com/en-au/news/game-updates/league-of-legends-patch-26-9-notes/',
  '2024':'https://www.leagueoflegends.com/en-au/news/game-updates/2024-gameplay-preview/',
};
const removed={3002:'26.9',3010:'26.1',3011:'14.1',3117:'14.10',4635:'14.1',4636:'2024',4637:'14.1',6693:'14.1',6701:'26.9',8001:'14.10'};
const included={
  2010:'消耗自疗和永久最大生命影响1V1；消费或出售后的生命收益均保留，出售金币排除。治疗倍率客户端0.015与符文说明0.02冲突，缺失生命增幅函数未定，不能编造完整治疗公式。',
  2150:'额外技能点会改变技能等级与伤害；保留明确分配约束，不提升英雄等级，不绕过技能最高等级。',
  2152:'25适应之力持续60000毫秒影响1V1；后续配置属性选择及换算，不同时添加攻击力和法术强度。',
  2422:'直接移动速度25，另有10额外移动速度且升级后保留；生成时间可作为预设来源，经济部分跳过。',
};
const selected=items.filter(x=>['非普通商店条目','符文生成物'].includes(x.scopeCategory));assert.equal(selected.length,17);
const rows=[];
for(const item of selected){
  const id=String(item.itemId),index=items.indexOf(item);
  const row={itemId:id,equipmentKey:item.proposedKey,name:item.name,originalCategory:item.scopeCategory,sourcePointer:`/items/${index}`};
  if(included[id])Object.assign(row,{disposition:'本轮保留',reason:included[id]});
  else if(removed[id])Object.assign(row,{disposition:'历史移除条目跳过',reason:`官方${removed[id]}说明明确移除；冻结客户端仍有根对象不能单独证明当前普通地图取得途径。`,officialPatch:links[removed[id]]});
  else if(id==='2151')Object.assign(row,{disposition:'1V1范围外跳过',reason:'贪财合剂只提供对小兵额外伤害及金币，均属于本轮明确排除部分。'});
  else if(id==='2403')Object.assign(row,{disposition:'1V1范围外跳过',reason:'小兵去质器只处理小兵；官方14.10同时说明符文移除。',officialPatch:links['14.10']});
  else {assert.equal(id,'3013');Object.assign(row,{disposition:'取得途径待核',reason:'固定资料只定位到3010共生鞋底的旧变换链；26.1移除上游，尚无当前普通地图替代取得途径的肯定证据。不能从根对象存在或maps.11=true直接判定在范围内，也不据此断言绝对不可获得。',officialPatch:links['26.1']});}
  const response=await fetch(`http://127.0.0.1:8080/api/admin/games/lol/equipment/${row.equipmentKey}`,{headers:{Authorization:'Bearer local-entry'},signal:AbortSignal.timeout(20000)});
  const body=await response.json();assert.ok([200,404].includes(response.status));
  row.currentSubject={status:response.status,...(response.status===200?{equipmentKey:body.equipmentKey,name:body.name}:{code:body.code})};
  if(included[id])assert.equal(response.status,200);
  else assert.equal(response.status,404);
  rows.push(row);
}
const report={checkedAt:new Date().toISOString(),version:{client:'16.17',official:'16.17.1'},source:{relativePath:source,sha256:crypto.createHash('sha256').update(bytes).digest('hex')},
  evidenceBoundary:'独立代理与主负责人核对冻结根对象、当前绑定说明、官方移除公告和实际主体GET；未执行战斗或全面枚举客户端以外生成路径。公告用于移除史，不替换冻结版本数值。',
  rows,counts:{reviewed:17,included:4,excluded:12,acquisitionPending:1},
  previouslySavedSpecialForm:{equipmentKey:'item_3176',name:'永远前进',disposition:'旧链保留，当前标准范围未确认',reason:'冻结资料来源3013，其上游3010已移除；现有13件特殊形态主体计数仍是真实落库数量，不代表13件当前可取得。保留现有主体、55直接移速和图片，不自动删除，不将取得途径待核计为完成。'},passed:true};
fs.writeFileSync(path.join(dir,'非普通条目范围核对.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.counts));
