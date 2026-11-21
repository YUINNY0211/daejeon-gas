import {fail} from './security.js';
export async function digest(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export function managementMutation(db,b,now){
 if(!['cancel','change'].includes(b.operation)||(b.operation==='change'&&!['received','not_received'].includes(b.status)))fail(400,'invalid_status');
 if(!Number.isSafeInteger(b.revision)||b.revision<0)fail(400,'invalid_revision');
 const where=' WHERE id=? AND manage_hash=? AND revision=? AND created>? AND withdrawn=0';
 return b.operation==='cancel'?db.prepare('UPDATE citizen_reports SET withdrawn=1,updated=?,revision=revision+1'+where).bind(now,b.reportId,b.manageHash,b.revision,now-90*86400000):db.prepare('UPDATE citizen_reports SET status=?,updated=?,revision=revision+1'+where).bind(b.status,now,b.reportId,b.manageHash,b.revision,now-90*86400000);
}

