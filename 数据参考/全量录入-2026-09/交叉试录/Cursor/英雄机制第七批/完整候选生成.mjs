// 只整合已经分别审查的两个本地候选，不执行网络请求。
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const here=new URL('./',import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
const reviewed=[['前十技能候选.json','26d6cd46a0170ce9e9e657647ecb9f3fd223dd71ae8fe1f0cdd8848177541fed'],['后十技能候选.json','6453dc63f7b721f7c71a4815bfa614587907ed0b641aac85629ca1fb600e393d']],parts=[];
for(const [file,expected]of reviewed){const bytes=await readFile(new URL(file,here));if(sha(bytes)!==expected)throw Error('已审候选版本改变 '+file);parts.push(JSON.parse(bytes));}
const skills=Object.assign({},...parts.map(p=>p.skills));if(Object.keys(skills).length!==20)throw Error('合并必须20槽且无重键');
const plan={meta:{...parts[0].meta,stage:'20槽确定组成已通过独立审查；完整集合只读预检后等待根任务放行写入',scope:'蔚、奥拉夫、魔腾、薇恩20槽；只创建缺失组成，完整保护主体及既有公共参数',executor:'Cursor SDK实际完成前10原始候选，Codex执行代理按独审修订并整合后10；原始与审校证据分别保留',sourceChecks:parts.flatMap(p=>p.meta.sourceChecks??[]),parts:reviewed.map(([file,sha256])=>({file,sha256})),generatedAt:new Date().toISOString(),apiWrites:0},skills};
const bytes=JSON.stringify(plan,null,2)+'\n',sha256=sha(bytes),totals=Object.fromEntries(Object.keys(Object.values(skills)[0].write).map(k=>[k,Object.values(skills).reduce((n,s)=>n+s.write[k].length,0)])),reused=Object.values(skills).reduce((n,s)=>n+s.reusedParameters.length,0);
await writeFile(new URL('完整候选.json',here),bytes);await writeFile(new URL('完整候选版本.json',here),JSON.stringify({sha256,reviewedParts:reviewed.map(([file,sha256])=>({file,sha256})),totals,reused,total:Object.values(totals).reduce((a,b)=>a+b,0)},null,2)+'\n');console.log(JSON.stringify({sha256,totals,reused,total:Object.values(totals).reduce((a,b)=>a+b,0)}));
