const headers={Authorization:'Bearer local-entry',Accept:'application/json'};
const base='http://127.0.0.1:8080/api/admin/games/lol';
function unwrap(data){
  if(Array.isArray(data))return data;
  for(const k of ['items','content','data','records','list'])if(Array.isArray(data?.[k]))return data[k];
  return data;
}
const attrs=unwrap(await (await fetch(base+'/attributes?status=ENABLED',{headers})).json());
const dmg=unwrap(await (await fetch(base+'/damage-types?status=ENABLED',{headers})).json());
const zones=unwrap(await (await fetch(base+'/modifier-zones?status=ENABLED',{headers})).json());
const {writeFile}=await import('node:fs/promises');
const list=x=>Array.isArray(x)?x:[];
const slim={
  attributeShape:Array.isArray(attrs)?'array':Object.keys(attrs||{}),
  damageShape:Array.isArray(dmg)?'array':Object.keys(dmg||{}),
  attributes:list(attrs).map(a=>({attributeKey:a.attributeKey,name:a.name})),
  damageTypes:list(dmg).map(a=>({damageTypeKey:a.damageTypeKey,name:a.name})),
  modifierZones:list(zones).map(a=>({modifierZoneKey:a.modifierZoneKey,name:a.name}))
};
await writeFile(new URL('./来源冻结/目录键.json',import.meta.url),JSON.stringify(slim,null,2)+'\n');
console.log(JSON.stringify({attributeCount:slim.attributes.length,damageTypes:slim.damageTypes,zones:slim.modifierZones,attributeKeys:slim.attributes.map(a=>a.attributeKey)},null,2));
