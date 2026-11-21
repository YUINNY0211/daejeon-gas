// Local test implementation. Persistent aggregate logs only in isolated execution.
export const DAY=86400000;
export const REPORT_PUBLIC=90*DAY,REPORT_DELETE=120*DAY;
export const suggestionDueAt=row=>row.retention_review?null:row.first_resolved_at!==null?Math.min(row.first_resolved_at+30*DAY,row.created+210*DAY):row.created+180*DAY;
export const suggestionDue=(row,now)=>!row.retention_review&&suggestionDueAt(row)<=now;
const local=env=>env?.LOCAL_TEST_MODE==='true'&&/^http:\/\/127\.0\.0\.1:\d+$/.test(env.PUBLIC_ORIGIN||'');
const specs=(now,security)=>security?[
 ['reportRequests','citizen_reports','created<=? AND (submission_id IS NOT NULL OR request_hash IS NOT NULL)',[now-DAY],'UPDATE citizen_reports SET submission_id=NULL,request_hash=NULL'],
 ['suggestionRequests','citizen_suggestions','created<=? AND (submission_id IS NOT NULL OR request_hash IS NOT NULL)',[now-DAY],'UPDATE citizen_suggestions SET submission_id=NULL,request_hash=NULL'],
 ['guards','citizen_guards','created<=? AND expires<=?',[now-DAY,now],'DELETE FROM citizen_guards']
]:[
 ['reports','citizen_reports','created<=?',[now-REPORT_DELETE],'DELETE FROM citizen_reports'],
 ['managementHashes','citizen_reports','created<=? AND manage_hash IS NOT NULL',[now-REPORT_PUBLIC],'UPDATE citizen_reports SET manage_hash=NULL'],
 ['suggestions','citizen_suggestions','retention_review=0 AND (created<=? OR (first_resolved_at IS NOT NULL AND first_resolved_at<=?) OR (first_resolved_at IS NULL AND created<=?))',[now-210*DAY,now-30*DAY,now-180*DAY],'DELETE FROM citizen_suggestions'],
 ['adminLogs','citizen_admin_log','created<=?',[now-180*DAY],'DELETE FROM citizen_admin_log'],
 ['retentionLogs','citizen_retention_log','created<=?',[now-30*DAY],'DELETE FROM citizen_retention_log']
];
export async function retention(env,now=Date.now(),{security=false,execute=false,limit=100}={}){
 if(!local(env)||!env.DB)return {enabled:false,status:'disabled',deleted:0};
 if(!Number.isSafeInteger(now)||!Number.isInteger(limit)||limit<1||limit>500)throw Error('invalid_cleanup_options');
 // The scheduled/admin paths never pass this capability. Only an isolated test harness may.
 if(execute&&env.LOCAL_RETENTION_TEST_EXECUTION!=='isolated-test-only')return {enabled:false,status:'disabled',deleted:0};
 const result={enabled:execute,status:execute?'success':'dry_run',deleted:0,changed:0,categories:{}};
 for(const [name,table,where,args,operation]of specs(now,security)){
  const count=async()=>Number((await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).bind(...args).first()).n);
  let due=null,changed=0;
  try{
   due=await count();
   if(execute){const key=table==='citizen_guards'?'request_id':'id';const out=await env.DB.prepare(`${operation} WHERE ${where} AND ${key} IN (SELECT ${key} FROM ${table} WHERE ${where} ORDER BY ${key} LIMIT ?)`).bind(...args,...args,limit).run();changed=out.meta.changes;}
   result.categories[name]={due,changed,remaining:await count()};
  }catch{let remaining=null;try{remaining=await count();}catch{}result.status='partial_failure';result.categories[name]={due,changed,remaining,failed:true};}
  result.changed+=changed;if(operation.startsWith('DELETE'))result.deleted+=changed;
 }
 try{
  result.reviewRequired=Number((await env.DB.prepare('SELECT COUNT(*) AS n FROM citizen_suggestions WHERE retention_review=1').first()).n);
 }catch{
  result.reviewRequired=null;
  result.status='partial_failure';
 }
 const categories=Object.values(result.categories);
 const remaining=categories.some(c=>c.remaining===null)?-1:categories.reduce((sum,c)=>sum+c.remaining,0);
 result.remaining=remaining;
 if(execute){
  if(result.status==='success'&&remaining>0)result.status='pending';
  try{
   await env.DB.prepare('INSERT INTO citizen_retention_log(created,kind,status,deleted,changed,remaining) VALUES(?,?,?,?,?,?)').bind(now,security?'security':'general',result.status,result.deleted,result.changed,remaining).run();
  }catch{
   result.status='partial_failure';
   result.logFailed=true;
  }
 }
 return result;
}
