// stdin: getDoc JSON -> markdown (tutorial blocks + reference fields)
let d='';
const typeName=t=>typeof t==='string'?t:(t&&(t.title||t.fqdn||t.kind))||JSON.stringify(t).slice(0,60);
process.stdin.on('data',c=>d+=c).on('end',()=>{
  let j; try { j=JSON.parse(d); } catch { console.log('[PARSE-ERROR]'); return; }
  const out=[];
  const w=(b)=>{
    if(!b) return;
    if(Array.isArray(b)) return b.forEach(w);
    if(typeof b!=='object') return;
    switch(b.kind){
      case 'content_header': out.push('\n## '+(b.text||'')); break;
      case 'content_text': out.push(b.text||''); break;
      case 'content_alert': out.push('> ALERT: '+(b.text||'')); break;
      case 'content_source': out.push('```'+(b.language||'')+'\n'+(b.source||b.code||b.text||'')+'\n```'); break;
      case 'content_list': (b.items||b.content||[]).forEach(i=>{ if(typeof i==='string') out.push('- '+i); else { out.push('-'); w(i);} }); return;
      case 'content_table': { (b.rows||b.content||[]).forEach(r=>{ const cells=(r.cells||r.content||[]).map(c=>typeof c==='string'?c:(c.text||JSON.stringify(c).slice(0,200))); out.push('| '+cells.join(' | ')+' |'); }); return; }
      default: break;
    }
    for(const k of ['content','items','children','cells','rows']) if(b[k]) w(b[k]);
  };
  out.push('# '+(j.title||j.fqdn||'')+'  ('+(j.kind||'')+')');
  if(j.description) out.push(j.description);
  w(j.content);
  if(Array.isArray(j.params)&&j.params.length){ out.push('\n**Params:**'); j.params.forEach(p=>out.push('- `'+p.title+'` ['+(p.types||[]).map(typeName).join('|')+'] — '+(p.description||''))); }
  if(Array.isArray(j.returns)&&j.returns.length){ out.push('**Returns:** '+j.returns.map(typeName).join('|')); }
  for(const k of ['props','methods','events','members']) if(Array.isArray(j[k])&&j[k].length){ out.push('\n**'+k+':**'); j[k].forEach(m=>out.push('- '+(m.title||m.fqdn)+(m.description?' — '+m.description:''))); }
  const child=(c,d)=>{ out.push('\n'+'#'.repeat(Math.min(d,5))+' '+(c.title||c.fqdn)+'  ('+(c.kind||'')+')'); if(c.description) out.push(c.description); w(c.content); if(Array.isArray(c.params)&&c.params.length){ out.push('**Params:**'); c.params.forEach(p=>out.push('- `'+p.title+'` ['+(p.types||[]).map(typeName).join('|')+'] — '+(p.description||''))); } if(Array.isArray(c.returns)&&c.returns.length){ out.push('**Returns:** '+c.returns.map(typeName).join('|')); } (c.children||[]).forEach(g=>child(g,d+1)); };
  (j.children||[]).forEach(c=>child(c,2));
  console.log(out.join('\n\n'));
});
