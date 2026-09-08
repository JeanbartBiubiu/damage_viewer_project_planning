import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
const root='C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09/技能公共参数实录/客户端原文/';
for(const id of ['Darius','Veigar']){const all=JSON.parse(gunzipSync(await readFile(root+id+'.json.gz')));for(const[k,v]of Object.entries(all)){if((id==='Darius'&&/Darius(NoxianTactics|Q|W|R)/i.test(k))||(id==='Veigar'&&/VeigarR|VeigarDarkMatter/i.test(k))){console.log(JSON.stringify({path:k,object:v}));}}}
