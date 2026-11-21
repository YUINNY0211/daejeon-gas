// 운영자 문의 화면의 이메일 복사 기능. 외부 요청 없이 화면에 표시된 주소 텍스트만 복사합니다.
export const COPY_DONE='이메일 주소를 복사했어요.';
export const COPY_FAILED='복사하지 못했어요. 주소를 직접 선택해 복사해 주세요.';
export async function copyText(text,{navigator:nav,document:doc}={}){
 try{if(nav&&nav.clipboard&&typeof nav.clipboard.writeText==='function'){await nav.clipboard.writeText(text);return true;}}catch{}
 try{
  if(!doc||typeof doc.execCommand!=='function')return false;
  const area=doc.createElement('textarea');area.value=text;area.setAttribute('readonly','');area.style.position='fixed';area.style.opacity='0';
  doc.body.appendChild(area);area.select();const ok=doc.execCommand('copy');area.remove();return Boolean(ok);
 }catch{return false;}
}
export function setupContact(doc,nav){
 const button=doc.getElementById('copyMail'),mail=doc.getElementById('contactMail'),status=doc.getElementById('copyStatus');
 if(!button||!mail||!status)return false;
 button.addEventListener('click',async()=>{
  const address=mail.textContent.trim();
  const ok=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)&&await copyText(address,{navigator:nav,document:doc});
  status.textContent=ok?COPY_DONE:COPY_FAILED;status.hidden=false;
 });
 return true;
}
if(typeof document!=='undefined')setupContact(document,typeof navigator!=='undefined'?navigator:undefined);
