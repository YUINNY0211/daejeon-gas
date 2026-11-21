// Shared by the local static builder and browser. No YAML execution or implicit values.
export const validNoticeSlug=value=>typeof value==='string'&&value!=='index'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)&&value.length<=80;
export function parseNotice(source,slug){
 if(!validNoticeSlug(slug))throw Error('Invalid notice filename');
 const text=String(source).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
 const match=/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/.exec(text);
 if(!match)throw Error('Notice requires title/date front matter');
 const meta={};
 for(const line of match[1].split('\n')){
  if(!line.trim())continue;
  const field=/^(title|date):\s*(.*?)\s*$/.exec(line);
  if(!field||Object.hasOwn(meta,field[1]))throw Error('Unknown or duplicate notice metadata');
  let value=field[2];
  if(value.startsWith('"')){try{value=JSON.parse(value);}catch{throw Error('Invalid quoted notice metadata');}}
  else if(value.startsWith("'")){if(!value.endsWith("'"))throw Error('Invalid quoted notice metadata');value=value.slice(1,-1).replaceAll("''", "'");}
  if(typeof value!=='string')throw Error('Notice metadata must be text');
  meta[field[1]]=value;
 }
 if(typeof meta.title!=='string'||!meta.title.trim()||meta.title.length>120||/[\u0000-\u001f\u007f]/.test(meta.title))throw Error('Notice title must be 1-120 characters');
 if(typeof meta.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(meta.date)||!Number.isFinite(Date.parse(meta.date+'T00:00:00Z'))||new Date(meta.date+'T00:00:00Z').toISOString().slice(0,10)!==meta.date)throw Error('Notice date must be a real YYYY-MM-DD date');
 return {slug,title:meta.title.trim(),date:meta.date,body:match[2],path:'/notice/'+slug,markdown:'/content/notices/'+slug+'.md'};
}
