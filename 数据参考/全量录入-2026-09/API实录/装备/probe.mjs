const base='http://127.0.0.1:8080/api/admin/games/lol';
const headers={Authorization:'Bearer local-entry',Accept:'application/json','Content-Type':'application/json'};
async function req(path,opts={}){const r=await fetch(base+path,{...opts,headers:{...headers,...(opts.headers||{})}}); const t=await r.text(); let b; try{b=JSON.parse(t)}catch{b=t}; console.log(JSON.stringify({path,status:r.status,body:b}).slice(0,20000));}
await req('/attributes'); await req('/equipment');
await req('/equipment/item_3107/attributes');
