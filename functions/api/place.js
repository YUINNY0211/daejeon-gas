// Cloudflare Pages Function: functions/api/place.js -> /api/place
// Default: NAVER API HUB. Optional legacy mode only for existing pre-2026-07-31 keys.
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const plain=v=>String(v||'').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
const normalize=v=>plain(v).normalize('NFKC').replace(/\s/g,'').replace(/^대전(?:광역시)?/,'').replace(/^(서구|유성구|중구|동구|대덕구)/,'').replace(/4거리|사거리|네거리|교차로/g,'교차로');
function coordinate(v,max){if(v==null||String(v).trim()==='')return NaN;const n=Number(v);return Math.abs(n)>max?n/1e7:n}
export async function onRequest({request,env}){
  if(request.method!=='GET')return reply({error:'GET 요청만 지원합니다.'},405);
  const url=new URL(request.url),origin=request.headers.get('Origin');
  const production=url.origin==='https://daejeongasmap.kr'&&env.LOCAL_TEST_MODE!=='true';
  const local=env.LOCAL_TEST_MODE==='true'&&/^http:\/\/127\.0\.0\.1:\d+$/.test(env.PUBLIC_ORIGIN||'')&&url.origin===env.PUBLIC_ORIGIN;
  if(!production&&!local)return reply({error:'Origin denied.'},403);
  if((origin&&origin!==url.origin)||request.headers.get('Sec-Fetch-Site')==='cross-site')return reply({error:'이 사이트에서 검색해 주세요.'},403);
  const q=(url.searchParams.get('q')||'').trim();
  if(!q||q.length>100||/[\u0000-\u001f\u007f]/.test(q))return reply({error:'검색어는 1~100자로 입력해 주세요.'},400);
  const id=env.NAVER_SEARCH_ID||env.NAVER_SEARCH_CLIENT_ID,secret=env.NAVER_SEARCH_SECRET||env.NAVER_SEARCH_CLIENT_SECRET;
  if(!id||!secret)return reply({error:'장소 검색 API 설정이 필요합니다. 운영자에게 문의해 주세요.'},503);
  const provider=env.NAVER_SEARCH_PROVIDER||'hub';
  if(!['hub','legacy'].includes(provider))return reply({error:'장소 검색 API 종류 설정을 확인해 주세요.'},503);
  const legacy=provider==='legacy';
  const base=/^대전(?:광역시)?/.test(q)?q:'대전 '+q;
  const junction=/(4거리|사거리|네거리|교차로|삼거리|오거리)$/.test(q);
  const queries=[...new Set(junction?[base,base.replace(/(4거리|사거리|네거리|교차로)$/,'네거리'),base.replace(/(4거리|사거리|네거리|교차로)$/,'사거리'),base.replace(/(4거리|사거리|네거리|교차로)$/,'교차로')]:[base])];
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),14000);
  try{
    for(const query of queries){
      const endpoint=new URL(legacy?'https://openapi.naver.com/v1/search/local.json':'https://naverapihub.apigw.ntruss.com/search/v1/local');
      endpoint.search=new URLSearchParams({query,display:'5',start:'1',sort:'random',...(!legacy?{format:'json'}:{})}).toString();
      const headers=legacy?{'X-Naver-Client-Id':id,'X-Naver-Client-Secret':secret}:{'X-NCP-APIGW-API-KEY-ID':id,'X-NCP-APIGW-API-KEY':secret};
      const response=await fetch(endpoint,{headers,signal:controller.signal});
     if(!response.ok){console.error('PLACE_API_UPSTREAM_HTTP',{status:response.status,provider});return reply({error:response.status===429?'장소 검색 이용 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.':'장소 검색 API 인증 또는 연결을 확인해 주세요.'},response.status===429?429:502);}
      const data=await response.json();if(!Array.isArray(data.items))throw Error('Malformed upstream response');
      const items=data.items.map(i=>({title:plain(i.title),label:plain(i.title),address:i.roadAddress||i.address||'',roadAddress:i.roadAddress||'',jibunAddress:i.address||'',lat:coordinate(i.mapy,90),lng:coordinate(i.mapx,180)})).filter(i=>Number.isFinite(i.lat)&&Number.isFinite(i.lng)&&i.lat>=36.1&&i.lat<=36.6&&i.lng>=127.2&&i.lng<=127.6&&/^대전(?:광역시)?\s/.test(i.address)&&(!junction||normalize(i.title)===normalize(q))).map(i=>({...i,mapx:String(Math.round(i.lng*1e7)),mapy:String(Math.round(i.lat*1e7))}));
      // Return both normalized lat/lng and original-style mapx/mapy for existing clients.
      if(items.length)return reply({items});
    }
    return reply({items:[]});
  }catch(e){return reply({error:e.name==='AbortError'?'장소 검색 응답이 지연되고 있습니다. 다시 시도해 주세요.':'장소 검색 서버에 연결되지 않았습니다.'},502)}
  finally{clearTimeout(timer)}
}
