import {readFile} from 'node:fs/promises';

export {evidence,clean,levels,val,fval,fixed,pn,attr,op,add,mul,valueRule,behavior,life,begin,parameter,data,literal,runtime,formula,result,effect,damagePending,healPending,manaEffect,common,processStart,channel,hit,pending,exclude,excludeData,statEffect,requireCalc,interpolation,breakpoints};

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
const life=duration=>({durationValue:duration,maxStacksValue:fixed(1),applicationStacksValue:fixed(1),instanceScope:'SOURCE',reapplicationStackMode:'KEEP',reapplicationDurationMode:duration?'REFRESH_ALL':null,expiryMode:duration?'ALL_AT_ONCE':'EXPLICIT_ONLY',periodicIntervalValue:null,firstPeriodicExecution:null});
const expressionNodeTypes=new Set(['PARAMETER','ATTRIBUTE','OPERATION']);
function assertExpression(node,path){
  if(!node||typeof node!=='object'||!expressionNodeTypes.has(node.nodeType))throw Error('公式表达式含不支持节点 '+path+'；只允许PARAMETER/ATTRIBUTE/OPERATION');
  if(node.nodeType==='PARAMETER'&&!node.parameterKey)throw Error('公式表达式参数键缺失 '+path);
  if(node.nodeType==='ATTRIBUTE'&&(!node.attributeOwner||!node.attributeKey||!node.attributeValueKind))throw Error('公式表达式属性字段缺失 '+path);
  if(node.nodeType==='OPERATION'){
    if(!Array.isArray(node.operands)||node.operands.length!==2)throw Error('公式表达式运算元不是二元 '+path);
    node.operands.forEach((child,i)=>assertExpression(child,path+'.operands['+i+']'));
  }
}

export const plan={meta:{executor:'第九批本地候选；来源、现值与独立核算分开记录',gameId:'lol',note:'客户端16.17与官方16.17.1来源已冻结；本批仅生成候选，不写业务API。当前20技能六类组成先做GET，结果与失败事实分开记录。',sources:evidence.heroes.map(h=>({id:h.id,client:h.client,official:h.official})),scope:'易、特朗德尔、潘森、泰隆20技能；保留一名敌方英雄的伤害、治疗、资源、抗性、控制、冷却和强化攻击依赖。纯金币经验、纯空间视野、第三者友军与多目标特供分支后置并逐项记录。'},skills:{}};

function begin(key){
  const h=evidence.heroes.find(h=>h.spells.some(s=>s.skillKey===key));
  if(!h)throw Error('来源证据缺英雄 '+key);
  const s=h.spells.find(s=>s.skillKey===key);
  const c={skillKey:key,name:s.official.name,maxLevel:s.official.maxrank??1,source:{hero:h.id,rootPath:h.rootPath,spellPath:s.binding,clientSha256:h.client.sha256,officialSha256:h.official.sha256,currentBoundText:textEvidence.skills?.[key]??null},write:{parameters:[],formulas:[],effects:[],processes:[],internalStates:[],triggerRules:[]},proofs:[],pending:[],excluded:[]};
  plan.skills[key]=c;
  return {c,s,p:s.object.mSpell};
}

function parameter(x,key,name,values,description,mode){
  const a=Array.isArray(values)?values:[values];
  if(!a.length||!a.every(Number.isFinite))throw Error('缺值 '+x.c.skillKey+'/'+key);
  const variable=mode==='CHARACTER_LEVEL'||new Set(a).size>1;
  const body={parameterKey:key,name,valueType:a.every(Number.isInteger)?'INTEGER':'DECIMAL',valueMode:mode??(variable?'SKILL_LEVEL':'FIXED'),fixedValue:variable?null:a[0],levelValues:variable?levels(a):null,description,sortOrder:(x.c.write.parameters.length+1)*10};
  x.c.write.parameters.push(body);
  return key;
}

function data(x,source,key,name,{scale=1,unit=''}={}){
  const d=(x.p.DataValues??x.p.mDataValues??[]).find(d=>(d.name??d.mName)===source);
  const raw=d?.values??d?.mValues;
  if(!raw||raw.length<x.c.maxLevel+1)throw Error('数据字段缺失 '+x.c.skillKey+'/'+source);
  const arr=raw.slice(1,x.c.maxLevel+1).map(v=>clean(clean(v)*scale));
  x.c.proofs.push({parameterKey:key,source:'DataValues.'+source,raw,offset:1,values:arr,scale});
  return parameter(x,key,name,arr,`客户端当前根绑定 DataValues.${source} 取索引1至${x.c.maxLevel}${unit?'；单位'+unit:''}${scale!==1?'；按来源显示单位换算为系统比例/毫秒':''}。`);
}

function literal(x,key,name,value,description,path){
  x.c.proofs.push({parameterKey:key,source:path??'官方说明或明确计算派生',values:Array.isArray(value)?value:[value]});
  return parameter(x,key,name,value,description);
}

function runtime(x,key,name,description,type='DECIMAL'){
  x.c.write.parameters.push({parameterKey:key,name,valueType:type,valueMode:'RUNTIME_INPUT',fixedValue:null,levelValues:null,description,sortOrder:(x.c.write.parameters.length+1)*10});
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

function damagePending(x,key,name,formulaKey){
  pending(x,'伤害结果资格：'+key,`公式${formulaKey}只保留数学关系；当前冻结资料没有该分支的法术护盾、暴击、吸血及技能结果资格实证，不创建默认DAMAGE结果或SKILL_HIT触发。`,'来源');
}

function healPending(x,key,name,formulaKey){
  pending(x,'治疗结果资格：'+key,`公式${formulaKey}只保留数学关系；当前冻结资料没有该分支的DIRECT_HEAL结果类型、实际治疗时点及中断条件实证，不创建瞬时治疗结果。`,'来源');
}

function manaEffect(x){
  effect(x,'mana_cost','施放法力消耗',[result('consume_mana','消耗法力','RESOURCE_CHANGE','SOURCE',val('mana_cost'),{attributeKey:'mana',operation:'CONSUME'})],null,'仅绑定官方基础法力消耗；额外持续法力或真实扣除时点单独记录。');
}

function common(x,{cooldown=true,mana=true,cast=true,channelDuration=false}={}){
  const d=x.s.official,n=x.c.maxLevel,p=x.p;
  if(cooldown){
    const official=d.cooldown;
    if(!Array.isArray(official)||official.length!==n)throw Error('官方冷却数组缺失 '+x.c.skillKey);
    const root=p.Cooldown?.values?.slice(1,n+1);
    if(root&&root.length===n){
      if(!root.every((v,i)=>Math.abs(v-official[i])<1e-4))throw Error('冷却不符 '+x.c.skillKey);
      literal(x,'cooldown_ms','基础冷却时间（毫秒）',official.map(v=>Math.round(v*1000)),'官方逐级冷却与当前根Cooldown.values索引1至等级上限逐级一致；不含急速或其他技能修正。','official.cooldown + Cooldown.values');
    }else{
      literal(x,'cooldown_ms','基础冷却时间（毫秒）',official.map(v=>Math.round(v*1000)),'官方逐级冷却已冻结；当前根绑定缺少可逐级核对的Cooldown.values，保留该来源缺口，不补造客户端字段。','official.cooldown；根Cooldown.values缺失');
      pending(x,'客户端基础冷却字段缺失','当前根对象没有完整Cooldown.values，候选只采用官方16.17.1逐级冷却；待补客户端对应字段或后端现值复核。','来源');
    }
  }
  if(mana){
    const official=d.cost;
    if(!Array.isArray(official)||official.length!==n)throw Error('官方法力数组缺失 '+x.c.skillKey);
    if(official.every(v=>Number(v)===0)){
      x.c.proofs.push({source:'official.cost',values:official,excluded:true,semantic:'官方成本明确全为0；只留来源证据，不创建0资源变更参数或效果。'});
    }else{
    const root=p.manaValues?.values?.slice(0,n);
    if(root&&root.length===n){
      if(!root.every((v,i)=>Math.abs(v-official[i])<1e-4))throw Error('法力不符 '+x.c.skillKey);
      literal(x,'mana_cost','基础法力消耗',official,'官方cost与当前根manaValues逐级一致；不含额外持续资源。','official.cost + manaValues.values');
    }else{
      literal(x,'mana_cost','基础法力消耗',official,'官方cost明确基础法力消耗；当前根绑定缺少manaValues逐级字段，保留该来源缺口，不将缺失当作零。','official.cost；根manaValues缺失');
      pending(x,'客户端法力字段缺失','当前根对象没有完整manaValues；官方无消耗说明仅在官方cost为0时成立，仍保留根字段缺口。','来源');
    }
    manaEffect(x);
    }
  }
  if(cast){
    if(Number.isFinite(p.spellCastTime)){
      if(p.mUseAutoattackCastTimeData)pending(x,'施法时间由普攻数据决定','根字段声明沿用普攻施法数据，未把缺少具体动作数据当作0毫秒。','来源');
      else if(p.mCastTime!=null&&Math.abs(p.spellCastTime-p.mCastTime)>1e-4)pending(x,'spellCastTime与mCastTime冲突','两个根时长字段不一致；本批不擅自选择其中一个作为完整命中时点。','来源');
      else literal(x,'cast_time_ms','施法时间（毫秒）',Math.round(p.spellCastTime*1000),'当前根spellCastTime；仅保存根字段，不表示命中发生在施法结束。','spellCastTime');
    }else pending(x,'施法时间缺失','当前根没有可用spellCastTime；不补写0毫秒。','来源');
  }
  if(channelDuration){
    const raw=p.mChannelDuration;
    const a=Array.isArray(raw)?raw.slice(0,n):null;
    if(!a||a.length!==n||!a.every(Number.isFinite))throw Error('引导时间缺失 '+x.c.skillKey);
    literal(x,'channel_duration_ms','引导持续时间（毫秒）',a.map(v=>Math.round(v*1000)),'当前根mChannelDuration逐级值；不据此推导命中次数或周期。','mChannelDuration');
  }
}

function processStart(x,{stepType=null,stepKey='start',detail={},effects=[]}={}){
  const hasMana=x.c.write.effects.some(e=>e.effectKey==='mana_cost');
  const step=stepType??(x.c.write.parameters.some(p=>p.parameterKey==='cast_time_ms')?'DELAY':'IMMEDIATE');
  const stepDetail=step==='DELAY'&&Object.keys(detail).length===0?{delayValue:val('cast_time_ms')}:detail;
  const bindings=[...(hasMana?[{bindingKey:'mana_cost',effectKey:'mana_cost',moment:{momentType:'PROCESS_START',stepKey:null},sortOrder:10}]:[]),...effects.map((effectKey,i)=>({bindingKey:effectKey,effectKey,moment:{momentType:'STEP_COMPLETE',stepKey},sortOrder:20+i*10}))];
  x.c.write.processes.push({processKey:'cast',name:'施放'+x.c.name,activationType:'ACTIVE',description:'仅表达已确证成本、冷却、施法/引导时长及明确自益；不生成敌人命中或空间位移。',sortOrder:10,cooldown:x.c.write.parameters.some(p=>p.parameterKey==='cooldown_ms')?{durationValue:val('cooldown_ms'),startMoment:{momentType:'PROCESS_START',stepKey:null}}:null,steps:[{stepKey,name:step==='DELAY'?'施法延迟':step==='CHANNEL'?'引导阶段':'施放开始',description:null,sortOrder:10,stepType:step,detail:stepDetail}],effectBindings:bindings,stateOperations:[]});
}

function channel(x,{effects=[]}={}){processStart(x,{stepType:'CHANNEL',stepKey:'channel',detail:{durationValue:val('channel_duration_ms')},effects});}

function hit(x,effectKey,ruleKey='actual_hit',description=null){
  x.c.write.triggerRules.push({ruleKey,name:description?description.split('；')[0]:x.c.name+'实际命中',description:description??'只接受该技能真实命中；规则本身不生成命中，也不替代控制、跨技能与空间联动。',sortOrder:10,eventSource:{eventType:'SKILL_HIT',detail:{sourceSkillKey:x.c.skillKey}},conditionGroups:[],actions:[{actionKey:effectKey,name:'执行'+effectKey,actionType:'EXECUTE_EFFECT',sortOrder:10,targetContext:'CURRENT_TARGET',detail:{effectKey},runtimeInputBindings:[],resultModifiers:[]}],perTargetCooldown:null,maxTriggersPerProcess:null});
}

function statEffect(x,key,name,value,attributeKey,{duration=null,target='SOURCE',operation='INCREASE',description='独立持续属性；应用、取消与实际触发分别核对。'}={}){
  const lifecycle=life(duration);
  if(target==='TARGET')lifecycle.instanceScope='SOURCE_TARGET';
  effect(x,key,name,[result('attribute',name,'ATTRIBUTE_CHANGE',target,value,{attributeKey,operation,modifierZoneKey:'attribute_flat_add'},behavior)],lifecycle,description);
}

function pending(x,component,reason,kind='配置'){x.c.pending.push({kind,component,reason});}
function exclude(x,component,reason){x.c.excluded.push({component,reason});}
function excludeData(x,source,semantic){
  const raw=(x.p.DataValues??x.p.mDataValues??[]).find(v=>(v.name??v.mName)===source);
  x.c.proofs.push({source:'DataValues.'+source,raw,excluded:true,semantic});
}
function requireCalc(x,key){const c=x.p.mSpellCalculations?.[key];if(!c)throw Error('缺计算树 '+x.c.skillKey+'/'+key);return c;}

function interpolation(x,key,name,part,scale=1){
  if(part?.__type!=='ByCharLevelInterpolationCalculationPart')throw Error('不是角色等级插值 '+x.c.skillKey+'/'+key);
  const reason='当前源仅给插值端点；起止等级、布尔选项和取整规则未证。实际等级值必须外供，不按1至18级线性展开，也不填默认值。';
  runtime(x,key,name+'（实际值外供）',reason);
  x.c.proofs.push({parameterKey:key,source:'mSpellCalculations角色等级插值原节点',raw:part,values:null,scale,sourcePending:true,semantic:reason});
  pending(x,'等级插值求值：'+key,reason,'来源');
  return key;
}

function breakpoints(x,key,name,part,scale=1){
  if(part?.__type!=='ByCharLevelBreakpointsCalculationPart')throw Error('不是角色等级断点 '+x.c.skillKey+'/'+key);
  const reason='原节点断点字段保留；断点当级、斜率累加及额外值求值顺序未证，实际等级值外供且没有默认。';
  runtime(x,key,name+'（实际值外供）',reason);
  x.c.proofs.push({parameterKey:key,source:'mSpellCalculations角色等级断点原节点',raw:part,values:null,scale,sourcePending:true,semantic:reason});
  pending(x,'等级断点求值：'+key,reason,'来源');
  return key;
}
