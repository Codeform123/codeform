/* QR Studio — 形状码（让码点自己铺满形状）
 *
 * ===========================================================================
 * 这和外框（frame_shapes.js）是两件完全不同的事，别混淆：
 *
 *   外框：码点仍是规规矩矩的方阵，只是外面套了个形状当背景 —— 码本身没变。
 *   形状（本文件）：形状外的码点**不画**，码点自己围出形状 —— 码本身变了。
 *
 * ===========================================================================
 * 【三条硬约束，违反任意一条就扫不出】
 *
 * 1. 定位图案（三个角的回形框）必须完整
 *    它是扫码器"找到码"的锚点。实测：圆形会切掉 153/192 个定位模块，
 *    菱形把三个定位图案切得一个不剩。
 *
 * 2. 校正图案（v2 起出现，5x5）必须完整
 *    它管"把歪着拍的码摆正"。实测证据最硬：六边形/八瓣花在 v3(n=29) 可扫，
 *    一升到 v4(n=33) 就扫不出 —— 差别只是 v4 多了一个 (26,26) 的校正图案，
 *    正好落在被裁掉的区域。加上这条保护后，通过率从 4/9 直接跳到 7/9。
 *
 * 3. 定位图案要和主体连通（要有码点把它接进数据区）
 *    孤立的回形框扫码器认不出。实测：去掉连通臂后八瓣花/六边形立刻失效。
 *
 * ===========================================================================
 * 【为什么做不到全部形状 —— 这是几何决定的，不是没调好参数】
 *
 *   菱形、尖角水滴：把码区四个角全切了，扫码器无法建立模块网格。
 *   实测穷举了 v1~v20 全部版本 × 静默边距 0%~20% 全部组合，无一可扫。
 *
 *   规律：能扫的形状都保留了四个角（方形/圆角/圆形/心形/花瓣/六边形），
 *         扫不出的是那些切掉角的（菱形、尖角水滴）。
 *
 * ===========================================================================
 * 【版本为什么固定在 v3】
 *
 *   起初想用"标准容量 × 形状留存率"折算需要多少版本，试了 4 轮公式，
 *   每轮误差都超过 20%，而且方向是错的 —— 它把版本抬得过高：
 *   实测 v3 明明能扫（数据装得下），公式却判成装不下 → 抬到 v4 → 反而扫不出。
 *
 *   根因：QR 的纠错冗余本就是为"整码丢掉一部分"设计的，
 *   形状裁掉的那些模块正落在纠错能力的覆盖范围内，不能当线性损失扣掉。
 *
 *   所以最终判据只留一条硬标准：QRCore.generate 不抛错（真装得下）。
 *   内容变长时自动往上抬版本。
 */
(function (root) {
  'use strict';

  // ---------- 形状定义（单位坐标，返回点是否在形状内）----------
  var DEFS = {
    square: function () { return true; },

    rounded: function (x, y) {
      var r = .11, a = Math.min(x, 1 - x), b = Math.min(y, 1 - y);
      if (a >= r || b >= r) return true;
      var da = r - a, db = r - b;
      return da * da + db * db <= r * r;
    },

    circle: function (x, y) {
      var a = x - .5, b = y - .5;
      return a * a + b * b <= .247;
    },

    // 经典心形隐函数：(x²+y²-1)³ - x²y³ ≤ 0
    heart: function (x, y) {
      var a = (x - .5) / .51, b = (.5 - y) / .51;
      var t = a * a + b * b - 1;
      return t * t * t - a * a * b * b * b <= 0;
    },

    hexagon: function (x, y) {
      var a = Math.abs(x - .5), b = Math.abs(y - .5);
      return b <= .43 && a * .866 + b * .5 <= .43;
    },

    // 花瓣：极坐标下半径随角度起伏，n 决定瓣数
    petal4: function (x, y) {
      var a = x - .5, b = y - .5, r = Math.sqrt(a * a + b * b), th = Math.atan2(b, a);
      return r <= .495 * (.60 + .40 * Math.abs(Math.cos(2 * th)));
    },
    petal8: function (x, y) {
      var a = x - .5, b = y - .5, r = Math.sqrt(a * a + b * b), th = Math.atan2(b, a);
      return r <= .495 * (.78 + .22 * Math.abs(Math.cos(4 * th)));
    }
  };

  var LIST = [
    { k: 'square',  n: '方形' },
    { k: 'rounded', n: '圆角' },
    { k: 'circle',  n: '圆形' },
    { k: 'heart',   n: '心形' },
    { k: 'petal4',  n: '四瓣花' },
    { k: 'petal8',  n: '八瓣花' },
    { k: 'hexagon', n: '六边形' }
  ];

  // ---------- 校正图案位置表（与 qrcode.js 内部一致）----------
  var ALIGN_POS = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38],
    [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62],
    [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78],
    [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90], [6, 28, 50, 72, 94]];

  // 定位图案保护区（7x7 图案 + 1 模块隔离带 = 8x8）
  function inEye(x, y, n) {
    var b = 8 / n;
    return (x < b && y < b) || (x > 1 - b && y < b) || (x < b && y > 1 - b);
  }

  // 定时图案：第 6 行 / 第 6 列的交替黑白线，扫码器靠它量出"一个模块多大"
  function inTiming(x, y, n) {
    var m = .5 / n;
    var lo = 8 / n - m, hi = 1 - 8 / n + m;
    var row6 = Math.abs(y - 6.5 / n) <= m;
    var col6 = Math.abs(x - 6.5 / n) <= m;
    return (row6 && x >= lo && x <= hi) || (col6 && y >= lo && y <= hi);
  }

  var alignCache = {};
  function alignList(n) {
    if (alignCache[n]) return alignCache[n];
    var v = (n - 17) / 4;
    var pos = ALIGN_POS[v - 1] || [];
    var out = [];
    for (var i = 0; i < pos.length; i++) for (var j = 0; j < pos.length; j++) {
      var r = pos[i], c = pos[j];
      // 三个角上的校正图案与定位图案重叠，qrcode.js 会跳过，这里也跳过
      if ((r <= 8 && c <= 8) || (r <= 8 && c >= n - 9) || (r >= n - 9 && c <= 8)) continue;
      out.push([c, r]);
    }
    return (alignCache[n] = out);
  }

  function inAlign(x, y, n) {
    var list = alignList(n), m = 3 / n;      // 5x5 校正图案 + 半个隔离带
    for (var i = 0; i < list.length; i++) {
      var cx = (list[i][0] + .5) / n, cy = (list[i][1] + .5) / n;
      if (Math.abs(x - cx) <= m && Math.abs(y - cy) <= m) return true;
    }
    return false;
  }

  // 定位图案的"连通臂"：只朝码区中心方向伸，不侵入形状外侧轮廓。
  //
  // 为什么不能用"四面均匀外扩"：那样会在三个角撑出方块，
  // 圆形/心形的轮廓角上出现明显凸起，形状不干净（试过 0.6 模块，太窄不够连通；
  // 试过 1.5 模块，连通够了但轮廓被破坏）。
  //
  // 【2026-10 补充实测】这个值对"渲染结果"其实没有影响 —— 扫描 2.6 / 1.9 / 1.35
  // / 1.0 / 0.6 五档，同一形状渲染出的 PNG 逐像素对比差异为零（MD5 完全相同）。
  // 原因是臂新增的那几十格大多落在码矩阵的空白位上（本来就没有模块），画不画一样。
  // 保留 2.6 是为了语义上"确实有码点把定位图案接进数据区"这件事成立得足够稳，
  // 也是为将来的低版本号（模块更大）留余量。别再花时间调这个参数了。
  var SPUR_REACH = 2.6;
  function inEyeSpur(x, y, n) {
    var b = 8 / n, reach = SPUR_REACH / n;
    var boxes = [[0, 0], [1 - b, 0], [0, 1 - b]];
    for (var i = 0; i < 3; i++) {
      var x0 = boxes[i][0], y0 = boxes[i][1];
      var ex = (x0 === 0) ? x0 + b + reach : x0;
      var ey = (y0 === 0) ? y0 + b + reach : y0;
      if (x >= x0 && x <= ex && y >= y0 && y <= ey) return true;
    }
    return false;
  }

  // 核心保护区：无论什么形状都必须完整保留的模块
  function isCore(x, y, n) {
    return inEye(x, y, n) || inAlign(x, y, n) || inTiming(x, y, n) || inEyeSpur(x, y, n);
  }

  // ---------- 保留判定 ----------
  // 返回一个函数：给定单位坐标，判断该位置要不要画码点
  function keepFn(key, n) {
    var s = DEFS[key] || DEFS.square;
    return function (x, y) {
      if (isCore(x, y, n)) return true;   // 功能区无条件保留
      return s(x, y);                      // 其余按形状裁剪
    };
  }

  // 保留率（模块单位，与像素无关；用于 UI 文案展示）
  var ratioCache = {};
  function keepRatio(key, n) {
    var ck = key + ':' + n;
    if (ratioCache[ck] != null) return ratioCache[ck];
    if (key === 'square') return (ratioCache[ck] = 1);
    var keep = keepFn(key, n), u = 0;
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++)
      if (keep((c + .5) / n, (r + .5) / n)) u++;
    return (ratioCache[ck] = u / (n * n));
  }

  var MIN_VERSION_CACHE = {};
  function minVersion(key) {
    if (MIN_VERSION_CACHE[key] != null) return MIN_VERSION_CACHE[key];
    // 实测：7 个形状在 v3（29×29）都能扫，码点也最大（越小的版本锯齿越少）
    return (MIN_VERSION_CACHE[key] = 3);
  }

  // 选版本：判据只有一条 —— QRCore.generate 真的不抛错
  // （不要用"标准容量 × 留存率"折算，实测那会把版本抬得过高反而扫不出，见文件头注释）
  function pickVersion(text, ec, key) {
    var base = minVersion(key);
    if (!root.QRCore) return base;
    for (var v = base; v <= 40; v++) {
      try { root.QRCore.generate(text, ec, v); return v; }
      catch (e) { continue; }
    }
    return null;
  }

  function name(key) {
    for (var i = 0; i < LIST.length; i++) if (LIST[i].k === key) return LIST[i].n;
    return '方形';
  }

  function isShaped(key) { return key && key !== 'square'; }

  root.BodyShapes = {
    list: LIST,
    keys: LIST.map(function (x) { return x.k; }),
    name: name,
    isShaped: isShaped,
    keepFn: keepFn,
    keepRatio: keepRatio,
    pickVersion: pickVersion,
    isCore: isCore,
    _defs: DEFS
  };
})(typeof window !== 'undefined' ? window : this);
