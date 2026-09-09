import {begin,data,literal,runtime,formula,pending,pn,attr,op,requireCalc,unknownCurve,sourceProof} from './候选.mjs';

export const clean=n=>Math.round(n*1e6)/1e6;
export function start(key){const x=begin(key);x.dataMap=new Map();x.levelInputs=new Map();return x;}
export function datum(x,source,key,name,options={}){data(x,source,key,name,options);x.dataMap.set(source,{key,scale:options.scale??1});return pn(key);}
export function fixed(x,key,name,value,why,source){literal(x,key,name,value,why,source);return pn(key);}
export function input(x,key,name,why,type='DECIMAL'){runtime(x,key,name+'（实际值外供）',why,type);pending(x,'实际输入：'+key,why,'配置');return pn(key);}
export function curve(x,key,name,raw,source,why,type='DECIMAL'){return unknownCurve(x,key,name,raw,source,why,type);}
export function calc(x,key,name,expression,why,sourceKey=null){
  formula(x,key,name,expression,why);
  if(sourceKey)sourceProof(x,'mSpellCalculations.'+sourceKey,requireCalc(x,sourceKey),why);
  return pn(key);
}
export {attr,op,requireCalc};
