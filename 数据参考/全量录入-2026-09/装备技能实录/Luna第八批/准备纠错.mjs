import {readFile,writeFile,mkdir,copyFile,access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root='C:/project/damage_viewer_project_planning';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const exists=f=>access(f).then(()=>true,()=>false);
const original=['README.md','实际体验报告.md','录入候选.json','录入装备技能.mjs','独立最终回读.mjs','独立最终回读.json','逐字段回读证据.json','写入执行记录.json'];
await mkdir(path.join(dir,'修正前证据'),{recursive:true});
for(const file of original){const target=path.join(dir,'修正前证据',file.endsWith('.mjs')?file+'.txt':file);if(!await exists(target))await copyFile(path.join(dir,file),target,constants.COPYFILE_EXCL);}
const old=JSON.parse(await readFile(path.join(dir,'修正前证据/录入候选.json'),'utf8'));
const evidence=JSON.parse(await readFile(path.join(dir,'修正前证据/逐字段回读证据.json'),'utf8'));
assert.deepEqual(old.objects.map(o=>o.equipmentKey).sort(),['item_3032','item_3050','item_3071','item_3803','item_6653','item_8010']);
assert.equal(old.objects.find(o=>o.equipmentKey==='item_3032').triggerRules.length,0);
const source={at:new Date().toISOString(),version:'16.17.1/客户端16.17',files:[],items:{},texts:{},official:{},hashBindings:{}};
const loaded=[];
for(const h of evidence.source.hashes){const bytes=await readFile(path.join(root,h.relativePath));assert.equal(sha(bytes),h.sha256,'原批次冻源文件哈希变化');const raw=h.relativePath.endsWith('.gz')?gunzipSync(bytes):bytes;source.files.push({...h,decodedSha256:sha(raw)});loaded.push(JSON.parse(raw));}
const [items,textContainer,official]=loaded,texts=textContainer.entries??textContainer;
for(const o of old.objects){const id=o.equipmentKey.slice(5),item=items['Items/'+id];assert.equal(item.itemID,Number(id));source.items[id]={root:'Items/'+id,object:item};source.official[id]=official.data[id];const keys=new Set(Object.values(item.mItemDataClient.mTooltipData.mLocKeys).map(s=>s.toLowerCase()));for(const name of ['mDescription','mDynamicTooltip','mShopTooltip'])if(item.mItemDataClient[name])keys.add(item.mItemDataClient[name].toLowerCase());for(const k of keys)if(texts[k]!=null)source.texts[k]=texts[k];for(const[k,v]of Object.entries(texts))if(new RegExp('^(generatedtip_)?item_'+id+'_tooltip.*extended').test(k))source.texts[k]=v;}
const fnv=s=>{let h=0x811c9dc5;for(const c of s.toLowerCase()){h^=c.charCodeAt(0);h=Math.imul(h,0x1000193);}return (h>>>0).toString(16);};
for(const key of ['CritPerStackMelee','StackRangedMultiplier'])source.hashBindings[key]=fnv(key);
assert.equal(source.hashBindings.CritPerStackMelee,'52d90ad0');assert.equal(source.hashBindings.StackRangedMultiplier,'1eea3407');
await writeFile(path.join(dir,'冻结来源补证.json'),JSON.stringify(source,null,2)+'\n');
const snapshotPath=path.join(dir,'纠错前实库.json');
if(await exists(snapshotPath)){console.log('已保留原始纠错前实库快照，不覆盖；来源哈希核对通过');process.exit(0);}
const apiBase='http://127.0.0.1:8080/api/admin/games/lol';
async function get(route){const r=await fetch(apiBase+route,{headers:{Authorization:'Bearer local-entry'},signal:AbortSignal.timeout(30000)}),data=await r.json();assert.equal(r.status,200,route);return {status:r.status,data};}
const out={at:new Date().toISOString(),mode:'只读纠错前快照',skills:{},equipment:{},modifierZones:await get('/modifier-zones')};
for(const o of old.objects){const key=o.skill.skillKey,s={subject:await get('/skills/'+key),lists:{},components:{}};for(const[kind,idField]of [['parameters','parameterKey'],['formulas','formulaKey'],['effects','effectKey'],['processes','processKey'],['internal-states','stateKey'],['trigger-rules','ruleKey']]){s.lists[kind]=await get('/skills/'+key+'/'+kind);s.components[kind]=[];for(const item of s.lists[kind].data)s.components[kind].push((await get('/skills/'+key+'/'+kind+'/'+item[idField])).data);}out.skills[key]=s;out.equipment[o.equipmentKey]={attributes:await get('/equipment/'+o.equipmentKey+'/attributes'),relation:await get('/equipment-skill-relations?equipmentKey='+o.equipmentKey),equipmentImage:await get('/equipment/'+o.equipmentKey+'/representative-image'),skillImage:await get('/skills/'+key+'/representative-image')};}
await writeFile(snapshotPath,JSON.stringify(out,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({frozenItems:Object.keys(source.items).length,frozenTexts:Object.keys(source.texts).length,subjects:Object.keys(out.skills).length,components:Object.values(out.skills).reduce((n,s)=>n+Object.values(s.components).reduce((a,b)=>a+b.length,0),0),zones:out.modifierZones.data.items.length}));
