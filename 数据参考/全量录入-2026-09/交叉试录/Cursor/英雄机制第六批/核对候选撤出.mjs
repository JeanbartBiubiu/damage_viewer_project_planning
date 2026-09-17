import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const get=n=>readFile(new URL(n,import.meta.url));
const old=JSON.parse(await get('./未保存候选/原119候选.json')),bytes=await get('./前十技能候选.json'),current=JSON.parse(bytes);
old.skills.jax_p.write.effects=old.skills.jax_p.write.effects.filter(e=>e.effectKey!=='passive_attack_speed');
assert.deepEqual(Object.keys(current.skills),Object.keys(old.skills));for(const key of Object.keys(old.skills))assert.deepEqual(current.skills[key].write,old.skills[key].write);
const out={at:new Date().toISOString(),currentSha256:createHash('sha256').update(bytes).digest('hex'),removed:['jax_p/effects/passive_attack_speed'],otherBusinessPayloadUnchanged:true};await writeFile(new URL('./未保存候选/撤出差异核对.json',import.meta.url),JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out));
