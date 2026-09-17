import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
if(process.argv.length!==2)throw Error('仅无参数本地提取，不写业务接口');
const here=new URL('./',import.meta.url),base=new URL('../../',here),read=url=>JSON.parse(fs.readFileSync(url,'utf8')),sha=b=>createHash('sha256').update(b).digest('hex');
const manifest=read(new URL('来源记录.json',here)),compressed=fs.readFileSync(new URL(manifest.file,here)),raw=gunzipSync(compressed);
assert.equal(sha(compressed),manifest.gzipSha256);assert.equal(sha(raw),manifest.rawSha256);
const client=JSON.parse(raw),inventory=read(new URL('../符文机制盘点/逐项机器清单.json',here));
const sources=read(new URL('装备效果补证/来源与覆盖.json',base));
const textSource=sources.原始资料.find(x=>x.文件.endsWith('lol-16.17-zh_CN.stringtable.json.gz'));
assert(textSource);const textGz=fs.readFileSync(new URL('装备效果补证/'+textSource.文件,base)),textRaw=gunzipSync(textGz);
assert.equal(sha(textGz),textSource.压缩SHA256);assert.equal(sha(textRaw),textSource.原始SHA256);
const loc=JSON.parse(textRaw),texts=loc.entries??loc,textKeys=new Map(Object.keys(texts).map(k=>[k.toLowerCase(),k]));
const selected=[...inventory.entries.map(x=>({id:x.id,name:x.name,scope:x.scope,previousMissing:x.missingSourceValueFacts})),...[[5008,'适应之力'],[5005,'攻击速度'],[5007,'技能急速'],[5010,'移动速度'],[5001,'成长生命值'],[5011,'生命值'],[5013,'韧性与减速抗性']].map(([id,name])=>({id,name,scope:'属性碎片',previousMissing:[]}))];
assert.equal(selected.length,69);assert.equal(new Set(selected.map(x=>x.id)).size,69);
const nodes={},entries=[];
function countTypes(value){if(!value||typeof value!=='object')return;for(const [key,v]of Object.entries(value)){if(key==='__type')nodes[v]=(nodes[v]??0)+1;else countTypes(v);}}
for(const expected of selected){const matches=Object.entries(client).filter(([k,v])=>v.__type==='Perk'&&v.mPerkId===expected.id);assert.equal(matches.length,1,'唯一符文ID '+expected.id);const [sourcePath,object]=matches[0];
 const bindingFields=Object.entries(object).filter(([k,v])=>k.endsWith('LocalizationKey')&&typeof v==='string');
 const bound=Object.fromEntries(bindingFields.map(([field,key])=>{const actualKey=textKeys.get(key.toLowerCase());return[field,{sourceKey:key,resolvedKey:actualKey??null,text:actualKey?texts[actualKey]:null}];}));
 const script=object.mScript?.mSpellScriptData;countTypes(script?.mCalculations);
 entries.push({...expected,sourcePath,sourceObjectSha256:sha(Buffer.from(JSON.stringify(object))),object,bound,summary:{effectAmounts:script?.mEffectAmount??{},calculations:script?.mCalculations??{},otherModeOverrides:Object.keys(script?.mEffectAmountGameMode??{}),hasDefaultScript:!!object.mScript,scriptPath:object.mScript?.mSpellScriptName??null}});
}
const out={at:new Date().toISOString(),version:'16.17',sources:[manifest,{file:textSource.文件,rawSha256:textSource.原始SHA256}],counts:{selected:entries.length,ordinary:62,shards:7,withCalculations:entries.filter(x=>Object.keys(x.summary.calculations).length).length,withEffectAmounts:entries.filter(x=>Object.keys(x.summary.effectAmounts).length).length,calculationNodeTypes:nodes},boundary:'依已确认的69个当前符文身份匹配唯一mPerkId；106个原始Perk并非全都属于本轮。仅提取默认模式脚本和当前绑定文本，不采用ARAM/URF等模式覆盖，不声称计算树已转为业务配置。',entries};
fs.writeFileSync(new URL('当前69项数值来源.json',here),JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify(out.counts));
