import { createRequire } from 'node:module';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const nacl = require('/tmp/claude-0/-home-user/29454e65-50ed-508a-808f-bd118f8eba3c/scratchpad/lotus/web/node_modules/tweetnacl');
const bs58 = require('/tmp/claude-0/-home-user/29454e65-50ed-508a-808f-bd118f8eba3c/scratchpad/lotus/web/node_modules/bs58');
const SH = '/tmp/claude-0/-home-user/29454e65-50ed-508a-808f-bd118f8eba3c/scratchpad/shots/';
const kp = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
const addr = bs58.encode(kp.publicKey);
console.log('wallet', addr);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, geolocation: { latitude: 53.3498, longitude: -6.2603, accuracy: 10 }, permissions: ['geolocation'] });
await ctx.exposeFunction('__sign', (hex) => Buffer.from(nacl.sign.detached(Buffer.from(hex, 'hex'), kp.secretKey)).toString('hex'));
await ctx.addInitScript((a) => {
  const bs = (() => { const A='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'; return { dec(s){ let n=0n; for(const c of s) n=n*58n+BigInt(A.indexOf(c)); let h=n.toString(16); if(h.length%2) h='0'+h; let b=h.match(/../g).map(x=>parseInt(x,16)); const lead=[...s].findIndex(c=>c!=='1'); return Uint8Array.from([...Array(lead<0?s.length:lead).fill(0),...b]); } }; })();
  const pkBytes = bs.dec(a);
  const listeners = {};
  const pk = { toBytes: () => pkBytes, toBase58: () => a, toString: () => a, equals: (o) => o?.toBase58?.() === a, toBuffer: () => pkBytes };
  const w = { isPhantom: true, publicKey: null, isConnected: false,
    on(e, f){ (listeners[e] ||= []).push(f); }, off(e, f){ listeners[e] = (listeners[e]||[]).filter(x=>x!==f); }, removeListener(e,f){ this.off(e,f); },
    async connect(){ this.publicKey = pk; this.isConnected = true; (listeners.connect||[]).forEach(f=>f(pk)); return { publicKey: pk }; },
    async disconnect(){ this.publicKey = null; this.isConnected = false; (listeners.disconnect||[]).forEach(f=>f()); },
    async signMessage(m){ const hex = [...m].map(x=>x.toString(16).padStart(2,'0')).join(''); const s = await window.__sign(hex); return { signature: Uint8Array.from(s.match(/../g).map(x=>parseInt(x,16))) }; },
  };
  window.isPhantomInstalled = true; window.phantom = { solana: w }; window.solana = w;
}, addr);
await ctx.route(/tile.openstreetmap.org/, r => r.abort());
const page = await ctx.newPage();
page.on('console', (m) => { if (['error','warning'].includes(m.type())) console.log('[console]', m.type(), m.text().slice(0,200)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0,300)));
page.on('response', (r) => { if (r.url().includes('/api/') ) console.log('[api]', r.request().method(), r.url().replace('http://localhost:3000',''), r.status()); });
const shot = (n) => page.screenshot({ path: SH + n + '.png' });
await page.goto('http://localhost:3000/');
await page.waitForTimeout(3000);
await shot('01-home-signed-out');
console.log('phantom', await page.evaluate(()=>typeof window.phantom+' '+(window.phantom?.solana?.isPhantom)));
await page.getByText('Connect wallet to play').click();
await page.waitForTimeout(1000);
await shot('02-connect-sheet');
await page.getByText('Phantom').first().click();
await page.waitForTimeout(4000);
await shot('03-signed-in-map');
console.log('sheet still open?', await page.locator('.sheet').count());
const crates = await page.evaluate(async () => (await (await fetch('/api/crates',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({lat:53.3498,lng:-6.2603,accuracyM:10,ts:Date.now(),deviceId:'dev-test-1'})})).json()));
console.log('crates api', JSON.stringify(crates));
const markers = page.locator('button.crate');
console.log('markers', await markers.count());
// far crate first
const R=(a,b)=>{const t=x=>x*Math.PI/180;const d=t(b.lat-a.lat),e=t(b.lng-a.lng);const q=Math.sin(d/2)**2+Math.cos(t(a.lat))*Math.cos(t(b.lat))*Math.sin(e/2)**2;return 6371000*2*Math.asin(Math.sqrt(q));};
const me={lat:53.3498,lng:-6.2603};
const ds=crates.crates.map(c=>R(me,c));
console.log('distances', ds.map(Math.round));
const farIdx = ds.findIndex(d=>d>60), nearIdx = ds.findIndex(d=>d<=40);
if (farIdx>=0){
  await page.evaluate((i)=>document.querySelectorAll('button.crate')[i].click(), farIdx);
  await page.waitForTimeout(800);
  await shot('04-crate-out-of-range');
  console.log('drawer:', await page.locator('.drawer').innerText());
  // bypass UI: hit API from far
  const r = await page.evaluate(async (id)=> (await (await fetch('/api/crates/open',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({crateId:id,lat:53.3498,lng:-6.2603,ts:Date.now(),accuracyM:10,deviceId:'dev-test-1'})})).json()), crates.crates[farIdx].id);
  console.log('far open ->', JSON.stringify(r));
}
if (nearIdx>=0){
  await page.evaluate((i)=>document.querySelectorAll('button.crate')[i].click(), nearIdx);
  await page.waitForTimeout(800);
  await shot('05-crate-in-range');
  await page.getByRole('button',{name:/Open crate/}).click();
  await page.waitForTimeout(2500);
  await shot('06-open-result');
  console.log('modal:', await page.locator('.sheet, .modal-back, [role=dialog], .overlay').first().innerText().catch(()=> 'none'));
}
for (const [n,u] of [['07-history','/history'],['08-vault','/vault'],['09-admin','/admin']]) {
  await page.goto('http://localhost:3000'+u); await page.waitForTimeout(2500); await shot(n);
  console.log(u, (await page.locator('main').innerText().catch(()=>'')).slice(0,400).replace(/\n+/g,' | '));
}
await browser.close();
