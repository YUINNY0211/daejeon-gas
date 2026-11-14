// 시민 실시간 제보 API (Cloudflare Pages Functions + D1)
// - 사용자(기기)당 주유소 1표: 같은 주유소는 변경·취소 가능(새 행이 생기지 않음)
// - 새 주유소에 처음 제보할 때만 1분 제한, IP당 1시간 20건 상한
const enc = new TextEncoder();
async function h(s) {
  const b = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(b)].slice(0, 10).map(x => x.toString(16).padStart(2, '0')).join('');
}
const ok = () => new Response('ok');

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (url.searchParams.get('mine')) {            // 내가 남긴 제보 목록
    const v = request.headers.get('X-Voter') || '';
    if (v.length < 8) return Response.json([]);
    const { results } = await env.DB.prepare(
      "SELECT sid,status FROM votes WHERE voter=? AND status!='취소'").bind(await h('v:' + v)).all();
    return Response.json(results, { headers: { 'Cache-Control': 'no-store' } });
  }
  const { results } = await env.DB.prepare(
    "SELECT sid,station,status,updated AS created FROM votes WHERE status!='취소' ORDER BY updated DESC LIMIT 30").all();
  return Response.json(results, { headers: { 'Cache-Control': 'public, max-age=10' } });
}

export async function onRequestPost({ request, env }) {
  let b;
  try { b = await request.json(); } catch (e) { return new Response('bad', { status: 400 }); }
  const sid = Number(b.sid);
  const station = String(b.station || '').trim().slice(0, 40);
  const voter = String(b.voter || '').slice(0, 80);
  const status = ['가능', '불가', '취소'].includes(b.status) ? b.status : null;
  if (!Number.isInteger(sid) || sid < 1 || sid > 2000 || !station || voter.length < 8 || !status)
    return new Response('bad', { status: 400 });

  const now = Date.now();
  const vh = await h('v:' + voter);
  const ih = await h('i:' + (request.headers.get('CF-Connecting-IP') || 'x'));

  const cur = await env.DB.prepare('SELECT status,updated FROM votes WHERE voter=? AND sid=?').bind(vh, sid).first();
  if (cur) {                                        // 이미 제보한 주유소: 변경/취소는 바로 가능
    if (now - cur.updated < 2000) return new Response('slow', { status: 429 });
