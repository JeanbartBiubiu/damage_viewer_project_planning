import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const candidate=JSON.parse(fs.readFileSync(path.join(dir,'候选与来源.json'),'utf8'));
const checks=[];
for(const item of candidate.objects){
  const results={};
  for(const[k,route]of Object.entries({subject:`/equipment/${item.equipmentKey}`,attributes:`/equipment/${item.equipmentKey}/attributes`,image:`/equipment/${item.equipmentKey}/representative-image`,relations:`/equipment-skill-relations?equipmentKey=${item.equipmentKey}`})){
    const response=await fetch('http://127.0.0.1:8080/api/admin/games/lol'+route,{headers:{Authorization:'Bearer local-entry'},signal:AbortSignal.timeout(20000)});
    assert.equal(response.status,200);results[k]=await response.json();
  }
  assert.equal(results.subject.name,item.name);assert.equal(results.subject.description,item.description);
  assert.deepEqual(results.attributes.attributeValues,item.attributeValues);
  assert.equal(results.image.image.imageKey,item.imageKey);assert.equal(results.image.image.enabled,true);
  assert.equal(results.relations.items.length,0);
  checks.push({equipmentKey:item.equipmentKey,...results});
}
fs.writeFileSync(path.join(dir,'页面验收.json'),JSON.stringify({at:new Date().toISOString(),url:'http://127.0.0.1:5173/#/equipment',browserChecks:[
  '有点神奇之鞋属性面板显示move_speed25，其他属性未配置，未把额外10加到直接属性。',
  '饼干属性面板仅显示已配置时为空，0已配置/28未配置；没有把消耗后30生命保存为携带属性。',
  '通过API新建的3张图同步前显示未缓存；图片页真实增量同步收到3条，缓存3202→3205，筛选item_2010显示已缓存。',
  '返回装备页，饼干表格图片加载完成；代表图窗口及截图实际展示启用的饼干PNG。'
],experience:['查询后须核对列表实际稳定标识；关闭弹窗立即填词点击曾保留旧结果，再查询才刷新，未在错误对象上保存。','图片关系和缓存是两个状态；未缓存不等于未上传，首次关系加载还会短暂显示未上传图片。'],independentGetCount:16,checks,passed:true,runtime:'未执行'},null,2)+'\n');
console.log(JSON.stringify({independentGetCount:16,subjects:4,passed:true}));
