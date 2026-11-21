import {retention,REPORT_PUBLIC,suggestionDue,suggestionDueAt} from './retention.js';
import {issueProof,verifyProof} from './request-proof.js';
﻿import {digest,managementMutation} from './manage.js';
import {fail,json,origin,body,fields,text,hmac,turnstile,admin,Fault} from './security.js';
export const PRODUCTION_ORIGIN='https://daejeongasmap.kr';
// 운영 쓰기는 서명 비밀값, Turnstile 비밀값·사이트 키, 승인된 호스트가 모두 있을 때만 준비 완료로 봅니다.
function productionConfigured(env){return typeof env.ABUSE_HMAC_SECRET==='string'&&env.ABUSE_HMAC_SECRET.length>=32&&!!env.TURNSTILE_SECRET&&!!env.TURNSTILE_SITE_KEY&&env.TURNSTILE_HOSTNAME===new URL(PRODUCTION_ORIGIN).hostname;}
const DAY=86400000,tokenPattern=/^[a-f0-9]{64}$/,requestPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function publicTime(ms){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(ms)).replace(' ','T')+'+09:00';}
// 승인되지 않은 자동 삭제는 모든 호출 경로에서 비활성화합니다.
export async function cleanup(env,now,options){return retention(env,now,options);}
export async function cleanupSecurity(env,now,options){return retention(env,now,{...options,security:true});}
async function station(db,id){if(!Number.isSafeInteger(id)||id<1)fail(400,'unknown_station');if(!await db.prepare('SELECT id FROM citizen_stations WHERE id=? AND active=1 AND visible=1').bind(id).first())fail(400,'unknown_station');return id;}
function cursor(url){const raw=url.searchParams.get('before');if(raw===null)return Number.MAX_SAFE_INTEGER;const n=Number(raw);if(!/^\d+$/.test(raw)||!Number.isSafeInteger(n)||n<1)fail(400,'invalid_cursor');return n;}
const items={cashback:['cashback_received','cashback_not_received','official_mismatch'],location:['location','address'],other:['carwash','brand_name','brand_change','closed_moved','other']};
async function replay(db,b,fingerprint){
 const row=await db.prepare('SELECT request_hash,result_json FROM citizen_guards WHERE request_id=?').bind(b.requestId).first();
 if(!row)return null;if(row.request_hash!==fingerprint)fail(409,'request_conflict');
 const result=JSON.parse(row.result_json);
 if(!result.reportId){const r=await db.prepare('SELECT id FROM citizen_reports WHERE submission_id=?').bind(b.requestId).first();if(r)result.reportId=r.id;}
 return result;
}
export async function handle({request,env},deps={}){
 const now=deps.now??Date.now(),fetcher=deps.fetch??fetch;
 try{
  if(!env.DB)fail(503,'not_configured');
  const db=env.DB,url=new URL(request.url),route=url.pathname.replace(/^\/api\/citizen\/?/,'');
  const localPreview=env.LOCAL_TEST_MODE==='true'&&/^http:\/\/127\.0\.0\.1:\d+$/.test(env.PUBLIC_ORIGIN||'')&&url.origin===env.PUBLIC_ORIGIN;
  // 운영은 승인된 정확한 도메인에서만 열리고, 로컬 테스트 모드와 함께 설정되면 닫힙니다(fail-closed).
  // 설정값(PUBLIC_ORIGIN)뿐 아니라 실제 요청 주소(request.url)의 origin도 승인된 운영 도메인이어야 합니다(www·pages.dev·HTTP·포트 변형 차단).
  const production=env.LOCAL_TEST_MODE!=='true'&&env.PUBLIC_ORIGIN===PRODUCTION_ORIGIN&&url.origin===PRODUCTION_ORIGIN;
  if(!localPreview&&!production)fail(503,'local_only_build');
  const writesReady=env.CITIZEN_WRITES_ENABLED==='true'&&(localPreview||productionConfigured(env));
  if(route==='config'&&request.method==='GET')return json({
    siteKey:env.TURNSTILE_SITE_KEY||null,
    localPreview,
    enabled:writesReady,
    diagnostic:{
      writesFlag:env.CITIZEN_WRITES_ENABLED==='true',
      hmacReady:typeof env.ABUSE_HMAC_SECRET==='string'&&env.ABUSE_HMAC_SECRET.length>=32,
      turnstileReady:!!env.TURNSTILE_SECRET&&!!env.TURNSTILE_SITE_KEY,
      hostnameReady:env.TURNSTILE_HOSTNAME===new URL(PRODUCTION_ORIGIN).hostname
    }
  });
  if(route==='reports'&&request.method==='GET'){
   const limit=Number(url.searchParams.get('limit')??5);if(!Number.isInteger(limit)||limit<1||limit>20)fail(400,'invalid_limit');
   const raw=url.searchParams.get('stationId'),id=raw===null?null:await station(db,Number(raw));
   const filter='hidden=0 AND withdrawn=0 AND created>'+String(now-REPORT_PUBLIC)+(id===null?'':' AND station_id=?');
   const rows=await db.prepare('SELECT r.id,r.station_id,s.display_name,r.status,r.created FROM citizen_reports r JOIN citizen_stations s ON s.id=r.station_id WHERE s.active=1 AND s.visible=1 AND r.'+filter.replaceAll(' AND ',' AND r.')+' AND r.id<? ORDER BY r.id DESC LIMIT ?').bind(...(id===null?[]:[id]),cursor(url),limit).all();
   const counts=await db.prepare("SELECT COUNT(*) AS total,COALESCE(SUM(r.status='received'),0) AS received,COALESCE(SUM(r.status='not_received'),0) AS not_received FROM citizen_reports r JOIN citizen_stations s ON s.id=r.station_id WHERE s.active=1 AND s.visible=1 AND r."+filter.replaceAll(' AND ',' AND r.')).bind(...(id===null?[]:[id])).first();
   return json({items:rows.results.map(r=>({id:r.id,stationId:r.station_id,stationName:r.display_name,status:r.status,reportedAt:publicTime(r.created),publicExpiresAt:r.created+REPORT_PUBLIC})),counts,nextCursor:rows.results.length===limit?String(rows.results.at(-1).id):null});
  }
  if(route.startsWith('admin/')){
   const actor=await admin(request,env,fetcher);
   if(route==='admin/suggestions'&&request.method==='GET'){const rows=await db.prepare('SELECT id,station_id,category,item,body,status,created,resolved,first_resolved_at,retention_review FROM citizen_suggestions WHERE id<? ORDER BY id DESC LIMIT 20').bind(cursor(url)).all();return json({items:rows.results.map(row=>({...row,retentionState:row.retention_review?'review_required':suggestionDue(row,now)?'expired':'active',retentionDueAt:suggestionDueAt(row),processingAllowed:!suggestionDue(row,now)}))});}
   if(request.method!=='POST')fail(405,'method_not_allowed');origin(request,env);
   if(route==='admin/cleanup'){await body(request);return json(await cleanup(env,now));}
   const b=await body(request);fields(b,['id','status','reason']);if(!Number.isSafeInteger(b.id)||b.id<1)fail(400,'invalid_id');const reason=text(b.reason,3,500);
   const target=route==='admin/suggestion'?'citizen_suggestions':route==='admin/hide'?'citizen_reports':null;if(!target)fail(404,'not_found');
   const current=await db.prepare('SELECT * FROM '+target+' WHERE id=?').bind(b.id).first();if(!current)fail(404,'not_found');if(target==='citizen_suggestions'&&suggestionDue(current,now))fail(410,'suggestion_expired');
   let mutation;
   if(target==='citizen_suggestions'){if(!['pending','completed','rejected'].includes(b.status))fail(400,'invalid_status');mutation=db.prepare('UPDATE citizen_suggestions SET status=?,resolved=?,first_resolved_at=CASE WHEN retention_review=1 OR ?=\'pending\' THEN first_resolved_at ELSE COALESCE(first_resolved_at,?) END WHERE id=? AND (retention_review=1 OR (first_resolved_at IS NOT NULL AND first_resolved_at>?) OR (first_resolved_at IS NULL AND created>?)) AND (retention_review=1 OR created>?)').bind(b.status,b.status==='pending'?null:now,b.status,now,b.id,now-30*DAY,now-180*DAY,now-210*DAY);}
   else mutation=db.prepare('UPDATE citizen_reports SET hidden=1 WHERE id=?').bind(b.id);
   const changed=await db.batch([mutation,db.prepare('INSERT INTO citizen_admin_log(actor,action,target,reason,created) SELECT ?,?,?,?,? WHERE changes()>0').bind(actor,route,String(b.id),reason,now)]);if(!changed[0].meta.changes)fail(410,'suggestion_expired');return json({ok:true});
  }
  if(['request','management-status'].includes(route)){
   if(request.method!=='POST')fail(405,'method_not_allowed');origin(request,env);
   const b=await body(request);
   if(route==='request'){if(env.CITIZEN_WRITES_ENABLED!=='true')fail(503,'not_enabled');if(!writesReady)fail(503,'not_configured');fields(b,['kind','data']);if(!b.data||typeof b.data!=='object'||Array.isArray(b.data))fail(400,'invalid_body');return json(await issueProof(env,b.kind,b.data,now));}
   fields(b,['reportId','manageToken']);if(!tokenPattern.test(b.manageToken||''))fail(400,'invalid_management');
   const row=await db.prepare('SELECT id,station_id,status,created,revision,withdrawn FROM citizen_reports WHERE manage_hash=?'+(b.reportId===undefined?'':' AND id=?')).bind(await digest(b.manageToken),...(b.reportId===undefined?[]:[b.reportId])).first();
   if(!row)fail(404,'not_found');if(row.created+REPORT_PUBLIC<=now)fail(410,'management_expired');
   return json({ok:true,reportId:row.id,stationId:row.station_id,status:row.status,created:row.created,manageExpiresAt:row.created+REPORT_PUBLIC,revision:row.revision,withdrawn:!!row.withdrawn});
  }
  if(!['reports','suggestions','manage'].includes(route))fail(404,'not_found');
  if(request.method!=='POST')fail(405,'method_not_allowed');origin(request,env);
  if(env.CITIZEN_WRITES_ENABLED!=='true')fail(503,'not_enabled');
  if(!writesReady)fail(503,'not_configured');
  const b=await body(request);
  fields(b,route==='manage'?['reportId','manageToken','operation','status','requestId','turnstileToken','clientId','proof','revision']:route==='reports'?['stationId','status','manageToken','requestId','turnstileToken','clientId','proof']:['stationId','category','item','message','requestId','turnstileToken','clientId','proof']);
  if(!requestPattern.test(b.requestId||'')||!tokenPattern.test(b.clientId||''))fail(400,'invalid_request_id');
  await verifyProof(env,route,b,now);
  let id=null,owner=null,manageHash=null,message=null;
  if(route==='manage'){
   if(!Number.isSafeInteger(b.reportId)||b.reportId<1||!tokenPattern.test(b.manageToken||''))fail(400,'invalid_management');
   manageHash=await digest(b.manageToken);owner=await db.prepare('SELECT id,withdrawn,created,revision FROM citizen_reports WHERE id=? AND manage_hash=?').bind(b.reportId,manageHash).first();
   if(!owner)fail(404,'not_found');if(owner.created+REPORT_PUBLIC<=now)fail(410,'management_expired');b.manageHash=manageHash;managementMutation(db,b,now);
  }else{
   if(b.stationId!==null&&b.stationId!==undefined)id=await station(db,b.stationId);
   if(route==='reports'){if(id===null)fail(400,'unknown_station');if(!['received','not_received'].includes(b.status)||!tokenPattern.test(b.manageToken||''))fail(400,'invalid_status');manageHash=await digest(b.manageToken);}
   else{if(!items[b.category]?.includes(b.item))fail(400,'invalid_category');if(id===null&&b.category!=='other')fail(400,'unknown_station');message=text(b.message,5,100);}
  }
  const fingerprint=await digest(JSON.stringify([route,id,b.status??null,b.reportId??null,b.operation??null,manageHash,b.category??null,b.item??null,message,b.clientId,b.revision??null]));
  const previous=await replay(db,b,fingerprint);if(previous)return json(previous);
  if(route!=='manage'){
   const existing=await db.prepare('SELECT id,request_hash FROM '+(route==='reports'?'citizen_reports':'citizen_suggestions')+' WHERE submission_id=?').bind(b.requestId).first();
   if(existing){if(existing.request_hash!==fingerprint)fail(409,'request_conflict');return json({ok:true,...(route==='reports'?{reportId:existing.id}:{status:'received'})});}
  }
  if(owner&&owner.revision!==b.revision)fail(409,'revision_conflict');
  if(owner?.withdrawn){if(b.operation==='cancel')return json({ok:true});fail(409,'already_withdrawn');}
  const actor=await hmac(env.ABUSE_HMAC_SECRET,'client:'+b.clientId),scope=route==='manage'?'manage:'+b.operation+':'+b.reportId:'submit';
  if(route==='reports'&&await db.prepare("SELECT 1 FROM citizen_guards g JOIN citizen_reports r ON r.submission_id=g.request_id WHERE g.actor=? AND g.station_id=? AND g.expires>? AND g.created>? AND r.withdrawn=0 AND r.status=? LIMIT 1").bind(actor,id,now,now-3600000,b.status).first()){
   const retry=await replay(db,b,fingerprint);if(retry)return json(retry);fail(409,'duplicate_experience');
  }
  if(route!=='manage'&&await db.prepare('SELECT COUNT(*) AS n FROM citizen_guards WHERE actor=? AND scope=? AND expires>? AND created>?').bind(actor,scope,now,now-60000).first().then(r=>r.n>=3))fail(429,'rate_limited');
  if(route==='manage'&&b.operation==='change'&&await db.prepare('SELECT COUNT(*) AS n FROM citizen_guards WHERE actor=? AND scope=? AND expires>? AND created>?').bind(actor,scope,now,now-60000).first().then(r=>r.n>=10))fail(429,'rate_limited');
  await turnstile(b.turnstileToken,env,route,fetcher);
  const result={ok:true,...(route==='suggestions'?{status:'received'}:route==='reports'?{created:now,manageExpiresAt:now+REPORT_PUBLIC,revision:0}:{reportId:b.reportId,created:owner.created,manageExpiresAt:owner.created+REPORT_PUBLIC,revision:owner.revision+1})};
  const guard=db.prepare('INSERT INTO citizen_guards(request_id,request_hash,actor,station_id,scope,created,expires,result_json) SELECT ?,?,?,?,?,?,?,?'+(route==='manage'?' WHERE EXISTS(SELECT 1 FROM citizen_reports WHERE id=? AND manage_hash=? AND revision=? AND created>? AND withdrawn=0)':'')).bind(b.requestId,fingerprint,actor,id,scope,now,now+DAY,JSON.stringify(result),...(route==='manage'?[b.reportId,manageHash,b.revision,now-REPORT_PUBLIC]:[]));
  let mutation;
  if(route==='reports')mutation=db.prepare('INSERT INTO citizen_reports(station_id,status,created,manage_hash,submission_id,request_hash) VALUES(?,?,?,?,?,?)').bind(id,b.status,now,manageHash,b.requestId,fingerprint);
  else if(route==='suggestions')mutation=db.prepare('INSERT INTO citizen_suggestions(station_id,category,item,body,created,submission_id,request_hash) VALUES(?,?,?,?,?,?,?)').bind(id,b.category,b.item,message,now,b.requestId,fingerprint);
  else mutation=managementMutation(db,b,now);
  try{const applied=await db.batch([guard,mutation]);if(!applied[0].meta.changes||!applied[1].meta.changes)fail(409,'revision_conflict');}catch(e){if(/UNIQUE constraint failed|citizen_rate_limit|citizen_duplicate_experience/.test(e.message)){const same=await replay(db,b,fingerprint);if(same)return json(same);}if(/citizen_rate_limit/.test(e.message))fail(429,'rate_limited');if(/citizen_duplicate_experience/.test(e.message))fail(409,'duplicate_experience');throw e;}
  if(route==='reports'){const row=await db.prepare('SELECT id FROM citizen_reports WHERE submission_id=?').bind(b.requestId).first();result.reportId=row.id;await db.prepare('UPDATE citizen_guards SET result_json=? WHERE request_id=?').bind(JSON.stringify(result),b.requestId).run();}
  return json(result,201);
 }catch(e){return json({error:e instanceof Fault?e.code:'service_unavailable'},e instanceof Fault?e.status:503);}
}

