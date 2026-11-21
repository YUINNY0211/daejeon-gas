// Local Markdown presentation only. Manuscripts cannot inject HTML, scripts or automatic remote images.
const manuscripts=new Set(['about','notice','sources','privacy','terms','contact'].map(name=>'/content/'+name+'.md'));
const element=(doc,tag,text)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
function safeLink(raw,base){
 try{const url=new URL(raw,base);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
function inline(doc,parent,text,base){
 const pattern=/!\[([^\]]*)\]\([^)]*\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^\s)]+)\)/g;
 let offset=0;
 for(const m of text.matchAll(pattern)){
  if(m.index>offset)parent.appendChild(doc.createTextNode(text.slice(offset,m.index)));
  if(m[1]!==undefined)parent.appendChild(doc.createTextNode(m[1]));
  else if(m[2]!==undefined)parent.appendChild(element(doc,'code',m[2]));
  else if(m[3]!==undefined)parent.appendChild(element(doc,'strong',m[3]));
  else if(m[4]!==undefined)parent.appendChild(element(doc,'em',m[4]));
  else{const href=safeLink(m[6],base);if(href){const a=element(doc,'a',m[5]);a.setAttribute('href',href);a.setAttribute('rel','noopener noreferrer');parent.appendChild(a);}else parent.appendChild(doc.createTextNode(m[5]));}
  offset=m.index+m[0].length;
 }
 if(offset<text.length)parent.appendChild(doc.createTextNode(text.slice(offset)));
}
const cells=line=>line.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(v=>v.trim());
const tableRule=line=>line.includes('|')&&cells(line).every(c=>/^:?-{3,}:?$/.test(c));
export function markdownFragment(markdown,doc,base){
 const fragment=doc.createDocumentFragment(),lines=String(markdown).replace(/\r\n?/g,'\n').split('\n');let i=0;
 while(i<lines.length){
  const line=lines[i];if(!line.trim()){i++;continue;}
  if(/^\s*```/.test(line)){
   const code=[];i++;while(i<lines.length&&!/^\s*```/.test(lines[i]))code.push(lines[i++]);if(i<lines.length)i++;
   const pre=element(doc,'pre');pre.appendChild(element(doc,'code',code.join('\n')));fragment.appendChild(pre);continue;
  }
  const heading=/^(#{1,6})\s+(.+)$/.exec(line);
  if(heading){const h=element(doc,'h'+heading[1].length);inline(doc,h,heading[2],base);fragment.appendChild(h);i++;continue;}
  if(/^\s*(?:---+|\*\*\*+)\s*$/.test(line)){fragment.appendChild(element(doc,'hr'));i++;continue;}
  if(i+1<lines.length&&line.includes('|')&&tableRule(lines[i+1])){
   const wrap=element(doc,'div');wrap.className='table-scroll';const table=element(doc,'table'),head=element(doc,'thead'),row=element(doc,'tr');
   for(const text of cells(line)){const th=element(doc,'th');th.setAttribute('scope','col');inline(doc,th,text,base);row.appendChild(th);}head.appendChild(row);table.appendChild(head);
   const body=element(doc,'tbody');i+=2;
   while(i<lines.length&&lines[i].trim()&&lines[i].includes('|')){const tr=element(doc,'tr');for(const text of cells(lines[i++])){const td=element(doc,'td');inline(doc,td,text,base);tr.appendChild(td);}body.appendChild(tr);}
   table.appendChild(body);wrap.appendChild(table);fragment.appendChild(wrap);continue;
  }
  const list=/^\s*(?:([-+*])|\d+\.)\s+(.+)$/.exec(line);
  if(list){const ordered=!list[1],node=element(doc,ordered?'ol':'ul');
   while(i<lines.length){const item=/^\s*(?:([-+*])|\d+\.)\s+(.+)$/.exec(lines[i]);if(!item||!item[1]!==ordered)break;const li=element(doc,'li');inline(doc,li,item[2],base);node.appendChild(li);i++;}
   fragment.appendChild(node);continue;
  }
  if(/^>\s?/.test(line)){const q=element(doc,'blockquote');inline(doc,q,line.replace(/^>\s?/,''),base);fragment.appendChild(q);i++;continue;}
  const paragraph=[line];i++;
  while(i<lines.length&&lines[i].trim()&&!/^(?:#{1,6}\s|\s*```|>\s?|\s*[-+*]\s|\s*\d+\.\s)/.test(lines[i])&&!(i+1<lines.length&&tableRule(lines[i+1]))){paragraph.push(lines[i++]);}
  const p=element(doc,'p');inline(doc,p,paragraph.join('\n'),base);fragment.appendChild(p);
 }
 return fragment;
}
export async function loadManuscript({body,status,document:doc,location,fetch:fetcher}){
 const url=new URL(body.dataset.markdown,location.href);
 const noticeMatch=/^\/content\/notices\/([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/.exec(url.pathname);
 if(url.origin!==location.origin||(!manuscripts.has(url.pathname)&&!noticeMatch)||url.search||url.hash)throw Error('Unapproved manuscript path');
 try{
  const response=await fetcher(url.href,{cache:'no-store',credentials:'same-origin'});if(!response.ok)throw Error('Manuscript unavailable');
  let text=await response.text();if(noticeMatch){const {parseNotice}=await import('./notice-format.js');text=parseNotice(text,noticeMatch[1]).body;}
  body.replaceChildren(markdownFragment(text,doc,location.href));status.textContent='';status.hidden=true;
 }catch{status.textContent='원고를 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.';status.hidden=false;}
}
if(typeof document!=='undefined'){
 const body=document.getElementById('pageBody'),status=document.getElementById('contentStatus');
 if(body&&status)loadManuscript({body,status,document,location:window.location,fetch:window.fetch.bind(window)}).catch(()=>{status.textContent='원고 경로를 확인할 수 없습니다.';status.hidden=false;});
}
