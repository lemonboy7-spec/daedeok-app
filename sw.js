const CACHE = 'daedeok-settlement-v137';
const ASSETS = ['./', './index.html', './app.js', './styles.css', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// ---- 폰 공유 받기 (음성 녹음 → 텍스트 파일 공유 → 정산유틸) ----
// 공유받은 텍스트 파일 글자 방식 알아내기: 삼성 음성 녹음은 UTF-8이 아닌 옛 한글 방식(CP949/EUC-KR)이나 UTF-16으로 저장하기도 함
const decodeBytes = (buf) => {
  const b = new Uint8Array(buf);
  if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return new TextDecoder('utf-8').decode(b.subarray(3));
  if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder('utf-16be').decode(b.subarray(2));
  let z0 = 0, z1 = 0; for (let i = 0; i < Math.min(b.length, 400); i++) if (!b[i]) { if (i % 2) z1++; else z0++; }
  if (z1 > 20 && z1 > z0 * 4) return new TextDecoder('utf-16le').decode(b);
  if (z0 > 20 && z0 > z1 * 4) return new TextDecoder('utf-16be').decode(b);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) {}
  try { return new TextDecoder('euc-kr').decode(b); } catch (e) {} // 브라우저의 euc-kr = CP949(확장 한글 포함)
  return new TextDecoder('utf-8').decode(b);
};
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'POST' || !/\/share-target\/?$/.test(u.pathname)) return;
  e.respondWith((async () => {
    let text = '', name = '';
    try {
      const fd = await e.request.formData();
      text = String(fd.get('text') || '');
      const f = fd.get('file');
      if (f && typeof f !== 'string') { name = f.name || ''; if (f.size < 300000) { const t = decodeBytes(await f.arrayBuffer()); if (t && t.trim()) text = t; } }
      if (!text) text = String(fd.get('title') || '');
    } catch (err) {}
    try { const c = await caches.open('ddk-share'); await c.put('./__share', new Response(JSON.stringify({ text: text.replace(/^\uFEFF/, ''), name, at: Date.now() }), { headers: { 'Content-Type': 'application/json' } })); } catch (err) {}
    return Response.redirect(new URL('./index.html?share=1', self.registration.scope).href, 303);
  })());
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
  );
});

// ---- 채팅 푸시 알림 (Firebase Cloud Messaging → 이 서비스워커가 직접 표시) ----
self.addEventListener('push', (e) => {
  let d = {};
  try { const j = e.data ? e.data.json() : {}; d = j.data || j.notification || j; } catch (err) { try { d = { body: e.data && e.data.text() }; } catch (e2) {} }
  const title = d.title || '대덕부동산 채팅';
  const room = d.room || '';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    const vis = cs.find((c) => c.visibilityState === 'visible' && c.focused);
    if (vis && d.kind !== 'test') { vis.postMessage({ ddkPush: d }); return; } // 앱을 보고 있으면 앱 안에서 표시 (시험 알림은 항상 띄움)
    // v7.15: 도우미가 보낸 통화 내용이 서버에 도착 → 앱을 닫아 둬도 알림 (아이콘에 표시)
    if (d.kind === 'call') return self.registration.showNotification(d.title || '통화 내용 도착', { body: d.body || '', tag: 'ddk-push-call-' + (d.id || Date.now()), icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', vibrate: [80], data: { open: 'calls' } });
    return self.registration.showNotification(title, { body: d.body || '', tag: 'chat-' + room, renotify: true, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', vibrate: [120, 60, 120], data: { room } });
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const room = (e.notification.data && e.notification.data.room) || '';
  const open = (e.notification.data && e.notification.data.open) || '';
  if (open === 'calls' || open === 'req') { // v7.15: 걸려 온 전화·요청 알림 → 그 화면으로
    e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      const c = cs[0];
      if (c) { c.postMessage({ ddkOpen: open }); return c.focus(); }
      return self.clients.openWindow('./?open=' + open);
    }));
    return;
  }
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    const c = cs[0];
    if (c) { c.postMessage({ ddkOpenChat: room }); return c.focus(); }
    return self.clients.openWindow('./?chat=' + encodeURIComponent(room));
  }));
});
