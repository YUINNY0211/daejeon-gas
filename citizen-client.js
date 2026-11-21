window.Citizen=(()=>{
 let configPromise,scriptPromise,memoryClient=null;const memoryPending=new Map(),issuing=new Map();
 const randomToken=()=>[...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('');
 function read(key){try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}}
 function write(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true}catch{return false}}
 const DAY=86400000;
 function cleanClient(){
  const saved=read('citizenClientId')||memoryClient;
  if(typeof saved==='string'&&/^[a-f0-9]{64}$/.test(saved)){
   const migrated={id:saved,expiresAt:Date.now()+DAY};
   memoryClient=migrated;write('citizenClientId',migrated);return migrated;
  }
  if(saved&&/^[a-f0-9]{64}$/.test(saved.id||'')&&Number.isFinite(saved.expiresAt)&&saved.expiresAt>Date.now())return saved;
  memoryClient=null;
  try{localStorage.removeItem('citizenClientId')}catch{}
  return null;
 }
 function clientId(){
  const saved=cleanClient();
  if(saved)return saved.id;
  memoryClient={id:randomToken(),expiresAt:Date.now()+DAY};
  write('citizenClientId',memoryClient);
  return memoryClient.id;
 }
 async function call(path,options){let r;try{r=await fetch('/api/citizen/'+path,{cache:'no-store',credentials:'same-origin',...options});}catch{throw Error(options?.method==='POST'?'request_uncertain':'service_unavailable');}let data;try{data=await r.json()}catch{throw Error(options?.method==='POST'?'request_uncertain':'service_unavailable')}if(!r.ok)throw Error(data.error||'service_unavailable');return data;}
 const config=()=>configPromise??=call('config').then(c=>{const el=document.getElementById('localPreviewNotice');if(el&&c.localPreview)el.hidden=false;return c}).catch(e=>{configPromise=null;throw e});
 async function token(action,container){
  const c=await config();if(!c.enabled||!c.siteKey)throw Error('not_enabled');
  if(c.localPreview&&/^http:\/\/127\.0\.0\.1:\d+$/.test(location.origin))return 'local-preview-token';
  if(!window.turnstile)await(scriptPromise??=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';s.onload=resolve;s.onerror=()=>{scriptPromise=null;reject(Error('verification_unavailable'))};document.head.append(s)}));
  return new Promise((resolve,reject)=>{const host=document.createElement('div');container.append(host);let widget;const timer=setTimeout(()=>end(null),120000);function end(value){clearTimeout(timer);if(widget!==undefined)window.turnstile.remove(widget);host.remove();value?resolve(value):reject(Error('verification_failed'));}widget=window.turnstile.render(host,{sitekey:c.siteKey,action,appearance:'interaction-only',callback:v=>end(v),'error-callback':()=>end(null),'expired-callback':()=>end(null)});});
 }
 async function rememberReport(data,result){if(!result.reportId||!data.manageToken)return;const owners=read('citizenReportKeys')||{};owners[result.reportId]={manageToken:data.manageToken,stationId:result.stationId??data.stationId,status:result.status??data.status,savedAt:Date.now(),created:result.created,manageExpiresAt:result.manageExpiresAt,revision:result.revision};write('citizenReportKeys',owners);}
 const post=(path,data)=>call(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 const recovery=p=>{
  if(!/^[a-f0-9]{64}$/.test(p.manageToken||''))return;
  const key='citizenRecovery:'+p.manageToken;
  const previous=read(key)||memoryPending.get(key);
  const expiresAt=Number.isFinite(p.proof?.expiresAt)?p.proof.expiresAt+90*DAY:
   Number.isFinite(previous?.expiresAt)?previous.expiresAt:Date.now()+90*DAY;
  if(expiresAt<=Date.now()){forget(key);return;}
  const value={manageToken:p.manageToken,expiresAt};
  memoryPending.set(key,value);write(key,value);
 };
 const storageKeys=()=>{let keys=[];try{keys=Object.keys(localStorage);}catch{}return [...new Set([...keys,...memoryPending.keys()])];};
 const forget=key=>{memoryPending.delete(key);try{localStorage.removeItem(key)}catch{}};
 async function status(data){return post('management-status',{...(data.reportId?{reportId:data.reportId}:{}),manageToken:data.manageToken});}
 async function syncOwnership(){
  cleanClient();
  // Visit only our own expired pending records. No background submission is performed.
  try{for(const key of storageKeys()){
   if(!key.startsWith('citizenPending:'))continue;const p=read(key)||memoryPending.get(key);
   if(p&&(!p.proof||p.proof.expiresAt<=Date.now())){
    if(key.startsWith('citizenPending:reports:')&&p.manageToken)recovery(p);
    forget(key);
   }
  }}catch{}
  const stored=read('citizenReportKeys');
   const owners=stored&&typeof stored==='object'&&!Array.isArray(stored)?stored:{};
   for(const [id,r] of Object.entries(owners)){
    if(!/^\d+$/.test(id)||!r||!/^[a-f0-9]{64}$/.test(r.manageToken||'')||(Number.isFinite(r.manageExpiresAt)&&r.manageExpiresAt<=Date.now()))delete owners[id];
   }
   write('citizenReportKeys',owners);
   await Promise.all(Object.entries(owners).map(async([id,r])=>{try{const info=await status({reportId:Number(id),manageToken:r.manageToken});if(info.withdrawn)delete owners[id];else owners[id]={...r,...info};}catch(e){if(['management_expired','not_found'].includes(e.message))delete owners[id];}}));try{for(const key of storageKeys()){
   if(!key.startsWith('citizenRecovery:'))continue;
   const r=read(key)||memoryPending.get(key);
   if(!r||!/^[a-f0-9]{64}$/.test(r.manageToken||'')){forget(key);continue;}
   if(!Number.isFinite(r.expiresAt)){
    r.expiresAt=Date.now()+90*DAY;
    memoryPending.set(key,r);write(key,r);
   }
   if(r.expiresAt<=Date.now()){forget(key);continue;}
   try{const info=await status(r);if(!info.withdrawn)owners[info.reportId]={...info,manageToken:r.manageToken,savedAt:Date.now()};forget(key);}
   catch(e){if(['management_expired','not_found'].includes(e.message))forget(key);}
  }}catch{}
  write('citizenReportKeys',owners);return owners;}
 return {config,syncOwnership,list:({stationId,before,limit=5}={})=>call('reports?'+new URLSearchParams({limit,...(stationId?{stationId}:{}),...(before?{before}:{})})),
 async send(kind,data,container){
  const key='citizenPending:'+kind+':'+JSON.stringify(data);
  let pending=read(key)||memoryPending.get(key);
  // A user click may recover a result, but never automatically re-submit an old unsigned/expired request.
  if(pending&&(!pending.proof||pending.proof.expiresAt<=Date.now())){
   if(kind==='reports'&&pending.manageToken){
    try{const info=await status(pending);if(!info.withdrawn){await rememberReport(pending,info);forget(key);return {...info,manageToken:pending.manageToken};}}
    catch(e){if(!['not_found','management_expired'].includes(e.message))throw e;}
    recovery(pending);
   }
   forget(key);throw Error('request_confirmation_required');
  }
  if(!pending){
   if(!issuing.has(key))issuing.set(key,(async()=>{
    const value={...data,clientId:clientId(),...(kind==='reports'?{manageToken:randomToken()}:{})};
    if(kind==='manage'){const info=await status(data);if(value.revision===undefined)value.revision=info.revision;}
    const issued=await post('request',{kind,data:value});
    const ready={...value,...issued};memoryPending.set(key,ready);write(key,ready);return ready;
   })());
   try{pending=await issuing.get(key);}finally{issuing.delete(key);}
  }
  const turnstileToken=await token(kind,container);
  let result;try{result=await post(kind,{...pending,turnstileToken});}catch(e){
   if(['not_found','management_expired'].includes(e.message)&&kind==='manage'){const owners=read('citizenReportKeys')||{};delete owners[data.reportId];write('citizenReportKeys',owners);forget(key);}
   // Preserve uncertain submissions and their only management key on transport errors.
   if(['request_expired','revision_conflict'].includes(e.message)){if(kind==='reports')recovery(pending);forget(key);}
   throw e;
  }
  if(!result.ok||kind==='reports'&&!Number.isSafeInteger(result.reportId))throw Error('request_uncertain');
  if(kind==='reports')await rememberReport(pending,result);
  forget(key);
  return {...result,...(kind==='reports'?{manageToken:pending.manageToken}:{})};
 },
 time(raw){const m=/^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})\+09:00$/.exec(raw||'');return m?m[1]+'.'+m[2]+' '+m[3]+':'+m[4]:'';}
 };
})();

