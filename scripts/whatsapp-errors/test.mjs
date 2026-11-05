import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { build, render } from './generate.mjs';
const data=await build();
const js=ts.transpileModule(render(data),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const m=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
test('source completeness',()=>{
 assert.equal(data.manifest.cloudRows,94);
 assert.equal(data.entries.length,126);
 assert.equal(data.knownCodes.length,96);
 assert.equal(data.subcodes.length,7);
 assert.equal(data.entries.filter(e=>e.source==='cloud-catalog'&&e.code===2388103).length,9);
 for(const c of [2388091,2388093,0,17,341,102,506,1609005,131062]) assert.ok(data.knownCodes.includes(c));
 for(const c of [458,459,460,463,464,467,492]) assert.ok(!data.knownCodes.includes(c));
});
test('the manifest names the documented codes left out of the catalog',()=>{
 assert.deepEqual(data.manifest.unverifiedExcludedCodes,[138000,138018]);
 for(const c of data.manifest.unverifiedExcludedCodes){
  assert.ok(!data.knownCodes.includes(c));
  assert.equal(m.lookupWhatsAppErrors(c,'direct-send').length,0);
 }
});
test('marketing examples and narrative preserved',()=>{
 const e=data.entries.find(e=>e.source==='marketing-guide'&&e.code===131062);
 assert.equal(e.type,'OAuthException');
 assert.ok(e.context.includes('authentication template'));
 assert.ok(e.description.includes('bid_spec'));
 assert.equal(data.entries.filter(e=>e.source==='marketing-guide').length,3);
});
test('lookup preserves conflicts and scopes',()=>{
 assert.equal(m.lookupWhatsAppErrors(2388103).length,9);
 assert.equal(m.lookupWhatsAppErrors(200)[0].kind,'exact');
 assert.equal(m.lookupWhatsAppErrors(201).length,2);
 assert.equal(m.lookupWhatsAppErrors(100,'marketing').length,4);
 assert.equal(m.lookupWhatsAppErrors(131062).length,0);
 assert.equal(m.lookupWhatsAppErrors(131062,'marketing').length,1);
 assert.equal(m.lookupWhatsAppErrors(131063).length,2);
 assert.equal(m.lookupWhatsAppErrors(17).length,1);
 for(const c of [-1,NaN,Infinity,1.5,99999999]) assert.equal(m.lookupWhatsAppErrors(c).length,0);
 assert.equal(m.isKnownWhatsAppErrorCode(201),false);
 assert.equal(m.lookupGraphAuthenticationSubcode(492).name,'Invalid Session');
});
test('deterministic output and source hashes',async()=>{
 assert.equal(render(data),render(await build()));
 assert.equal(data.manifest.sources.length,5);
 for(const s of data.manifest.sources) assert.match(s.sha256,/^[a-f0-9]{64}$/);
});

test('pricing coverage',()=>{
 for(const c of [131061,131065])assert.ok(data.knownCodes.includes(c));
 assert.equal(data.entries.filter(e=>e.source==='pricing-guide').length,3);
});

test('Direct Send coverage and isolation',()=>{
 const rows=data.entries.filter(e=>e.source==='direct-send-guide');
 assert.equal(rows.length,12);
 assert.equal(rows.filter(e=>e.code===100).length,4);
 for(const c of [2388330,2388318,139200,132021]){
  assert.ok(data.knownCodes.includes(c));
  assert.equal(m.lookupWhatsAppErrors(c,'direct-send').length,1);
  assert.equal(m.lookupWhatsAppErrors(c,'marketing').length,0);
 }
 assert.equal(m.lookupWhatsAppErrors(100,'direct-send').length,5);
 assert.ok(!data.knownCodes.includes(2388341));
});
