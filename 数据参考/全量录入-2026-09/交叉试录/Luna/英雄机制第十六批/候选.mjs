import {readFile} from 'node:fs/promises';

export {
  evidence,clean,levels,val,fval,fixed,pn,attr,op,add,mul,valueRule,behavior,life,
  begin,parameter,data,aliasData,literal,runtime,unknownCurve,formula,result,effect,
  manaEffect,resourceEffect,pending,exclude,excludeData,requireCalc,markCalc,common,finish,
  sourceProof
};

const evidence=JSON.parse(await readFile(new URL('./根绑定与数值证据.json',import.meta.url),'utf8'));
const textEvidence=JSON.parse(await readFile(new URL('./补充文本证据.json',import.meta.url),'utf8'));
const clean=n=>Math.round(n*1e6)/1e6;
const levels=a=>Object.fromEntries(a.map((v,i)=>[String(i+1),v]));
const val=parameterKey=>({kind:'PARAMETER',parameterKey});
const fval=formulaKey=>({kind:'FORMULA',formulaKey});
const fixed=value=>({kind:'FIXED',value});
const pn=parameterKey=>({nodeType:'PARAMETER',parameterKey});
const attr=(key,owner='SOURCE',kind='TOTAL')=>({nodeType:'ATTRIBUTE',attributeOwner:owner,attributeKey:key,attributeValueKind:kind});
const op=(operation,a,b)=>({nodeType:'OPERATION',operation,operands:[a,b]});
const add=(...xs)=>xs.reduce((a,b)=>op('ADD',a,b));
const mul=(a,b)=>op('MULTIPLY',a,b);
const valueRule=value=>({value,fixedMultiplier:1,fixedMinValue:0,fixedMaxValue:null});
const behavior={moment:'PERSISTENT',valueReadMode:'APPLICATION_SNAPSHOT',stackValueMode:'SHARED',reapplicationValueMode:'REPLACE',periodicExecutionMode:null};
const life=duration=>({
  durationValue:duration,maxStacksValue:fixed(1),applicationStacksValue:fixed(1),instanceScope:'SOURCE',
  reapplicationStackMode:'KEEP',reapplicationDurationMode:duration?'REFRESH_ALL':null,
  expiryMode:duration?'ALL_AT_ONCE':'EXPLICIT_ONLY',periodicIntervalValue:null,firstPeriodicExecution:null
});
const expressionNodeTypes=new Set(['PARAMETER','ATTRIBUTE','OPERATION']);
function assertExpression(node,path){
  if(!node||typeof node!=='object'||!expressionNodeTypes.has(node.nodeType))throw Error('公式表达式含不支持节点 '+path);
  if(node.nodeType==='PARAMETER'&&!node.parameterKey)throw Error('公式参数键缺失 '+path);
  if(node.nodeType==='ATTRIBUTE'&&(!node.attributeOwner||!node.attributeKey||!node.attributeValueKind))throw Error('公式属性字段缺失 '+path);
  if(node.nodeType==='OPERATION'){
    if(!Array.isArray(node.operands)||node.operands.length!==2)throw Error('公式表达式运算元不是二元 '+path);
    node.operands.forEach((child,i)=>assertExpression(child,path+'.operands['+i+']'));
  }
}

export const plan={meta:{
  executor:'第十六批由Codex执行代理准备；仅来源与当前GET候选，未业务写入',gameId:'lol',
  note:'客户端16.17与官方16.17.1来源已冻结；本批仅生成候选，不写业务接口。当前20槽六类组成先做GET，结果与失败事实分开记录。',
  sources:evidence.heroes.map(h=>({id:h.id,client:h.client,official:h.official})),
  scope:'玛尔扎哈、艾尼维亚、丽桑卓、卡尔萨斯20槽；保护既有公共参数，仅准备有独立来源的确定数值与数学关系。独立虚灵、冰封奴仆、冰墙和死亡灵体等分支按范围排除，混合技能自身数值、唯一目标分支、非英雄前置进度与法力依赖保留。'
},skills:{}};

function findSpell(key){
  for(const hero of evidence.heroes){const spell=hero.spells.find(s=>s.skillKey===key);if(spell)return {hero,spell};}
  return null;
}
function begin(key){
  const found=findSpell(key);if(!found)throw Error('来源证据缺技能 '+key);
  const {hero,spell}=found;
  const c={
    skillKey:key,name:spell.official.name,maxLevel:spell.maxrank??1,
    source:{hero:hero.id,rootPath:hero.rootPath,spellPath:spell.binding,clientSha256:hero.client.sha256,officialSha256:hero.official.sha256,currentBoundText:textEvidence.skills?.[key]??null},
    write:{parameters:[],formulas:[],effects:[],processes:[],internalStates:[],triggerRules:[]},
    proofs:[],pending:[],excluded:[]
  };
  plan.skills[key]=c;
  return {c,s:spell.official,p:spell.object.mSpell};
}

function parameter(x,key,name,values,description,mode){
  const a=(Array.isArray(values)?values:[values]).map(clean);
  if(!a.length||!a.every(Number.isFinite))throw Error('缺值 '+x.c.skillKey+'/'+key);
  const variable=mode==='SKILL_LEVEL'||(mode==null&&new Set(a).size>1);
  const body={
    parameterKey:key,name,valueType:a.every(Number.isInteger)?'INTEGER':'DECIMAL',
    valueMode:mode??(variable?'SKILL_LEVEL':'FIXED'),fixedValue:variable?null:a[0],
    levelValues:variable?levels(a):null,description,sortOrder:(x.c.write.parameters.length+1)*10
  };
  x.c.write.parameters.push(body);return key;
}
function rawData(x,source){return (x.p.DataValues??x.p.mDataValues??[]).find(d=>(d.name??d.mName)===source);}
function data(x,source,key,name,{scale=1,unit='',offset=1,description=null}={}){
  const d=rawData(x,source),raw=d?.values??d?.mValues;
  if(!Array.isArray(raw)||raw.length<x.c.maxLevel+offset)throw Error('数据字段缺失 '+x.c.skillKey+'/'+source);
  const arr=raw.slice(offset,offset+x.c.maxLevel).map(v=>clean(Number(v)*scale));
  x.c.proofs.push({parameterKey:key,source:'DataValues.'+source,raw,offset,values:arr,scale});
  return parameter(x,key,name,arr,description??`客户端当前根绑定 DataValues.${source} 取索引${offset}至${offset+x.c.maxLevel-1}${unit?'；单位'+unit:''}${scale!==1?'；按来源显示单位换算为系统比例/毫秒':''}。`);
}
function aliasData(x,source,semantic){
  const d=rawData(x,source);if(!d)throw Error('数据字段缺失 '+x.c.skillKey+'/'+source);
  x.c.proofs.push({source:'DataValues.'+source,raw:d.values??d.mValues??null,alias:true,semantic});
}
function literal(x,key,name,value,description,path){
  const values=Array.isArray(value)?value:[value];
  if(!values.length||!values.every(Number.isFinite))throw Error('字面值无效 '+x.c.skillKey+'/'+key);
  x.c.proofs.push({parameterKey:key,source:path??'官方说明或明确派生',values});
  return parameter(x,key,name,values,description);
}
function runtime(x,key,name,description,type='DECIMAL'){
  x.c.write.parameters.push({parameterKey:key,name,valueType:type,valueMode:'RUNTIME_INPUT',fixedValue:null,levelValues:null,description,sortOrder:(x.c.write.parameters.length+1)*10});
}
function unknownCurve(x,key,name,raw,source,description,type='DECIMAL'){
  runtime(x,key,name+'（实际值外供）',description,type);
  x.c.proofs.push({parameterKey:key,source,raw,values:null,sourcePending:true,semantic:description});
  pending(x,'等级节点求值：'+key,description,'来源');
  return pn(key);
}
function formula(x,key,name,expression,description){
  assertExpression(expression,x.c.skillKey+'/'+key);
  x.c.write.formulas.push({formulaKey:key,name,expression,description,sortOrder:(x.c.write.formulas.length+1)*10});
}
function result(key,name,type,target,value,detail,lifecycleBehavior=null,block=null,description=null){
  return {resultKey:key,name,resultType:type,target,description,sortOrder:10,lifecycleBehavior,spellShieldBlockScope:block,valueRule:value?valueRule(value):null,detail};
}
function effect(x,key,name,results,lifecycle=null,description=null){
  x.c.write.effects.push({effectKey:key,name,description,sortOrder:(x.c.write.effects.length+1)*10,lifecycle,results});
}
function manaEffect(x){
  if(!x.c.write.parameters.some(p=>p.parameterKey==='mana_cost'))return;
  if(x.c.write.effects.some(e=>e.effectKey==='mana_cost'))return;
  effect(x,'mana_cost','施放法力消耗',[result('consume_mana','消耗法力','RESOURCE_CHANGE','SOURCE',val('mana_cost'),{attributeKey:'mana',operation:'CONSUME'})],null,'仅保留官方基础法力消耗；实际扣除时点与施放资格尚未接线。');
}
function resourceEffect(x,key,name,parameterKey,operation,description){
  effect(x,key,name,[result('resource',name,'RESOURCE_CHANGE','SOURCE',val(parameterKey),{attributeKey:'mana',operation})],null,description);
}
function pending(x,component,reason,kind='配置'){x.c.pending.push({kind,component,reason});}
function exclude(x,component,reason){x.c.excluded.push({component,reason});}
function excludeData(x,source,semantic){
  const d=rawData(x,source);x.c.proofs.push({source:'DataValues.'+source,raw:d?.values??d?.mValues??null,excluded:true,semantic});
}
function requireCalc(x,key){const c=x.p.mSpellCalculations?.[key];if(!c)throw Error('缺计算树 '+x.c.skillKey+'/'+key);return c;}
function sourceProof(x,source,raw,semantic,extra={}){x.c.proofs.push({source,raw,semantic,...extra});}
function markCalc(x,key,semantic){sourceProof(x,'mSpellCalculations.'+key,requireCalc(x,key),semantic);}

function common(x,{cooldown=true,mana=true,cast=true}={}){
  const official=x.s,n=x.c.maxLevel,p=x.p;
  if(cooldown){
    const values=official.cooldown;
    if(!Array.isArray(values)||values.length!==n)throw Error('官方冷却数组缺失 '+x.c.skillKey);
    if(values.every(v=>Number(v)===0)){
      sourceProof(x,'official.cooldown',values,'官方基础冷却明确为0；不创建0毫秒冷却参数。',{excluded:true});
    }else{
      const root=Array.isArray(p.cooldownTime)?p.cooldownTime.slice(1,n+1):null;
      const same=root&&root.length===n&&root.every((v,i)=>Math.abs(Number(v)-Number(values[i]))<1e-4);
      literal(x,'cooldown_ms','基础冷却时间（毫秒）',values.map(v=>Math.round(Number(v)*1000)),
        same?'官方逐级冷却与当前根Cooldown字段逐级一致；不含急速或其他技能修正。':'官方逐级冷却作为当前候选来源；当前根Cooldown字段存在偏移或缺失，保留差异，不把另一组字段当作同值。',
        same?'official.cooldown + Cooldown.values':'official.cooldown；根Cooldown字段差异');
      if(!same)pending(x,'官方冷却与当前根字段差异','官方逐级冷却与当前根冷却字段未逐级一致；本批保留官方值，根值原样留证，实际起算与再施放间隔待核。','来源');
    }
  }
  if(mana){
    const values=official.cost;
    if(!Array.isArray(values)||values.length!==n)throw Error('官方法力数组缺失 '+x.c.skillKey);
    if(values.every(v=>Number(v)===0))sourceProof(x,'official.cost',values,'官方基础法力消耗明确为0；不创建0资源参数或效果。',{excluded:true});
    else{
      const root=Array.isArray(p.manaValues?.values)?p.manaValues.values.slice(0,n):null;
      const same=root&&root.length===n&&root.every((v,i)=>Math.abs(Number(v)-Number(values[i]))<1e-4);
      literal(x,'mana_cost','基础法力消耗',values,
        same?'官方cost与当前根manaValues逐级一致；法力值；未接入实际扣除时点。':'官方cost保留基础法力消耗；当前根manaValues逐级不一致或缺失，保留差异，不将缺失当作零。',
        same?'official.cost + manaValues.values':'official.cost；根manaValues字段差异');
      if(!same)pending(x,'官方法力与当前根字段差异','官方法力消耗与当前根manaValues未逐级一致；本批保留官方值并留存根字段差异。','来源');
      manaEffect(x);
    }
  }
  if(cast){
    const st=Number.isFinite(p.spellCastTime),mc=Number.isFinite(p.mCastTime);
    if(st&&mc&&Math.abs(p.spellCastTime-p.mCastTime)>1e-4)pending(x,'spellCastTime与mCastTime冲突','两个根施法时长字段不一致；不擅自选择其中一个作为完整命中时点。','来源');
    else if(st)literal(x,'cast_time_ms','施法时间（毫秒）',Math.round(p.spellCastTime*1000),'当前根spellCastTime；仅保存根字段，不表示命中发生在施法结束。','spellCastTime');
    else pending(x,'施法时间缺失','当前根没有可用spellCastTime；不补写0毫秒。','来源');
  }
}

function finish(x){
  const dataValues=x.p.DataValues??x.p.mDataValues??[];
  for(const d of dataValues){
    const source='DataValues.'+(d.name??d.mName);
    if(!x.c.proofs.some(p=>p.source===source))sourceProof(x,source,d.values??d.mValues??null,'原始数据字段保留；当前候选没有独立数值消费，不按字段名猜测含义。',{sourcePending:true});
  }
  for(const key of Object.keys(x.p.mSpellCalculations??{})){
    const source='mSpellCalculations.'+key;
    if(!x.c.proofs.some(p=>p.source===source))sourceProof(x,source,requireCalc(x,key),'当前原始计算树完整留源；适用关系未在候选中独立消费，不重复或猜分支。',{sourcePending:true});
  }
  x.c.disposition={
    范围外:x.c.excluded,
    来源待核:x.c.pending.filter(v=>v.kind==='来源'),
    系统缺口:x.c.pending.filter(v=>v.kind==='系统'),
    尚未接线:x.c.pending.filter(v=>!['来源','系统'].includes(v.kind))
  };
  x.c.status='确定组成候选；未保存、未接线和范围外分支不表示完整战斗机制';
}
