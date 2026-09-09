import {begin,data,literal,runtime,formula,pending,pn,attr,op,requireCalc} from './候选.mjs';
export const clean=n=>Math.round(n*1e6)/1e6;
export function start(key){const x=begin(key);x.dataMap=new Map();x.constants=new Map();x.unknownStats=new Map();x.levelInputs=new Map();return x;}
export function datum(x,source,key,name,options={}){data(x,source,key,name,options);x.dataMap.set(source,{key,scale:options.scale??1});return pn(key);}
export function fixed(x,key,name,value,why,source){literal(x,key,name,value,why,source);return pn(key);}
export function input(x,key,name,why,type='DECIMAL'){runtime(x,key,name,why,type);pending(x,'实际输入：'+key,why,'来源');return pn(key);}
function constant(x,value,label,source){value=clean(value);const id=String(value);if(x.constants.has(id))return pn(x.constants.get(id));const key='calculation_constant_'+(x.constants.size+1);literal(x,key,label+'固定系数',value,'当前原计算树显式常数；只用于此数学表达式。',source);x.constants.set(id,key);return pn(key);}
function named(x,name){const m=x.dataMap.get(name);if(!m)throw Error('原计算数据未分类 '+x.c.skillKey+'/'+name);return m.scale===1?pn(m.key):op('DIVIDE',pn(m.key),constant(x,m.scale,name+'单位换算比例','候选参数单位换算'));}
function attribute(x,n,source){
 const stat=n.mStat??0,kind=n.mStatFormula??0;
 if(n.mUseNewStats===true||n.useNewStats===true||n.UseNewStats===true||n.mOutputType!=null&&n.mOutputType!==0||n.outputType!=null&&n.outputType!==0)throw Error('超出已证旧属性节点适用范围 '+source);
 let a=null;if(stat===0&&kind===0)a=attr('ability_power','SOURCE','TOTAL');else if(stat===2&&kind===0)a=attr('attack_damage','SOURCE','TOTAL');else if(stat===2&&kind===1&&['StatByCoefficientCalculationPart','StatByNamedDataValueCalculationPart'].includes(n.__type))a=attr('attack_damage','SOURCE','BASE');else if(stat===2&&kind===2)a=attr('attack_damage','SOURCE','BONUS');else if(stat===12&&kind===2)a=attr('hp','SOURCE','BONUS');
 if(a){x.c.proofs.push({source,raw:n,semantic:'同构建旧属性节点窄映射',attribute:a});return a;}
 const id=stat+'_'+kind;if(!x.unknownStats.has(id)){const key='source_stat_'+id+'_value';input(x,key,'原计算属性'+stat+'/'+kind+'实际值','该原节点属性口径未证，必须提供已核实际值；不由字段名猜属性、比例单位或角色基础值。');x.unknownStats.set(id,key);}return pn(x.unknownStats.get(id));
}
function node(x,n,label,source){
 if(!n||typeof n!=='object')throw Error('缺原计算节点 '+source);
 switch(n.__type){
 case 'NamedDataValueCalculationPart':return named(x,n.mDataValue);
 case 'NumberCalculationPart':if(!Object.hasOwn(n,'mNumber'))throw Error('显式常数缺值 '+source);return constant(x,n.mNumber,label,source);
 case 'StatByNamedDataValueCalculationPart':return op('MULTIPLY',attribute(x,n,source),named(x,n.mDataValue));
 case 'StatByCoefficientCalculationPart':if(!Object.hasOwn(n,'mCoefficient'))throw Error('显式系数缺值 '+source);return op('MULTIPLY',attribute(x,n,source),constant(x,n.mCoefficient,label,source+'.mCoefficient'));
 case 'StatBySubPartCalculationPart':return op('MULTIPLY',attribute(x,n,source),node(x,n.mSubpart,label,source+'.mSubpart'));
 case 'AbilityResourceByCoefficientCalculationPart':{
  let resource;if(/^ryze_[qwe]$/.test(x.c.skillKey)&&n.mStatFormula===2){resource=attr('mana','SOURCE','BONUS');x.c.proofs.push({source,raw:n,attribute:resource,semantic:'仅瑞兹当前P具名正文“他的技能基于额外法力值造成额外伤害”与Q/W/E当前资源节点2交叉；不扩到其他英雄或默认资源节点。'});}else{const key='confirmed_ability_resource_'+(n.mStatFormula??0)+'_value';if(!x.unknownStats.has(key)){input(x,key,'原技能资源节点的已确认实际值','角色使用法力不等于该节点取最大/当前/额外法力；本原节点口径未具名证明，必须外供实际值，不默认最大法力。');x.unknownStats.set(key,key);}resource=pn(key);x.c.proofs.push({source,raw:n,parameterKey:key,sourcePending:true});}return op('MULTIPLY',resource,constant(x,n.mCoefficient,label,source+'.mCoefficient'));
 }
 case 'SumOfSubPartsCalculationPart':if(!n.mSubparts?.length)throw Error('空求和');return n.mSubparts.map((v,i)=>node(x,v,label,source+'.mSubparts['+i+']')).reduce((a,b)=>op('ADD',a,b));
 case 'ProductOfSubPartsCalculationPart':return op('MULTIPLY',node(x,n.mPart1,label,source+'.mPart1'),node(x,n.mPart2,label,source+'.mPart2'));
 case 'ByCharLevelInterpolationCalculationPart':case 'ByCharLevelBreakpointsCalculationPart':case 'ByCharLevelFormulaCalculationPart':case '{4ce08984}':{
  if(!x.levelInputs.has(source)){const key=x.currentFormula+'_level_value'+(x.levelInputs.size?'_'+(x.levelInputs.size+1):'');input(x,key,label+'的实际等级项','原等级节点完整保留；起止等级、表索引、断点求值或取整未证，实际值必须外供，不能用端点猜整曲线。');x.levelInputs.set(source,key);x.c.proofs.push({parameterKey:key,source,raw:n,values:null,sourcePending:true});}return pn(x.levelInputs.get(source));
 }
 default:throw Error('未实现的原计算节点 '+n.__type+' '+source);
 }
}
export function expression(x,sourceKey,label,seen=[]){
 if(seen.includes(sourceKey))throw Error('计算引用循环');const c=requireCalc(x,sourceKey),source='mSpellCalculations.'+sourceKey;let result;
 if(c.__type==='GameCalculationModified')result=expression(x,c.mModifiedGameCalculation,label,[...seen,sourceKey]);
 else if(c.__type==='GameCalculation'&&c.mFormulaParts?.length)result=c.mFormulaParts.map((n,i)=>node(x,n,label,source+'.mFormulaParts['+i+']')).reduce((a,b)=>op('ADD',a,b));
 else throw Error('未核计算种类 '+source);
 if(c.mMultiplier)result=op('MULTIPLY',node(x,c.mMultiplier,label,source+'.mMultiplier'),result);
 return result;
}
export function calc(x,sourceKey,key,name,description){x.currentFormula=key;const e=expression(x,sourceKey,name);formula(x,key,name,e,description+'；直接按当前根计算树展开，子计算内联；未知等级和属性值不设默认。');x.c.proofs.push({formulaKey:key,source:'mSpellCalculations.'+sourceKey,raw:requireCalc(x,sourceKey),semantic:description});return e;}
export function sourceOnly(x,source,reason,kind='来源'){
 const raw=source.startsWith('DataValues.')?x.p.DataValues?.find(v=>v.name===source.slice(11)):source.startsWith('mSpellCalculations.')?requireCalc(x,source.slice(19)):null;
 x.c.proofs.push({source,raw,sourcePending:kind==='来源',excluded:kind==='范围外',semantic:reason});if(kind==='范围外')x.c.excluded.push({component:source,reason});else pending(x,source,reason,kind);
}
