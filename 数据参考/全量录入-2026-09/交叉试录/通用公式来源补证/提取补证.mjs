import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

// 仅本地资料读取及本目录证据生成，无网络调用、业务写入或服务操作。
const dir = path.dirname(fileURLToPath(import.meta.url));
const planning = 'C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09';
const heroFile = path.resolve(dir, '../Cursor/英雄机制第八批/根绑定与数值证据.json');
const itemFile = path.join(planning, '装备技能实录/第十五批伤害装备/冻结来源.json');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const json = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const save = (name, data) => fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2) + '\n');
const sources = [];
const register = (file, url, note, expected) => {
  const bytes = fs.readFileSync(file), sha256 = hash(bytes);
  if (expected) assert.equal(sha256, expected, file);
  const record = { file, url, sha256, bytes: bytes.length, note };
  sources.push(record); return record;
};
const commit = '3284cf031cfcdfdd49cf371765522ed576b6f3fb';
const rawBase = `https://raw.githubusercontent.com/LeagueToolkit/lol-meta-classes/${commit}/`;
register(path.join(dir,'meta-dump-16.17.8104348.json'), rawBase+'dumps/16.17.8104348.json', '同构建构造默认原始记录，未在本机运行提取器', '063932bad2bc800a44b0cb3929f6de31fbfcacd89d2f1add75b9c67cc7c7e167');
for (const [file, remote] of [
  ['meta-README.md','README.md'],
  ['meta-docs_meta-db-format.md','docs/meta-db-format.md'],
  ['meta-crates_dumper_src_meta_dump.rs','crates/dumper/src/meta_dump.rs'],
  ['meta-crates_dumper_src_meta.rs','crates/dumper/src/meta.rs'],
  ['meta-crates_lol-meta-schema_src_lib.rs','crates/lol-meta-schema/src/lib.rs'],
]) register(path.join(dir,file), rawBase+remote, '固定提取器版本及格式说明');
register(path.join(dir,'cdtb-binfile.py'), 'https://raw.githubusercontent.com/CommunityDragon/CDTB/ba981db2a2c814a0d78e55f6483e0636b527850f/cdtb/binfile.py', '仅序列化已有字段；默认构造证据不来自此文件');
for (const [file, url] of [
  ['meta-api-index.json','https://meta-api.leaguetoolkit.dev/v1'],
  ['meta-api-versions.json','https://meta-api.leaguetoolkit.dev/v1/versions'],
  ['meta-tree.json','https://api.github.com/repos/LeagueToolkit/lol-meta-classes/git/trees/main?recursive=1'],
  ['meta-wiki-tree.json','https://api.github.com/repos/LeagueToolkit/lol-meta-wiki/git/trees/main?recursive=1'],
  ['cdtb-tree.json','https://api.github.com/repos/CommunityDragon/CDTB/git/trees/master?recursive=1'],
  ['data-tree.json','https://api.github.com/repos/CommunityDragon/Data/git/trees/master?recursive=1'],
  ['league-repos.json','https://api.github.com/orgs/LeagueToolkit/repos?per_page=100'],
]) register(path.join(dir,file),url,'本次公开查询快照；以已保存字节及哈希为准，不作为枚举语义证明');
const dump = json(path.join(dir,'meta-dump-16.17.8104348.json'));
const names = ['StatByCoefficientCalculationPart','StatByNamedDataValueCalculationPart','StatBySubPartCalculationPart','IGameCalculationPartWithStats','ByCharLevelBreakpointsCalculationPart','Breakpoint','GameCalculation'];
const classes = {};
const normalize = x => BigInt(x).toString(16);
for (const name of names) {
  const file = path.join(dir,`class-${name}.json`);
  register(file,`https://meta-api.leaguetoolkit.dev/v1/classes/${name}?inherited=1`,'名称及字段哈希对照；继承字段默认必须回原始具体类核对');
  const api = json(file), raw = dump.classes[api.hash]; assert.ok(raw, name);
  const fields = Object.entries(raw.defaults || {}).map(([fieldHash, value]) => {
    const prop = api.properties.find(p => normalize(p.hash) === normalize(fieldHash));
    return { field: prop?.name || fieldHash, hash: fieldHash, type: prop?.ft, value };
  });
  classes[name] = { name, hash: api.hash, raw, fields };
}
save('同构建类型与默认.json', { version: '16.17.8104348', commit, evidence: ['meta_dump.rs:281-299 递归读取具体实例及继承字段','meta_dump.rs:452-484 创建实例后读取属性','meta.rs:1151-1155 实际调用构造函数'], classes });
function walk(x, p, fn) { if (x && typeof x === 'object') { fn(x,p); for(const [k,v] of Object.entries(x)) walk(v,`${p}/${k}`,fn); } }
function nodes(object) {
  const found=[];
  walk(object,'',(node,p) => {
    if (!classes[node.__type] || !['StatByCoefficientCalculationPart','StatByNamedDataValueCalculationPart','StatBySubPartCalculationPart','ByCharLevelBreakpointsCalculationPart','Breakpoint'].includes(node.__type)) return;
    const fields = classes[node.__type].fields.filter(x => ['mStat','mStatFormula','UseNewStats','statType','OutputType','mLevel1Value','mInitialBonusPerLevel','mLevel','mBonusPerLevelAtAndAfter','mAdditionalBonusAtThisLevel'].includes(x.field));
    found.push({ path:p, original:node, fields:fields.map(f=>({field:f.field, present:Object.hasOwn(node,f.field), serializedValue:Object.hasOwn(node,f.field)?node[f.field]:null, constructorDefault:f.value, valueAfterDefaultOverlay:Object.hasOwn(node,f.field)?node[f.field]:f.value})), limit:'叠加字段默认的静态读数；没有执行客户端计算函数，不证明触发资格、伤害归属或整个曲线算法。' });
  }); return found;
}
const heroes=json(heroFile), items=json(itemFile), checks=[], anchors=[];
register(heroFile,null,'已冻结英雄8根绑定摘录，保持不变');
register(itemFile,null,'已冻结装备15根绑定摘录，保持不变');
for(const hero of heroes.heroes.filter(h=>['Caitlyn','Jhin','Draven'].includes(h.id))) {
  const file=path.join(planning,'技能公共参数实录',hero.client.path), gz=fs.readFileSync(file), raw=zlib.gunzipSync(gz);
  assert.equal(hash(gz),hero.client.compressedSha256); assert.equal(hash(raw),hero.client.sha256);
  sources.push({file,url:hero.client.sourceUrl,sha256:hash(raw),compressedSha256:hash(gz),version:hero.client.contentVersion,bytes:raw.length});
  const original=JSON.parse(raw);
  for(const spell of hero.spells) {
    assert.deepEqual(original[spell.object.objectPath],spell.object,`${hero.id}/${spell.slot} source object`);
    if((hero.id==='Caitlyn'&&['P','R'].includes(spell.slot))||(hero.id==='Jhin'&&['W','R'].includes(spell.slot))) checks.push({key:spell.skillKey,source:hero.client,rootPath:hero.rootPath,binding:spell.binding,objectPath:spell.object.objectPath,nodes:nodes(spell.object),originalObject:spell.object});
    if(['Q','R'].includes(spell.slot)) {
      const labels=[];walk(spell.object,'',(o,p)=>{if(o.nameOverride&&/TotalAD|BonusAD|APRatio/.test(o.nameOverride))labels.push({path:p,object:o});});
      if(labels.length) anchors.push({key:spell.skillKey,sourceUrl:hero.client.sourceUrl,rawSha256:hash(raw),objectPath:spell.object.objectPath,labels,calculations:spell.object.mSpell.mSpellCalculations});
    }
    if(hero.id==='Jhin'&&spell.slot==='P') anchors.push({key:spell.skillKey,purpose:'明确初始和分段斜率字段；当前只证明省略字段默认，不补完整曲线',sourceUrl:hero.client.sourceUrl,nodes:nodes(spell.object)});
  }
}
const itemSource=items.sources.find(s=>s.文件?.endsWith('items-16.17.cdtb.bin.json.gz'));
const itemGz=fs.readFileSync(path.join(planning,'装备效果补证',itemSource.文件)), itemRaw=zlib.gunzipSync(itemGz);
assert.equal(hash(itemGz),itemSource.压缩SHA256);assert.equal(hash(itemRaw),itemSource.原始SHA256);
sources.push({...itemSource,verifiedNow:true});const allItems=JSON.parse(itemRaw);
for(const item of items.objects.filter(i=>[2503,3118].includes(i.id))) {
  assert.deepEqual(allItems[item.path],item.object);
  checks.push({key:item.equipmentKey,rootPath:item.path,source:itemSource,nodes:nodes(item.object.mItemCalculations),originalObject:item.object,boundText:item.bound,interpretation:'APRatio 是同版本具名法强系数旁证；单凭名称和构造默认仍不等于已取得当前求值器的属性分派实现。'});
}
// 同版本原始符文只取两个根作为额外具名交叉证据；不生成或改写符文批次。
const perkFile=path.join(planning,'API实录/符文客户端数值补证/perks-16.17.cdtb.bin.json.gz');
if(fs.existsSync(perkFile)) {
  const gz=fs.readFileSync(perkFile),raw=zlib.gunzipSync(gz);
  assert.equal(hash(raw),'1427c70c4d1172198a1a9787362224c871a90cc4f66f3f769ef5830cbcd401b1');
  sources.push({file:perkFile,url:'https://raw.communitydragon.org/16.17/game/perks.cdtb.bin.json',sha256:hash(raw),compressedSha256:hash(gz),version:'16.17',note:'主负责人本轮冻结，作为具名旁证'});
  const perks=JSON.parse(raw);
  for(const rootPath of ['Perks/Styles/Domination/Electrocute','Perks/Styles/Domination/TasteOfBlood']) {
    const object=perks[rootPath]; assert.ok(object,rootPath);
    const calculations=object.mScript?.mSpellScriptData?.mCalculations;
    assert.ok(calculations,rootPath+' calculations');
    assert.ok(nodes(calculations).length,rootPath+' calculation nodes');
    anchors.push({rootPath,calculationPath:'mScript/mSpellScriptData/mCalculations',calculations,nodes:nodes(calculations),purpose:'APRatio 与 BonusADRatio/ADRatio 具名交叉；不扩展到其他枚举'});
  }
}
assert.equal(checks.length,6);
save('六处交叉核对.json',{checks,anchors,checksPassed:6,sourceObjectEqualityPassed:17});
save('来源与哈希.json',{generatedAt:new Date().toISOString(),clientVersion:'16.17.8104348',officialBoundary:'官方资料仍为16.17.1；本次默认结论仅客户端16.17.8104348',sources});
const conclusions={
  confirmed:[
    {key:'legacy-stat-constructor',scope:names.slice(0,3),facts:{mStat:0,mStatFormula:0,UseNewStats:false,statType:13,OutputType:0},limit:'三个具体类的构造默认；不推广全部类，不推广UseNewStats=true，不声称0的完整枚举语义。'},
    {key:'breakpoint-constructor',scope:['ByCharLevelBreakpointsCalculationPart'],facts:{mLevel1Value:0,mInitialBonusPerLevel:0,mBreakpoints:[]},limit:'字段默认，不是完整按等级求值算法。'},
    {key:'breakpoint-entry-constructor',scope:['Breakpoint'],facts:{mLevel:1,mBonusPerLevelAtAndAfter:0,mAdditionalBonusAtThisLevel:0},limit:'缺省字段为0；不能按字段缺省擅自继承前一斜率，但是否由求值器另行累加/保留斜率仍未证。'},
  ],
  boundedInferences:[
    {key:'mStat2-formula0-totalAD',confidence:'同版本具名交叉支持，尚非求值器实现证明',evidence:['Caitlyn Q：StatBySubPart mStat2，mStatFormula省略，tADRatio绑定Spell_ListType_TotalADRatio','Jhin Q：StatByNamed mStat2，mStatFormula省略，ADRatio绑定Spell_ListType_TotalADRatio','同构建三个具体类省略mStatFormula均构造为0'],implication:'Caitlyn P/Jhin W/Jhin R 原树省略字段的数值缺口已补到0；总AD含义可按具名跨对象证据审查，暂不自行改已录公式。'},
    {key:'mStat0-AP',confidence:'同版本具名交叉支持，尚非完整属性分派证明',evidence:['Items/2503 与 Items/3118 的 APRatio 同类节点省略mStat及mStatFormula','符文Electrocute/TasteOfBlood 的 APRatio 同类节点省略mStat/mStatFormula；AD分支显式2/2','同构建三个具体类省略mStat均构造为0'],implication:'支持0为法强这一窄映射；还未取得按mStat0分派到法强的当前客户端函数，不把全部枚举映射视为已证。'},
    {key:'explicit-bonus-not-default',confidence:'同版本具名交叉支持',evidence:['Draven R：RCoefficient，mStat2/mStatFormula2，对应Spell_ListType_BonusADRatio','Caitlyn R同为2/2，明确有值，不能套省略默认0'],implication:'维持Caitlyn R额外AD，不可改成总AD。'},
  ],
  missing:[
    '同构建计算函数如何将mStat0/2及mStatFormula0/2分派至当前/基础/额外属性的实现，尤其UseNewStats或OutputType非默认分支。',
    '同构建ByCharLevelBreakpoints求值循环及断点级计入时点：构造默认只能补字段，不能单独生成完整曲线。',
    '抽取器代码说明了默认取得方式，但本轮没有自行加载客户端二进制运行构造器或检验游戏实战。',
  ],
  discriminatingExamples:[
    {inputs:{totalAD:200,bonusAD:100,AP:300},meaning:'Jhin W AD系数0.5：总AD项100，额外AD项50；用于后续验证，非本次客户端执行结果。'},
    {inputs:{totalAD:200,bonusAD:100,AP:300},meaning:'Caitlyn R 一级基础300、额外AD系数1：裸值400；误用总AD为500。暴击乘数另行保留。'},
    {inputs:{totalAD:200,bonusAD:100,AP:300},meaning:'2503 APRatio 0.02：法强项约6；若误用总AD则约4。3118 基础60+APRatio0.05：每秒约75；误用总AD为70。使用原始浮点值会有微小尾差。'},
  ],
  noWrites:true,
};
save('结论与边界.json',conclusions);
const fnv = s => { let h=2166136261; for(const ch of s.toLowerCase()) h=Math.imul(h^ch.charCodeAt(0),16777619)>>>0; return '0x'+h.toString(16); };
assert.equal(fnv('StatByCoefficientCalculationPart'),'0x5815b0a9');
const knownFields = ['mStartValue','mEndValue','mValues','mValuesPerLevel','mScaleByStatCoefficient'];
const extraClasses = ['ByCharLevelInterpolationCalculationPart','ByCharLevelFormulaCalculationPart'].map(name=>{
  const classHash=fnv(name),raw=dump.classes[classHash]; assert.ok(raw,name);
  return {name,hash:classHash,raw,fields:Object.entries(raw.defaults).map(([hash,value])=>({hash,name:knownFields.find(n=>fnv(n)===hash)||null,value})),limit:'仅本次已下载原始类型记录。未解码字段保留哈希；起止等级、特殊插值、取整、表索引均未证。'};
});
save('插值及等级公式默认补充.json',{version:'16.17.8104348',nameHashMethod:'大小写折叠后FNV1a，与已有具体类哈希交叉一致；字段未命名不猜',classes:extraClasses});
console.log(JSON.stringify({checks:checks.length,anchors:anchors.length,sourceCount:sources.length,confirmedGroups:conclusions.confirmed.length,rawDumpSha256:hash(fs.readFileSync(path.join(dir,'meta-dump-16.17.8104348.json')))}));
