// 장소·사거리 검색 (네이버 개발자센터 '검색 > 지역' API를 서버에서 대신 호출)
// 환경변수(Secret) NAVER_SEARCH_ID, NAVER_SEARCH_SECRET 이 필요합니다.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const o = request.headers.get('Origin') || request.headers.get('Referer') || '';
  if (o && !o.includes(url.host)) return new Response('forbidden', { status: 403 });   // 다른 사이트의 무단 호출 차단
  const q = (url.searchParams.get('q') || '').trim().slice(0, 40);
  if (!q) return Response.json({ items: [] });
  if (!env.NAVER_SEARCH_ID || !env.NAVER_SEARCH_SECRET) return new Response('not configured', { status: 503 });
  const r = await fetch('https://openapi.naver.com/v1/search/local.json?display=5&query=' + encodeURIComponent(q), {
    headers: { 'X-Naver-Client-Id': env.NAVER_SEARCH_ID, 'X-Naver-Client-Secret': env.NAVER_SEARCH_SECRET }
  });
  if (!r.ok) return new Response('upstream', { status: 502 });
  const d = await r.json();
  const items = (d.items || []).map(i => ({ title: i.title, category: i.category, address: i.address, roadAddress: i.roadAddress, mapx: i.mapx, mapy: i.mapy }));
  return Response.json({ items }, { headers: { 'Cache-Control': 'no-store' } });
}
