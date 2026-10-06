/* 码方二维码 Codeform · Service Worker
   ============================================================
   缓存策略：网络优先（network-first），缓存仅作离线兜底。

   为什么不用常见的「缓存优先」？
   这是个纯静态工具站，代码随时可能更新。若用缓存优先，用户会
   长期停留在旧版本上 —— 这是静态站点最隐蔽也最恼人的一类 bug：
   你改完了、推送了、线上也生效了，但老访客看到的还是几个月前的
   版本，且没有任何办法察觉。网络优先保证「有网永远拿最新」，
   断网时再回退到缓存，既避开陈旧问题，又兑现「断网可用」的承诺。

   唯一的代价是每次访问都要发一次请求（拿到 304 时开销很小），
   对本站这种小体积静态资源完全可以接受。
   ============================================================ */

var VERSION = 'codeform-v1';
var CACHE = VERSION + '-assets';

/* 预缓存清单：只放「离线时必需」的资源。
   刻意不放 og-cover.png（95KB，只有社交平台抓取时才需要）
   和 font-compare.html（开发调试页）。 */
var PRECACHE = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/app.js',
  '/qrcode.js',
  '/jsqr.js',
  '/zip.js',
  '/shape_math.js',
  '/fonts/inter-latin-var.woff2',
  '/fonts/jetbrains-latin-var.woff2',
  '/brand/favicon.svg',
  '/brand/favicon-32.png',
  '/brand/apple-touch-icon.png',
  '/brand/icon-256.png',
  '/brand/icon-512.png'
];

/* ---------- 安装：预缓存 ---------- */
self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // 逐个 add 而不是 addAll：addAll 只要有一个失败就整体回滚，
      // 而这里任何一个资源 404 都不该导致 SW 安装失败。
      return Promise.all(PRECACHE.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function (err) {
          console.warn('[SW] 预缓存跳过:', url, err && err.message);
        });
      }));
    }).then(function () {
      // 让新 SW 立刻接管，不必等所有标签页关闭
      return self.skipWaiting();
    })
  );
});

/* ---------- 激活：清理旧版本缓存 ---------- */
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE && k.indexOf('codeform-') === 0) {
          console.log('[SW] 清除旧缓存:', k);
          return caches.delete(k);
        }
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

/* ---------- 请求拦截 ---------- */
self.addEventListener('fetch', function (e) {
  var req = e.request;

  // 只处理 GET；POST 等直接放行
  if (req.method !== 'GET') return;

  var url;
  try {
    url = new URL(req.url);
  } catch (err) {
    return;
  }

  // 只接管同源请求。跨源（未来若加统计、CDN）一律不干预，
  // 避免因缓存策略干扰第三方资源。
  if (url.origin !== self.location.origin) return;

  // 页面导航请求：网络优先，失败则回退到缓存的首页
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put('/index.html', copy); });
          return res;
        })
        .catch(function () {
          return caches.match('/index.html').then(function (r) {
            return r || caches.match('/');
          });
        })
    );
    return;
  }

  // 静态资源：网络优先，缓存兜底
  e.respondWith(
    fetch(req)
      .then(function (res) {
        // 只缓存成功的同源响应（跳过 opaque / 错误响应）
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      })
      .catch(function () {
        return caches.match(req).then(function (r) {
          if (r) return r;
          // 字体请求失败时给一个空响应，避免控制台报错刷屏
          if (req.destination === 'font') {
            return new Response('', { status: 204 });
          }
          return Response.error();
        });
      })
  );
});

/* ---------- 允许页面主动触发更新 ---------- */
self.addEventListener('message', function (e) {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
