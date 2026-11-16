// 시민 실시간 제보 API (Cloudflare Pages Functions + D1)
async function hash(s){
  const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));
  return [...new Uint8Array(b)].slice(0,8).map(x=>x.toString(16).padStart(2,'0')).join('');
}

export async function onRequestGet({env}){
  const {results}=await env.DB.prepare(
    'SELECT station,status,created FROM feedback ORDER BY id DESC LIMIT 10').all();
  return Response.json(results,{headers:{'Cache-Control':'public, max-age=15'}});
}

export async function onRequestPost({request,env}){
  let b;
  try{b=await request.json();}catch(e){return new Response('bad',{status:400});}
  const station=String(b.station||'').trim().slice(0,30);
  const status=b.status==='가능'?'가능':b.status==='불가'?'불가':null;
  if(!station||!status)return new Response('bad',{status:400});
  // 도배 방지: 같은 사용자 1분에 1건 (IP는 해시로만 저장)
  const ip=await hash(request.headers.get('CF-Connecting-IP')||'x');
  const last=await env.DB.prepare('SELECT 1 FROM feedback WHERE ip=? AND created>? LIMIT 1')
    .bind(ip,Date.now()-60000).first();
  if(last)return new Response('too fast',{status:429});
  await env.DB.prepare('INSERT INTO feedback(station,status,ip,created) VALUES(?,?,?,?)')
    .bind(station,status,ip,Date.now()).run();
  return new Response('ok');
}
