import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { handleMobileAi } from '../lib/mobile-ai.ts';
import { Miniflare, createFetchMock } from 'miniflare';

// SQLite executes the actual bound SQL; batch mirrors D1's atomic transaction.
class MemoryD1 {
  sqlite = new DatabaseSync(':memory:');
  constructor() {
    const files = readdirSync(new URL('../drizzle/', import.meta.url)).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) this.sqlite.exec(readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
  }
  prepare(sql) {
    const db = this.sqlite;
    let values = [];
    const statement = {
      bind(...args) { values = args; return statement; },
      async first() { return db.prepare(sql).get(...values) ?? null; },
      async run() { const result = db.prepare(sql).run(...values); return { success: true, meta: { changes: Number(result.changes) }, results: [] }; },
      execute() { return { success: true, results: db.prepare(sql).all(...values) }; },
      async all() { return statement.execute(); },
    };
    return statement;
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN');
    try { const out = []; for (const stmt of statements) out.push(stmt.execute()); this.sqlite.exec('COMMIT'); return out; }
    catch (err) { this.sqlite.exec('ROLLBACK'); throw err; }
  }
}
const id = 'e18ac13e-3782-4fba-b84f-76a893d4e770';
const credential = 'a'.repeat(64);
const fakeKey = 'unit-test-provider-credential';
const origin = 'https://greenbiz-ai-service.dearjelly6.chatgpt.site';
const advice = { requestId: randomUUID(), task: 'advice', data: { question: 'How can I save?', aggregates: { income: 400, expenses: 100, net: 300, activeDays: 2, digitalShare: 0.5, stockItems: 2, lowStockItems: 1 } } };
const clock = () => new Date('2026-10-19T02:00:00Z');
function req(path, body, { auth = true, ip = '203.0.113.7', extra = {}, method = 'POST' } = {}) {
  return new Request(origin + path, { method, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, ...(auth ? { Authorization: 'Bearer ' + credential, 'x-greenbiz-installation': id } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function setup(overrides = {}, transport) {
  const env = { DB: new MemoryD1(), OPENROUTER_API_KEY: fakeKey, ...overrides };
  const calls = [];
  const deps = { now: clock, fetch: async (url, init) => { calls.push({url, init}); return transport ? transport(url, init) : Response.json({ choices: [{ message: { content: 'Keep a small emergency reserve.' }, finish_reason: 'stop' }] }); } };
  const enrolled = await handleMobileAi(req('/api/mobile/enroll', { installationId: id, secret: credential }, {auth:false}), env, deps);
  assert.equal(enrolled.status, 200);
  return { env, deps, calls, chat: (body = { ...advice, requestId: randomUUID() }, options) => handleMobileAi(req('/api/mobile/chat', body, options), env, deps) };
}

test('health exposes only readiness/model and CORS restricts browser origins', async () => {
  const response = await handleMobileAi(req('/api/health', undefined, {method:'GET'}), {}, { now: clock });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', ai: false, model: 'google/gemini-3.8-flash' });
  const denied = await handleMobileAi(req('/api/health', undefined, {method:'OPTIONS', extra:{Origin:'https://evil.example'}}), {});
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.has('Access-Control-Allow-Origin'), false);
  const allowed = await handleMobileAi(req('/api/health', undefined, {method:'OPTIONS', extra:{Origin:'capacitor://localhost'}}), {});
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), 'capacitor://localhost');
});

test('enrollment hashes credentials, is idempotent, and cannot rotate a credential', async () => {
  const {env, deps} = await setup();
  const stored = env.DB.sqlite.prepare('SELECT * FROM installations').get();
  assert.equal(stored.secret_hash, createHash('sha256').update(credential).digest('hex'));
  assert.equal(JSON.stringify(stored).includes(credential), false);
  assert.equal((await handleMobileAi(req('/api/mobile/enroll', {installationId:id, secret:credential}, {auth:false}),env,deps)).status,200);
  assert.equal((await handleMobileAi(req('/api/mobile/enroll', {installationId:id, secret:'b'.repeat(64)}, {auth:false}),env,deps)).status,409);
});

test('new enrollment is capped at ten per IP/day, existing enrollment still succeeds', async () => {
  const {env,deps} = await setup();
  for(let i=1;i<10;i++) assert.equal((await handleMobileAi(req('/api/mobile/enroll',{installationId:randomUUID(),secret:credential},{auth:false}),env,deps)).status,200);
  assert.equal((await handleMobileAi(req('/api/mobile/enroll',{installationId:randomUUID(),secret:credential},{auth:false}),env,deps)).status,429);
  assert.equal((await handleMobileAi(req('/api/mobile/enroll',{installationId:id,secret:credential},{auth:false}),env,deps)).status,200);
});

test('chat authenticates only headers and never echoes supplied credentials', async () => {
  const {chat,calls} = await setup();
  for (const options of [{auth:false}, {extra:{Authorization:'Bearer '+'b'.repeat(64)}}, {extra:{'x-greenbiz-installation':randomUUID()} }]) {
    const response = await chat(undefined,options); assert.equal(response.status,401); assert.equal((await response.text()).includes(credential),false);
  }
  assert.equal((await chat({...advice, secret:credential})).status,400);
  assert.equal(calls.length,0);
});

test('strict request schemas reject override, personal-record fields, malformed photos and unbounded aggregates', async () => {
  const {chat,calls} = await setup();
  const invalid = [
    {...advice, model:'attacker'}, {...advice,data:{...advice.data, customers:[]}},
    {...advice,data:{...advice.data, aggregates:{...advice.data.aggregates,income:1e99}}},
    {...advice,task:'stock',data:{image:'https://evil.example/image.png'}},
    {...advice,task:'stock',data:{image:'data:image/svg+xml;base64,abcd'}},
    {...advice,task:'stock',data:{image:'data:image/png;base64,%%%%'}},
    {...advice,task:'stock',data:{image:'data:image/png;base64,'+'A'.repeat(5*1024*1024)}},
    {...advice,task:'sale',data:{sentence:'x',products:[{id:'p1',name:'rice',unit:'kg',available:-1}]}},
  ];
  for (const body of invalid) assert.equal((await chat(body)).status,400);
  assert.equal(calls.length,0);
});

test('provider request fixes endpoint, model, provider, token budget and no redirects', async () => {
  const {chat,calls} = await setup();
  assert.equal((await chat()).status,200);
  assert.equal(calls.length,1);
  const {url,init} = calls[0];
  assert.equal(url,'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(init.redirect,'manual');
  assert.equal(init.headers.Authorization,'Bearer '+fakeKey);
  const body = JSON.parse(init.body);
  assert.equal(body.model,'google/gemini-3.8-flash');
  assert.deepEqual(body.provider,{only:['google-ai-studio/flex'],allow_fallbacks:false});
  assert.equal(body.max_tokens,2048);
  assert.equal(body.stream,false);
  assert.deepEqual(body.reasoning,{effort:'low'});
  assert.equal(body.response_format,undefined);
  assert.equal(body.messages.length,2);
  assert.match(body.messages[0].content,/BDT/);
  assert.equal(init.signal.aborted,false);
});

test('actual Workers runtime accepts the production provider transport settings', async () => {
  const fetchMock=createFetchMock();
  fetchMock.disableNetConnect();
  const pool=fetchMock.get('https://openrouter.ai');
  pool.intercept({path:'/api/v1/chat/completions',method:'POST'}).reply(200,JSON.stringify({choices:[{message:{content:'Review stock weekly.'},finish_reason:'stop'}]}));
  const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-15',fetchMock,script:`export default {async fetch(request){return fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',redirect:request.headers.get('x-redirect-mode'),headers:{'Content-Type':'application/json',Authorization:'Bearer fake-test-only'},body:await request.text()});}}`});
  try {
    const {chat,calls}=await setup({},(_url,init)=>mf.dispatchFetch('http://localhost',{method:'POST',redirect:'manual',headers:{'x-redirect-mode':init.redirect},body:init.body}));
    assert.equal((await chat()).status,200);
    assert.equal(calls.length,1);
    fetchMock.assertNoPendingInterceptors();
  } finally {await mf.dispose();await fetchMock.close();}
});

test('provider redirects are rejected without a second request or forwarded credential', async () => {
  for (const status of [301,302,307,308]) {
    const {chat,calls}=await setup({},()=>new Response(null,{status,headers:{location:'https://credential-sink.invalid/'}}));
    const response=await chat();
    assert.equal(response.status,502);
    assert.equal((await response.json()).code,'provider_http_'+status);
    assert.equal(calls.length,1);
    assert.equal(calls[0].url,'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(calls[0].init.redirect,'manual');
  }
});

test('durable request claims block exact, altered and concurrent reuse before a second provider call', async () => {
  const {chat,calls,env,deps} = await setup();
  const body = {...advice,requestId:randomUUID()};
  const responses = await Promise.all([chat(body),chat(body)]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  assert.equal((await chat({...body,data:{...body.data,question:'Changed'}})).status,409);
  // A new service invocation reuses durable DB state.
  assert.equal((await handleMobileAi(req('/api/mobile/chat',body),env,{...deps})).status,409);
  assert.equal(calls.length,1);
  const row = env.DB.sqlite.prepare('SELECT * FROM request_claims').get();
  assert.equal(row.status,'succeeded');
  assert.equal(JSON.stringify(row).includes('How can'),false);
  assert.equal(JSON.stringify(row).includes('reserve'),false);
});

test('concurrent quota reservations cannot exceed the configured device cap', async () => {
  const {chat,calls} = await setup({DEVICE_DAILY_LIMIT:'2'});
  const responses = await Promise.all(Array.from({length:8},()=>chat()));
  assert.equal(responses.filter(r=>r.status===200).length,2);
  assert.equal(responses.filter(r=>r.status===429).length,6);
  assert.equal(calls.length,2);
});

test('exhausted installations cannot grow claims or consume shared quota with rejected IDs', async () => {
  const {chat,env,calls} = await setup({DEVICE_DAILY_LIMIT:'1'});
  assert.equal((await chat()).status,200);
  const retry = {...advice,requestId:randomUUID()};
  for (let i=0;i<30;i++) assert.equal((await chat({...retry,requestId:i ? randomUUID() : retry.requestId})).status,429);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM request_claims').get().n,1);
  assert.equal(env.DB.sqlite.prepare("SELECT used FROM daily_usage WHERE scope='global'").get().used,1);
  assert.equal(env.DB.sqlite.prepare("SELECT used FROM daily_usage WHERE scope='ip'").get().used,1);
  assert.equal(calls.length,1);
});

test('global and IP caps hold across installations; UTC day rollover restores quota', async () => {
  const {chat,env,deps,calls} = await setup({GLOBAL_DAILY_LIMIT:'1',IP_DAILY_LIMIT:'1'});
  assert.equal((await chat()).status,200);
  assert.equal((await chat()).status,429);
  deps.now = () => new Date('2026-10-20T00:00:00Z');
  assert.equal((await chat()).status,200);
  assert.equal(calls.length,2);
  assert.equal(env.DB.sqlite.prepare("SELECT MAX(used) AS n FROM daily_usage WHERE scope = 'global'").get().n,1);
});

test('key missing and DB missing fail closed without provider calls', async () => {
  const s = await setup();
  for(const overrides of [{OPENROUTER_API_KEY:undefined},{DB:undefined},{DB:{prepare(){throw new Error(fakeKey)}}}]) {
    const response = await handleMobileAi(req('/api/mobile/chat',advice),{...s.env,...overrides},s.deps);
    assert.equal(response.status,503); assert.equal((await response.text()).includes(fakeKey),false);
  }
  assert.equal(s.calls.length,0);
});

test('provider failures, exceptions, oversized outputs and credential echoes are sanitized', async () => {
  const transports = [
    () => new Response(fakeKey,{status:401}), () => {throw new Error(fakeKey)},
    () => Response.json({choices:[{message:{content:fakeKey},finish_reason:'stop'}]}),
    () => Response.json({choices:[{message:{content:credential},finish_reason:'stop'}]}),
    () => Response.json({choices:[{message:{content:'x'.repeat(20000)},finish_reason:'stop'}]}),
    () => Response.json({choices:[{message:{content:'Truncated'},finish_reason:'length'}]}),
  ];
  for(const transport of transports) {
    const {chat,calls} = await setup({},transport); const body={...advice,requestId:randomUUID()};
    const response = await chat(body); assert.equal(response.status,502);
    const text = await response.text(); assert.equal(text.includes(fakeKey),false); assert.equal(text.includes(credential),false);
    assert.equal((await chat(body)).status,409); assert.equal(calls.length,1);
  }
});

test('provider account failures have safe actionable messages without upstream details', async () => {
  for (const [status,word] of [[401,'authorization'],[403,'authorization'],[402,'top-up'],[404,'configuration'],[400,'configuration'],[429,'busy']]) {
    const {chat}=await setup({},()=>new Response(fakeKey,{status}));
    const response=await chat();
    assert.equal(response.status,502);
    const text=await response.text();
    assert.ok(text.includes(word));
    assert.equal(text.includes(fakeKey),false);
  }
});

test('provider diagnostics expose only fixed transport categories or numeric HTTP status', async () => {
  for (const [transport,code] of [[()=>new Response(fakeKey,{status:503}),'provider_http_503'],[()=>{throw new Error(fakeKey)},'provider_connection']]) {
    const {chat}=await setup({},transport);
    const response=await chat();
    const json=await response.json();
    assert.equal(response.status,502);
    assert.equal(json.code,code);
    assert.equal(JSON.stringify(json).includes(fakeKey),false);
  }
});

test('sale output must use existing IDs and bounded positive quantities; stock JSON is validated', async () => {
  const sale = {...advice,task:'sale',data:{sentence:'two rice',products:[{id:'p1',name:'Rice',unit:'kg',available:5}]}};
  for(const content of ['{"items":[{"productId":"invented","quantity":2}],"unmatched":[]}', '{"items":[{"productId":"p1","quantity":-1}],"unmatched":[]}', '{"items":[{"productId":"p1","quantity":6}],"unmatched":[]}']) {
    const {chat} = await setup({},()=>Response.json({choices:[{message:{content},finish_reason:'stop'}]}));
    assert.equal((await chat(sale)).status,502);
  }
  const good = '{"items":[{"productId":"p1","quantity":2}],"unmatched":[]}';
  const {chat,calls} = await setup({},()=>Response.json({choices:[{message:{content:good},finish_reason:'stop'}]}));
  assert.deepEqual(await (await chat(sale)).json(),{text:good});
  assert.deepEqual(JSON.parse(calls[0].init.body).response_format,{type:'json_object'});
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
  const stock = {...advice,task:'stock',data:{image:png}};
  const s = await setup({},()=>Response.json({choices:[{message:{content:'{"products":[{"name":"Rice","category":"Food","unit":"kg","description":"Visible bag","quantity":0,"cost":0,"price":0,"lowAt":0}]}'},finish_reason:'stop'}]}));
  assert.equal((await s.chat(stock)).status,200);
  assert.equal(JSON.parse(s.calls[0].init.body).messages[1].content[1].image_url.url,png);
});

test('advice accepts the Android percentage digitalShare and rejects values outside business bounds', async () => {
  const {chat} = await setup();
  const data={...advice.data,aggregates:{...advice.data.aggregates,digitalShare:75,activeDays:30,stockItems:10000,lowStockItems:10000}};
  assert.equal((await chat({...advice,data})).status,200);
  for(const field of [{digitalShare:101},{activeDays:31},{stockItems:10001},{lowStockItems:10001}]) {
    assert.equal((await chat({...advice,data:{...data,aggregates:{...data.aggregates,...field}}})).status,400);
  }
});

test('concurrent independent installations share the global and IP cap', async () => {
  for(const limits of [{GLOBAL_DAILY_LIMIT:'2'},{IP_DAILY_LIMIT:'2'}]) {
    const {env,deps,calls}=await setup(limits);
    const ids=Array.from({length:5},()=>randomUUID());
    for(const installationId of ids) assert.equal((await handleMobileAi(req('/api/mobile/enroll',{installationId,secret:credential},{auth:false}),env,deps)).status,200);
    const responses=await Promise.all(ids.map(installationId=>handleMobileAi(req('/api/mobile/chat',{...advice,requestId:randomUUID()},{extra:{'x-greenbiz-installation':installationId}}),env,deps)));
    assert.equal(responses.filter(r=>r.status===200).length,2);
    assert.equal(responses.filter(r=>r.status===429).length,3);
    assert.equal(calls.length,2);
  }
});

test('health readiness requires all migrated tables and never calls the provider', async () => {
  const {env,deps,calls}=await setup();
  let response=await handleMobileAi(req('/api/health',undefined,{method:'GET'}),env,deps);
  assert.equal((await response.json()).ai,true);
  env.DB.sqlite.exec('DROP TABLE daily_usage');
  response=await handleMobileAi(req('/api/health',undefined,{method:'GET'}),env,deps);
  assert.equal((await response.json()).ai,false);
  assert.equal(calls.length,0);
});

test('a 45-second provider timeout aborts the sole request and keeps its reuse guard', async context => {
  context.mock.timers.enable({apis:['setTimeout']});
  let started;
  const reached=new Promise(resolve=>{started=resolve});
  const {chat,calls}=await setup({},(_url,init)=>new Promise((_resolve,reject)=>{
    init.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});
    started();
  }));
  const body={...advice,requestId:randomUUID()};
  const pending=chat(body);
  await reached;
  context.mock.timers.tick(45000);
  assert.equal((await pending).status,502);
  assert.equal(calls[0].init.signal.aborted,true);
  assert.equal((await chat(body)).status,409);
  assert.equal(calls.length,1);
});

test('oversized chunked bodies, invalid JSON and credential fields in body fail before quota or provider', async () => {
  const {env,deps,calls,chat}=await setup();
  const invalidJson=new Request(origin+'/api/mobile/chat',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+credential,'x-greenbiz-installation':id},body:'{'});
  assert.equal((await handleMobileAi(invalidJson,env,deps)).status,400);
  const oversized=new Request(origin+'/api/mobile/chat',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+credential,'x-greenbiz-installation':id},body:'x'.repeat(5*1024*1024+64*1024+1)});
  assert.equal((await handleMobileAi(oversized,env,deps)).status,400);
  assert.equal((await chat({...advice,installationId:id,secret:credential})).status,400);
  assert.equal(calls.length,0);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM request_claims').get().n,0);
});

test('stock output rejects malformed JSON, missing fields, extra instructions and excess products', async () => {
  const goodProduct={name:'Rice',category:'Food',unit:'kg',description:'Visible bag',quantity:0,cost:0,price:0,lowAt:0};
  const stock={...advice,task:'stock',data:{image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'}};
  for(const content of ['```json\n{"products":[]}\n```','{"products":[{}]}',JSON.stringify({products:[{...goodProduct,quantity:1.0001}]}),JSON.stringify({products:Array.from({length:21},()=>goodProduct)}),JSON.stringify({products:[],messages:[]})]) {
    const {chat}=await setup({},()=>Response.json({choices:[{message:{content},finish_reason:'stop'}]}));
    assert.equal((await chat(stock)).status,502);
  }
});

test('structured output cannot echo provider credentials through JSON Unicode escapes', async () => {
  const content='{"products":[{"name":"\\u0075nit-test-provider-credential","category":"Food","unit":"kg","description":"Bag","quantity":0,"cost":0,"price":0,"lowAt":0}]}';
  const {chat}=await setup({},()=>Response.json({choices:[{message:{content},finish_reason:'stop'}]}));
  const response=await chat({...advice,task:'stock',data:{image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'}});
  assert.equal(response.status,502);
  assert.equal((await response.text()).includes(fakeKey),false);
});

test('website origins come from the defaults plus ALLOWED_ORIGINS, ignoring malformed entries', async () => {
  const preflight = (origin, env = {}) => handleMobileAi(req('/api/health', undefined, { method: 'OPTIONS', extra: { Origin: origin } }), env);
  assert.equal((await preflight('https://greenbizdemosite.sustgpt.com')).status, 204);
  assert.equal((await preflight('http://203.0.113.10:8790')).status, 403);
  const env = { ALLOWED_ORIGINS: ' http://203.0.113.10:8790 , https://shop.example/path, not a url,https://shop.example.com ' };
  const allowed = await preflight('http://203.0.113.10:8790', env);
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), 'http://203.0.113.10:8790');
  assert.equal((await preflight('https://shop.example.com', env)).status, 204);
  assert.equal((await preflight('https://shop.example', env)).status, 403);
  assert.equal((await preflight('https://evil.example', env)).status, 403);
});
