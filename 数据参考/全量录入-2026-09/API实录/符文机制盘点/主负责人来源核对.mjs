import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
if(process.argv.length!==2)throw Error('仅本地来源核对');
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../../装备符文');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8')),sha=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const frozen=read(path.join(here,'冻结来源.json')),extra=read(path.join(here,'关联装备来源.json')),cache=new Map(),checks=[];
for(const item of frozen.inputs){const file=path.join(root,item.file);assert.equal(sha(file),item.sha256);cache.set(item.file,read(file));}
const itemsFile=path.join(root,'官方原始资料/item-16.17.1-zh_CN.json');assert.equal(sha(itemsFile),extra.sourceSha256);cache.set('官方原始资料/item-16.17.1-zh_CN.json',read(itemsFile));
function verify(id,source){const actual=source.pointer.split('/').slice(1).reduce((a,k)=>a[k.replace(/~1/g,'/').replace(/~0/g,'~')],cache.get(source.file));assert.deepEqual(actual,source.raw);checks.push({id,file:source.file,pointer:source.pointer,matched:true});}
for(const row of frozen.items){verify(row.id,row.source.official);verify(row.id,row.source.client);}for(const row of extra.items)verify(row.id,row);
const candidate=path.join(here,'下一批最多12项.json');assert.equal(sha(candidate),'a22d0f1cf63b51cc47fc128f532c596e608719c25710b41a0756cd637479b9f4');
const report={at:new Date().toISOString(),sourceChecks:checks.length,passed:true,checks,candidateSha256:sha(candidate),manualReview:['12项全部固定参数及超然5/8级断点已逐项对照两份原文，三重补药依同版2150/2152原对象','10公式逐式核对持有者最大/已损生命和资源、攻击力BONUS及比例单位；不灭两分支不可同时执行','仅欢欣基础攻速、超然等级急速、复苏基础强度3项来源初始化；其他条件不默认','7整项排除均保留跨技能依赖依据；传奇与过度生长的战前小兵/野怪进度仍保留','不灭公式和效果显示名称后续录入时改中文；原冻结候选保留不覆盖'],boundary:'来源与候选审查；实际业务保存及页面验收见符文效果第二批，不据此记为完整符文'};
fs.writeFileSync(path.join(here,'主负责人来源核对.json'),JSON.stringify(report,null,2)+'\n');fs.writeFileSync(path.join(here,'.gitattributes'),'* -text whitespace=cr-at-eol\n');console.log(JSON.stringify({sourceChecks:checks.length,passed:true}));
