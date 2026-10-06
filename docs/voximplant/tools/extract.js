// stdin: getDoc JSON -> markdown (tutorial blocks + reference fields)
//
// NOTE on references.httpapi.* pages: their `title` and `description` are NOT
// strings but objects keyed by language binding — {curl, nodejs, php, java,
// csharp, go, python}. `curl` carries the raw HTTP name (the method name and
// the snake_case parameter name), which is what a Management API reader wants.
// Before this was handled, every Management API page rendered as a wall of
// "[object Object]" and the corpus's coverage of that section was written
// around the gap. Resolve language objects everywhere a label or prose is read.
let d='';
const str=v=>{
  if(v==null) return '';
  if(typeof v==='string') return v;
  if(typeof v!=='object') return String(v);
  for(const k of ['curl','en','text','value']) if(typeof v[k]==='string') return v[k];
  for(const k of Object.keys(v)) if(typeof v[k]==='string') return v[k];
  return '';
};
const label=n=>str(n&&n.title)||str(n&&n.fqdn)||'';
// api_field nodes carry required/type in `attributes`.
const attrs=n=>{
  const a=n&&n.attributes; if(!a||typeof a!=='object') return '';
  const bits=[];
  const t=str(a.type); if(t) bits.push(t);
  if(a.required===true||a.required==='true') bits.push('REQUIRED'); else bits.push('optional');
  return bits.length?' ['+bits.join(', ')+']':'';
};
const typeName=t=>typeof t==='string'?t:(t&&(label(t)||t.kind))||JSON.stringify(t).slice(0,60);
process.stdin.on('data',c=>d+=c).on('end',()=>{
  let j; try { j=JSON.parse(d); } catch { console.log('[PARSE-ERROR]'); return; }
  const out=[];
  const w=(b)=>{
    if(!b) return;
    if(Array.isArray(b)) return b.forEach(w);
    if(typeof b!=='object') return;
    switch(b.kind){
      case 'content_header': out.push('\n## '+str(b.text)); break;
      case 'content_text': out.push(str(b.text)); break;
      case 'content_alert': out.push('> ALERT: '+(str(b.title)?str(b.title)+' — ':'')+str(b.description||b.text)); break;
      case 'content_source': out.push('```'+(b.language||'')+'\n'+(b.source||b.code||b.text||'')+'\n```'); break;
      case 'content_list': (b.items||b.content||[]).forEach(i=>{ if(typeof i==='string') out.push('- '+i); else { out.push('-'); w(i);} }); return;
      case 'content_table': { (b.rows||b.content||[]).forEach(r=>{ const cells=(r.cells||r.content||[]).map(c=>typeof c==='string'?c:(c.text||JSON.stringify(c).slice(0,200))); out.push('| '+cells.join(' | ')+' |'); }); return; }
      default: break;
    }
    for(const k of ['content','items','children','cells','rows']) if(b[k]) w(b[k]);
  };
  out.push('# '+label(j)+'  ('+(j.kind||'')+')');
  if(j.description) out.push(str(j.description));
  w(j.content);
  if(Array.isArray(j.params)&&j.params.length){ out.push('\n**Params:**'); j.params.forEach(p=>out.push('- `'+label(p)+'` ['+(p.types||[]).map(typeName).join('|')+'] — '+str(p.description))); }
  if(Array.isArray(j.returns)&&j.returns.length){ out.push('**Returns:** '+j.returns.map(typeName).join('|')); }
  for(const k of ['props','methods','events','members']) if(Array.isArray(j[k])&&j[k].length){ out.push('\n**'+k+':**'); j[k].forEach(m=>out.push('- '+label(m)+(m.description?' — '+str(m.description):''))); }
  const child=(c,d)=>{
    // api_field children are parameters of their parent api_method — render them
    // as a flat parameter list, not as ever-deeper headings.
    if(c.kind==='api_field'){ out.push('- `'+label(c)+'`'+attrs(c)+' — '+str(c.description)); return; }
    out.push('\n'+'#'.repeat(Math.min(d,5))+' '+label(c)+'  ('+(c.kind||'')+')');
    if(c.description) out.push(str(c.description));
    if(Array.isArray(c.roles)&&c.roles.length) out.push('_roles: '+c.roles.map(str).join(', ')+'_');
    w(c.content);
    if(Array.isArray(c.params)&&c.params.length){ out.push('**Params:**'); c.params.forEach(p=>out.push('- `'+label(p)+'` ['+(p.types||[]).map(typeName).join('|')+'] — '+str(p.description))); }
    if(Array.isArray(c.returns)&&c.returns.length){ out.push('**Returns:** '+c.returns.map(typeName).join('|')); }
    if(c.responseData) out.push('**Returns:** '+str(c.responseData));
    (c.children||[]).forEach(g=>child(g,d+1));
  };
  (j.children||[]).forEach(c=>child(c,2));
  console.log(out.join('\n\n'));
});
