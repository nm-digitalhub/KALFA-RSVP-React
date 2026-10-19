const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
// Pass the isolated measurement directory containing work/.next-before and work/.next-after.
const root=path.resolve(process.argv[2] || '.');
function extract(phase,runtime) {
  const html=fs.readFileSync(path.join(root,'work',`.next-${phase}`,'analyze',`${runtime}.html`),'utf8');
  const marker='window.chartData = ';
  const tail=html.slice(html.lastIndexOf(marker)+marker.length);
  const end=tail.indexOf(';\n');
  const chart=JSON.parse(tail.slice(0,end));
  fs.writeFileSync(path.join(root,`${phase}-${runtime}.json`),JSON.stringify(chart,null,2));
  return chart;
}
const routeEntries={
  '/admin':'app/(admin)/admin/page',
  '/admin/packages':'app/(admin)/admin/packages/page',
  '/admin/packages/new':'app/(admin)/admin/packages/new/page',
  '/admin/packages/[id]':'app/(admin)/admin/packages/[id]/page',
};
const shared=['main-app','app/layout','app/not-found','app/global-error','app/(admin)/admin/layout','app/(admin)/admin/error','app/(admin)/admin/loading'];
const data={units:'bytes',compression:{gzip:9,brotli:11},sharedEntries:shared,routeEntries,phases:{}};
for (const phase of ['before','after']) {
  const chart=extract(phase,'client'), server=extract(phase,'nodejs');
  const dist=path.join(root,'work',`.next-${phase}`);
  const metrics=new Map();
  function measure(file) {
    if(!metrics.has(file)) {
      const source=fs.readFileSync(path.join(dist,file));
      metrics.set(file,{file,raw:source.length,gzip:zlib.gzipSync(source,{level:9}).length,brotli:zlib.brotliCompressSync(source,{params:{[zlib.constants.BROTLI_PARAM_QUALITY]:11}}).length});
    }
    return metrics.get(file);
  }
  const routes={};
  for(const [route,entry] of Object.entries(routeEntries)) {
    const entries=new Set([...shared,entry]);
    const files=[...new Set(chart.filter(c=>Object.entries(c.isInitialByEntrypoint).some(([k,v])=>v&&entries.has(k))).map(c=>c.label))].sort();
    const assets=files.map(measure);
    routes[route]={raw:assets.reduce((a,b)=>a+b.raw,0),gzip:assets.reduce((a,b)=>a+b.gzip,0),brotli:assets.reduce((a,b)=>a+b.brotli,0),assets};
  }
  const casl=[];
  function visit(n,asset,runtime,inside=false) {
    const match=/\/@(?:casl|ucast)\//.test(n.path||'');
    if(match&&!inside) casl.push({runtime,asset,...Object.fromEntries(Object.entries(n).filter(([k])=>k!=='groups'))});
    for(const c of n.groups||[])visit(c,asset,runtime,inside||match);
  }
  for(const c of chart)visit(c,c.label,'client');
  for(const c of server)visit(c,c.label,'nodejs');
  data.phases[phase]={routes,casl};
}
data.delta={};
for(const route of Object.keys(routeEntries)) {
  const before=data.phases.before.routes[route],after=data.phases.after.routes[route];
  data.delta[route]=Object.fromEntries(['raw','gzip','brotli'].map(k=>[k,after[k]-before[k]]));
}
fs.writeFileSync(path.join(root,'size-results.json'),JSON.stringify(data,null,2));
console.log(JSON.stringify({delta:data.delta,libraries:{before:data.phases.before.casl,after:data.phases.after.casl}},null,2));
