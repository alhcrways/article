import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function client(initial = []) {
  const elements = new Map();
  function element() {
    return {value:'', dataset:{}, style:{}, children:[], handlers:{}, classList:{add(){},remove(){},toggle(){},contains(){return false;}},
      addEventListener(name, fn){this.handlers[name]=fn;}, setAttribute(){}, append(...items){this.children.push(...items);},
      replaceChildren(){this.children=[];}, querySelector(){return this.span ||= element();}, focus(){}, scrollIntoView(){}};
  }
  const get = id => {if(!elements.has(id)) elements.set(id, element()); return elements.get(id);};
  const storage = new Map([['daily-review-cards-v1', JSON.stringify(initial)]]);
  const context = {document:{body:{style:{}}, getElementById:get, querySelectorAll:()=>[], querySelector:()=>element(), createElement:element, addEventListener(){}},
    window:{addEventListener(){}, confirm:()=>true, scrollTo(){}, setTimeout:fn=>fn()}, localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}, crypto:webcrypto, Intl, Date};
  vm.runInNewContext(script.replace('    })();', 'globalThis.testing = {normalizeReviews, mergeReviews};\n    })();'), context);
  return {get, read:()=>JSON.parse(storage.get('daily-review-cards-v1')), testing:context.testing,
    click:id=>get(id).handlers.click(), save:()=>get('reviewForm').handlers.submit({preventDefault(){}})};
}

test('same day: create, save twice, reload, select and edit independently', () => {
  const app = client();
  app.get('entry').value = '第一件事情'; app.save();
  const firstId = app.read()[0].id;
  app.click('newReview');
  assert.equal(app.get('entry').value, '');
  app.get('entry').value = '第二件事情'; app.save(); app.save();
  assert.equal(app.read().length, 2);
  assert.notEqual(app.read()[1].id, firstId);
  const reload = client(app.read());
  // Open the first card from the timeline and edit its original record.
  const firstCard = reload.get('timeline').children.find(x=>x.handlers.click && x.children.some(c=>c.textContent?.includes('第一件事情')));
  assert.ok(firstCard);
  firstCard.handlers.click(); reload.click('editRecordButton');
  assert.equal(reload.get('entry').value, '第一件事情');
  reload.get('entry').value = '修改第一件事情'; reload.save();
  assert.equal(reload.read().length, 2);
  assert.equal(reload.read().find(x=>x.id!==firstId).original, '第二件事情');
});

test('legacy identities are stable across devices; offline cards merge by ID', () => {
  const {testing} = client();
  const legacy = {date:'2026-10-28', original:'旧复盘', updatedAt:'2026-10-28T01:00:00Z'};
  const local = testing.normalizeReviews([legacy, {...legacy,id:'new-card',original:'新复盘'}]);
  const remote = testing.normalizeReviews([legacy]);
  const merged = testing.mergeReviews(local, remote);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, 'legacy-2026-10-28');
});

test('cloud API preserves legacy and same-day cards, updates only the matching ID', async () => {
  const source = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  const {default:worker} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  let stored = [{date:'2026-10-28',original:'旧复盘',updatedAt:'2026-10-28T01:00:00Z'}];
  const env = {REVIEW_TOKEN:'test', REVIEW_KV:{get:async()=>structuredClone(stored),put:async(k,v)=>{stored=JSON.parse(v);}}};
  const call = async(method,body)=> (await worker.fetch(new Request('https://example.test/api/reviews',{method,headers:{'x-review-token':'test'},...(body?{body:JSON.stringify(body)}:{})}),env)).json();
  const legacy = (await call('GET')).reviews[0];
  assert.equal(legacy.id,'legacy-2026-10-28');
  const added = {...legacy,id:'new-card',original:'另一件事情'};
  await call('POST',[legacy,added]);
  assert.equal(stored.length,2);
  await call('POST',{...added,original:'更新另一件事情',updatedAt:'2026-10-28T02:00:00Z'});
  await call('POST',added);
  assert.equal(stored.find(x=>x.id==='new-card').original,'更新另一件事情');
  assert.equal(stored.find(x=>x.id===legacy.id).original,'旧复盘');
});
