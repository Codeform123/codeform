/* QR Studio — 整体轮廓形状（把二维码做成圆形 / 心形 / 花瓣 …）
 *
 * 【为什么形状只能"往外扩"，不能"裁码"】
 * 二维码的三个定位图案就长在左上 / 右上 / 左下三个角上，
 * 任何把码区切掉一块的变形都会直接破坏 1:1:3:1:1 的扫描比例，结果就是扫不出来。
 * 所以这里的设计是反过来的：码区（含静默边距）保持完整不动，
 * 形状在它外面长出来 —— 形状内部填充背景色，形状外部透明。
 * 视觉上整张码变成了心形/圆形，功能上和普通方码完全等价。
 *
 * 【安全性怎么保证 —— 不靠估算比例，靠数值求解】
 * 每种形状包住一个正方形需要多大？心形上方有凹陷、花瓣有腰身，
 * 手算比例很容易算错，而且换个形状就要重算一遍。
 * 这里用 isPointInPath 采样码区四边（每边 24 个点，共 96 个点）
 * 做包含性测试，从小到大扫出"刚好全部包住"的最小缩放比，再加 1.5% 余量。
 * 比例只和形状有关、与像素尺寸无关，所以算一次就永久缓存。
 *
 * 【一份几何，两条渲染路径】
 * 每个形状只产出一个 SVG path 字符串：
 *   Canvas 侧 new Path2D(d) 直接可用，SVG 侧直接写进 <path d="...">。
 * 不存在"预览是圆形、导出是方形"这种两套实现漂移的可能。
 */
(function (root) {
  'use strict';

  var TAU = Math.PI * 2;

  // ---------- 形状定义 ----------
  // 约定：都画在 [0,1]×[0,1] 的单位方框里，调用方负责缩放和平移。
  var DEFS = {
    square: function () { return 'M0 0H1V1H0Z'; },

    rounded: function () {
      var r = 0.09;
      return 'M' + r + ' 0H' + (1 - r)
        + 'A' + r + ' ' + r + ' 0 0 1 1 ' + r
        + 'V' + (1 - r)
        + 'A' + r + ' ' + r + ' 0 0 1 ' + (1 - r) + ' 1'
        + 'H' + r
        + 'A' + r + ' ' + r + ' 0 0 1 0 ' + (1 - r)
        + 'V' + r
        + 'A' + r + ' ' + r + ' 0 0 1 ' + r + ' 0Z';
    },

    // 两段半圆拼整圆（比单段整圆兼容性好）
    circle: function () {
      return 'M0 0.5A0.5 0.5 0 0 1 1 0.5A0.5 0.5 0 0 1 0 0.5Z';
    },

    heart: function () {
      return 'M0.5 0.97'
        + 'C0.5 0.97 0.02 0.63 0.02 0.36'
        + 'C0.02 0.18 0.15 0.06 0.3 0.06'
        + 'C0.4 0.06 0.47 0.12 0.5 0.2'
        + 'C0.53 0.12 0.6 0.06 0.7 0.06'
        + 'C0.85 0.06 0.98 0.18 0.98 0.36'
        + 'C0.98 0.63 0.5 0.97 0.5 0.97Z';
    },

    // 四瓣花：瓣尖必须转 45°（对着正方形的四个角）。
    // 试过瓣尖朝上下左右（rot=0），凹口正好卡在正方形四角上，
    // 缩放比要 2.5 以上才包得住，码在中间小得可怜；转 45° 后只要 1.415。
    petal4: function () { return petal(4, 0.38, 45); },
    petal8: function () { return petal(8, 0.34, 0); },

    diamond: function () { return 'M0.5 0L1 0.5L0.5 1L0 0.5Z'; },

    hexagon: function () { return 'M0.5 0L0.933 0.25V0.75L0.5 1L0.067 0.75V0.25Z'; },

    drop: function () {
      return 'M0.5 0.02'
        + 'C0.5 0.02 0.96 0.42 0.96 0.62'
        + 'C0.96 0.83 0.78 0.98 0.5 0.98'
        + 'C0.22 0.98 0.04 0.83 0.04 0.62'
        + 'C0.04 0.42 0.5 0.02 0.5 0.02Z';
    }
  };

  // n 瓣花：瓣尖在半径 0.5 的圆上，瓣之间收到半径 waist 的"腰"处。
  // 用二次贝塞尔连接相邻瓣尖，控制点由期望的腰点反解（曲线中点公式），
  // 得到自然的内凹曲线 —— 这就是花瓣之间那道凹口。
  function petal(n, waist, rotDeg) {
    var cx = 0.5, cy = 0.5, R = 0.5, pts = [];
    var rot = (rotDeg || 0) * Math.PI / 180;
    for (var i = 0; i < n; i++) {
      var a = -Math.PI / 2 + rot + i * TAU / n;      // 从正上方起，再整体旋转
      pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
    }
    var d = 'M' + f(pts[0][0]) + ' ' + f(pts[0][1]);
    for (var j = 0; j < n; j++) {
      var p0 = pts[j], p1 = pts[(j + 1) % n];
      var ma = -Math.PI / 2 + rot + (j + 0.5) * TAU / n;
      var mx = cx + waist * Math.cos(ma), my = cy + waist * Math.sin(ma);
      var ccx = (4 * mx - p0[0] - p1[0]) / 2;
      var ccy = (4 * my - p0[1] - p1[1]) / 2;
      d += 'Q' + f(ccx) + ' ' + f(ccy) + ' ' + f(p1[0]) + ' ' + f(p1[1]);
    }
    return d + 'Z';
  }

  function f(v) { return Math.round(v * 10000) / 10000; }

  var LIST = [
    { k: 'square',  n: '方形' },
    { k: 'rounded', n: '圆角' },
    { k: 'circle',  n: '圆形' },
    { k: 'heart',   n: '心形' },
    { k: 'petal4',  n: '四瓣花' },
    { k: 'petal8',  n: '八瓣花' },
    { k: 'diamond', n: '菱形' },
    { k: 'hexagon', n: '六边形' },
    { k: 'drop',    n: '水滴' }
  ];

  var unitCache = {};
  function unitPath(key) {
    if (!unitCache[key]) unitCache[key] = (DEFS[key] || DEFS.square)();
    return unitCache[key];
  }

  // { d, scale, tx, ty }：把单位路径缩放成包围盒 size×size、中心在 (cx,cy)
  function build(key, size, cx, cy) {
    return { d: unitPath(key), scale: size, tx: cx - size / 2, ty: cy - size / 2 };
  }

  // Canvas：返回可直接 fill / clip 的 Path2D（已缩放平移）
  function path2d(key, size, cx, cy) {
    var b = build(key, size, cx, cy);
    var p = new Path2D(b.d);
    if (typeof DOMMatrix === 'function') {
      var m = new Path2D();
      m.addPath(p, new DOMMatrix().translate(b.tx, b.ty).scale(b.scale, b.scale));
      return m;
    }
    return new Path2D(scaleD(b.d, b.scale, b.tx, b.ty));   // 无 DOMMatrix 时兜底
  }

  // 手工把 d 里的坐标对缩放平移（本文件的命令集都是成对的绝对坐标）
  function scaleD(d, s, tx, ty) {
    return d.replace(/(-?\d*\.?\d+)\s+(-?\d*\.?\d+)/g, function (_, a, b) {
      return f((+a) * s + tx) + ' ' + f((+b) * s + ty);
    });
  }

  // ---------- 安全缩放比 ----------
  var ratioCache = {};
  var SAFETY = 1.015;

  function contains(ctx, path, cx, cy, half, samples) {
    for (var i = 0; i < samples; i++) {
      var t = i / samples;
      var pts = [
        [cx - half + 2 * half * t, cy - half],
        [cx + half, cy - half + 2 * half * t],
        [cx + half - 2 * half * t, cy + half],
        [cx - half, cy + half - 2 * half * t]
      ];
      for (var k = 0; k < 4; k++) {
        if (!ctx.isPointInPath(path, pts[k][0], pts[k][1])) return false;
      }
    }
    return true;
  }

  var scratch = null;
  function scratchCtx() {
    if (!scratch && typeof document !== 'undefined') {
      var c = document.createElement('canvas');
      c.width = 1; c.height = 1;
      scratch = c.getContext('2d');
    }
    return scratch;
  }

  // 把边长 code 的正方形完整包住，形状包围盒至少要是 code 的多少倍
  function fitRatio(key) {
    if (key === 'square') return 1;
    if (ratioCache[key] != null) return ratioCache[key];
    var ctx = scratchCtx();
    if (!ctx) return 1;

    var code = 1000, half = code / 2, cx = 0, cy = 0, found = 0;
    for (var r = 1.0; r <= 3.001; r += 0.01) {
      if (contains(ctx, path2d(key, code * r, cx, cy), cx, cy, half, 24)) { found = r; break; }
    }
    if (!found) found = 3.0;
    var ratio = Math.min(3.0, found * SAFETY);
    ratioCache[key] = ratio;
    return ratio;
  }

  function name(key) {
    for (var i = 0; i < LIST.length; i++) if (LIST[i].k === key) return LIST[i].n;
    return '方形';
  }

  root.FrameShapes = {
    list: LIST,
    keys: LIST.map(function (x) { return x.k; }),
    name: name,
    unitPath: unitPath,
    build: build,
    path2d: path2d,
    fitRatio: fitRatio,
    _contains: contains,
    _petal: petal
  };
})(typeof window !== 'undefined' ? window : this);
