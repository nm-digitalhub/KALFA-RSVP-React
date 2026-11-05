import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import * as heModule from 'he';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { toString } from 'mdast-util-to-string';
import { extract } from './cloud-parser.mjs';
const he = heModule.default ?? heModule;
const base = fileURLToPath(new URL('../', import.meta.url));
export const output = resolve(base, '../src/lib/whatsapp/generated/error-codes.ts');
// Documented by Meta on the Direct Send "Supported message types" page, as prose rather
// than a table, and that page is not one of the source snapshots. Listed so the manifest
// does not claim full coverage. Move a code out of here when its source is added.
const unverifiedExcludedCodes = [138000, 138018];
const sourceUrl = {
 cloud: 'https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes',
 graph: 'https://developers.facebook.com/docs/graph-api/guides/error-handling/',
 marketing: 'https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/send-marketing-messages',
};
export async function build() {
 const cloudText = await readFile(resolve(base,'../docs/whatsapp-errors/error-codes.md'),'utf8');
 const marketingText = await readFile(resolve(base,'../docs/whatsapp-errors/send-marketing-messages.md'),'utf8');
 const graphText = await readFile(resolve(base,'../docs/whatsapp-errors/graph-errors.json'),'utf8');
 const cloud = extract(cloudText);
 const graph = JSON.parse(graphText);
 const entries = cloud.entries.map(e => ({...e, source: 'cloud-catalog', sourceFile:'docs/whatsapp-errors/error-codes.md', sourceUrl:sourceUrl.cloud, type:null, context:null}));
 const graphEntries = graph.errors.map(e => ({
   api:'graph', section:'Error Codes', sourceLine:null, kind:e.min == null ? 'exact':'range',
   code:e.code ?? null, min:e.min ?? null, max:e.max ?? null, title:e.name,
   message:null, description:e.name, solution:e.recovery, httpStatus:null,httpStatusText:null,links:[],
   source:'graph-guide',sourceFile:'docs/whatsapp-errors/graph-errors.json',sourceUrl:sourceUrl.graph,type:null,context:null,
 }));
 entries.push(...graphEntries);
 const tree = unified().use(remarkParse).use(remarkGfm).parse(marketingText);
 let errorBlocks=0;
 const lines = marketingText.split('\n');
 for (const node of tree.children) {
   if (node.type !== 'code' || node.lang !== 'json') continue;
   let parsed;
   try { parsed=JSON.parse(he.decode(node.value)); } catch { continue; }
   if (!parsed.error) continue;
   const e=parsed.error;
   if (!Number.isSafeInteger(e.code)) throw new Error('Invalid marketing error code');
   errorBlocks++;
   let start=node.position.start.line-2;
   while(start>=0 && !/^#{2,4} /.test(lines[start])) start--;
   let end=node.position.end.line;
   while(end<lines.length && !/^#{2,4} /.test(lines[end])) end++;
   entries.push({
    api:e.code===131063?'cloud':'marketing', section:start>=0?lines[start].replace(/^#+ /,''):'Example',
    sourceLine:node.position.start.line,kind:'exact',code:e.code,min:null,max:null,title:null,
    message:e.message ?? null,description:e.error_data?.details ?? e.message ?? '',
    solution:null,httpStatus:null,httpStatusText:null,links:[],source:'marketing-guide',
    sourceFile:'docs/whatsapp-errors/send-marketing-messages.md',sourceUrl:sourceUrl.marketing,type:e.type ?? null,
    context:he.decode(lines.slice(Math.max(0,start),end).join('\n')),
   });
 }
 if(errorBlocks!==3) throw new Error(`Marketing source changed: expected 3 error examples, found ${errorBlocks}. Review parser and tests.`);

 const pricingText = await readFile(new URL('../../docs/whatsapp-errors/pricing.md', import.meta.url),'utf8');
 const pricingTree = unified().use(remarkParse).use(remarkGfm).parse(pricingText);
 let active=false;
 const pricingEntries=[];
 const txt=n=>he.decode(toString(n)).replace(/<br\s*\/?\s*>/gi,'\n').trim();
 for(const n of pricingTree.children){
  if(n.type==='heading' && n.depth===2){
   active=txt(n)==='Error codes';continue;
  }
  if(!active || n.type!=='table')continue;
  const [h,...rows]=n.children;
  if(h.children.map(txt).join('|')!=='Code|Message|Possible reasons and solutions')
   throw Error('Unexpected pricing columns');
  for(const row of rows){
   if(row.children.length!==3)throw Error('Unexpected pricing cells');
   const [raw,message,solution]=row.children.map(txt);
   if(!/^\d+$/.test(raw))throw Error('Invalid pricing code');
   const code=Number(raw),links=[];
   function walk(n){
    if(n.type==='link')links.push({text:txt(n),url:n.url});
    for(const c of n.children??[])walk(c);
   }
   walk(row);
   pricingEntries.push({
    api:code===131061?'cloud':'marketing',
    section:'Error codes',sourceLine:row.position.start.line,
    kind:'exact',code,min:null,max:null,title:null,
    message,description:message,solution,
    httpStatus:null,httpStatusText:null,links,
    source:'pricing-guide',
    sourceFile:'docs/whatsapp-errors/pricing.md',
    sourceUrl:'https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/pricing/',
    type:null,context:solution
   });
  }
 }
 if(JSON.stringify(pricingEntries.map(e=>e.code).sort((a,b)=>a-b))!=='[100,131061,131065]')
  throw Error('Unexpected pricing code list');
 entries.push(...pricingEntries);

 const directText = await readFile(new URL('../../docs/whatsapp-errors/api-reference.md',import.meta.url),'utf8');
 const directTree = unified().use(remarkParse).use(remarkGfm).parse(directText);
 let directActive=false;
 const directEntries=[];
 const directTxt=n=>he.decode(toString(n)).replace(/<br\s*\/?\s*>/gi,'\n').trim();
 for(const n of directTree.children){
  if(n.type==='heading' && n.depth===2){
   directActive=directTxt(n)==='Error codes';continue;
  }
  if(!directActive || n.type!=='table')continue;
  const [header,...rows]=n.children;
  if(header.children.map(directTxt).join('|')!=='Error code|Description')
   throw Error('Unexpected Direct Send columns');
  for(const row of rows){
   if(row.children.length!==2)throw Error('Unexpected Direct Send cells');
   const [raw,description]=row.children.map(directTxt);
   if(!/^\d+$/.test(raw))throw Error('Invalid Direct Send code');
   const links=[];
   function walk(n){
    if(n.type==='link')links.push({text:directTxt(n),url:n.url});
    for(const c of n.children??[])walk(c);
   }
   walk(row);
   directEntries.push({
    api:'direct-send',section:'Error codes',
    sourceLine:row.position.start.line,kind:'exact',
    code:Number(raw),min:null,max:null,title:null,message:null,
    description,solution:null,httpStatus:null,httpStatusText:null,
    links,source:'direct-send-guide',
    sourceFile:'docs/whatsapp-errors/api-reference.md',
    sourceUrl:'https://developers.facebook.com/documentation/business-messaging/whatsapp/direct-send/api-reference',
    type:null,context:description
   });
  }
 }
 const directCodes=[...new Set(directEntries.map(e=>e.code))].sort((a,b)=>a-b);
 if(directEntries.length!==12 ||
    JSON.stringify(directCodes)!=='[100,131000,131062,131064,132015,132021,139200,2388318,2388330]')
  throw Error('Direct Send source changed; review expected rows and codes');
 entries.push(...directEntries);
 const knownCodes=[...new Set(entries.filter(e=>e.kind==='exact').map(e=>e.code))].sort((a,b)=>a-b);
 const nowCatalogued=unverifiedExcludedCodes.filter(c=>knownCodes.includes(c));
 if(nowCatalogued.length) throw new Error(`Listed as excluded but present in the catalog: ${nowCatalogued.join(', ')}`);
 const manifest={sources:[['error-codes.md',cloudText],['send-marketing-messages.md',marketingText],['graph-errors.json',graphText],['pricing.md',pricingText],['api-reference.md',directText]].map(([file,text])=>({file,sha256:createHash('sha256').update(text).digest('hex')})),cloudRows:cloud.sourceRows,entries:entries.length,exactCodes:knownCodes.length,authenticationSubcodes:graph.subcodes.length,unverifiedExcludedCodes,directSendCoverage:'provided api-reference.md snapshot'};
 return {entries,knownCodes,subcodes:graph.subcodes,typeRules:graph.typeRules,manifest};
}
export function render(data) {
 return `// Generated. Do not edit.\n// Run: node scripts/whatsapp-errors/generate.mjs\n
export interface WhatsAppErrorDefinition {
 readonly api: 'cloud' | 'marketing' | 'graph' | 'direct-send';
 readonly source: string;
 readonly sourceFile: string;
 readonly sourceUrl: string;
 readonly section: string;
 readonly sourceLine: number | null;
 readonly kind: 'exact' | 'range';
 readonly code: number | null;
 readonly min: number | null;
 readonly max: number | null;
 readonly title: string | null;
 readonly message: string | null;
 readonly description: string;
 readonly solution: string | null;
 readonly type: string | null;
 readonly context: string | null;
 readonly httpStatus: number | null;
 readonly httpStatusText: string | null;
 readonly links: readonly {readonly text:string;readonly url:string}[];
}
export const generationManifest = ${JSON.stringify(data.manifest,null,2)} as const;
export const whatsappErrorCodes = ${JSON.stringify(data.knownCodes)} as const;
export type WhatsAppKnownErrorCode = typeof whatsappErrorCodes[number];
export const whatsappErrors: readonly WhatsAppErrorDefinition[] = ${JSON.stringify(data.entries,null,2)};
export const graphAuthenticationSubcodes = ${JSON.stringify(data.subcodes,null,2)} as const;
export type GraphAuthenticationSubcode = typeof graphAuthenticationSubcodes[number]['code'];
export const graphErrorTypeRules = ${JSON.stringify(data.typeRules,null,2)} as const;
export function isKnownWhatsAppErrorCode(code: number): code is WhatsAppKnownErrorCode {
 return (whatsappErrorCodes as readonly number[]).includes(code);
}
export function lookupWhatsAppErrors(code: number, api: 'cloud' | 'marketing' | 'graph' | 'direct-send' = 'cloud'): readonly WhatsAppErrorDefinition[] {
 if (!Number.isSafeInteger(code) || code < 0) return [];
 const allowed = api==='direct-send' ? ['direct-send','cloud','graph'] : api==='marketing' ? ['cloud','marketing','graph'] : api==='cloud' ? ['cloud','graph'] : ['graph'];
 const applicable=whatsappErrors.filter(e=>allowed.includes(e.api));
 const exact=applicable.filter(e=>e.kind==='exact' && e.code===code);
 if(exact.length) return exact;
 return applicable.filter(e=>e.kind==='range' && e.min!==null && e.max!==null && code>=e.min && code<=e.max);
}
export function lookupGraphAuthenticationSubcode(code: number) {
 return graphAuthenticationSubcodes.find(e=>e.code===code);
}
`;
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
 try {
 const args=process.argv.slice(2);
 if(args.some(a=>a!=='--check')) throw new Error('Usage: node scripts/generate.mjs [--check]');
 const data=await build(); const text=render(data);
 if(args.includes('--check')) {
   if(await readFile(output,'utf8')!==text) throw new Error('Generated output is stale. Run: node scripts/whatsapp-errors/generate.mjs');
 } else {await mkdir(dirname(output),{recursive:true});await writeFile(output,text);}
 console.log('[OK]',JSON.stringify(data.manifest));
 } catch(e) {console.error('[X]',e.message);process.exitCode=1;}
}
