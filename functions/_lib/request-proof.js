import {fail,hmac} from './security.js';
import {DAY} from './retention.js';
const keys={reports:['stationId','status','manageToken','clientId'],suggestions:['stationId','category','item','message','clientId'],manage:['reportId','manageToken','operation','status','clientId','revision']};
function payload(kind,b){if(!keys[kind])fail(400,'invalid_kind');return keys[kind].map(k=>b[k]??null);}
const input=(kind,b)=>JSON.stringify(['citizen-request-v2',kind,b.requestId,b.proof.issuedAt,b.proof.expiresAt,payload(kind,b)]);
export async function issueProof(env,kind,data,now){
 if(data.requestId!==undefined||data.proof!==undefined)fail(400,'server_request_id_required');
 payload(kind,data);
 const requestId=crypto.randomUUID(),proof={issuedAt:now,expiresAt:now+DAY};
 proof.signature=await hmac(env.ABUSE_HMAC_SECRET,input(kind,{...data,requestId,proof}));
 return {requestId,proof};
}
export async function verifyProof(env,kind,b,now){
 const p=b.proof;
 if(!p||!Number.isSafeInteger(p.issuedAt)||p.expiresAt!==p.issuedAt+DAY||typeof p.signature!=='string')fail(400,'request_confirmation_required');
 if(p.issuedAt>now||p.expiresAt<=now)fail(410,'request_expired');
 const expected=await hmac(env.ABUSE_HMAC_SECRET,input(kind,b));
 if(expected.length!==p.signature.length)fail(409,'request_conflict');
 let diff=0;for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^p.signature.charCodeAt(i);
 if(diff)fail(409,'request_conflict');
}
