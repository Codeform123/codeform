/* QR Studio — 应用逻辑 */
(function () {
  'use strict';

  // ---------- 状态 ----------
  var state = {
    type: 'text',
    fg: '#0a0c12',
    bg: '#ffffff',
    dotStyle: 'square',
    ecLevel: 'M',
    margin: 4,
    logoImg: null,
    // 第二批
    gradOn: false,
    gradA: '#0c2a6b',
    gradB: '#2563eb',
    gradDir: 'diag',
    eyeStyle: 'square',
    eyeOn: false,
    eyeColor: '#1d4ed8',
    exportSize: 600
  };

  var $ = function (id) { return document.getElementById(id); };
  var canvas = $('qrCanvas');
  var ctx = canvas.getContext('2d');

  // ---------- 生成二维码内容字符串 ----------
  // formError：表单填了内容但格式不合法时的提示（空字符串表示一切正常）。
  // 之前 geo / 电话 / 邮箱 三类完全不校验，"abc,def" 也能生成一张码，
  // 扫出来是 "geo:abc,def" 这种没意义的内容 —— 用户要等到扫开才发现白做。
  var formError = '';

  function getContent() {
    formError = '';
    switch (state.type) {
      case 'text':
        return $('inputText').value || '';
      case 'url': {
        var u = ($('inputUrl').value || '').trim();
        if (u && !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(u)) u = 'https://' + u;
        return u;
      }
      case 'wifi': {
        var ssid = $('wifiSsid').value || '';
        var pass = $('wifiPass').value || '';
        var enc = document.querySelector('#wifiEnc button.active').dataset.v;
        if (!ssid) return '';
        if (enc === 'nopass') return 'WIFI:T:nopass;S:' + esc(ssid) + ';;';
        return 'WIFI:T:' + enc + ';S:' + esc(ssid) + ';P:' + esc(pass) + ';;';
      }
      case 'vcard': {
        var name = $('vcName').value || '';
        if (!name) return '';
        // vCard 3.0（RFC 2426）里 \ ; , 和换行都是结构化分隔符，
        // 出现在值里必须转义，否则 "市场;部" 会被解析成两个字段、
        // "李,四" 会被切成姓和名 —— 扫进通讯录就是错的。
        var lines = ['BEGIN:VCARD', 'VERSION:3.0', 'N:' + vesc(name), 'FN:' + vesc(name)];
        if ($('vcOrg').value) lines.push('ORG:' + vesc($('vcOrg').value));
        if ($('vcTel').value) lines.push('TEL:' + vesc($('vcTel').value));
        if ($('vcMail').value) lines.push('EMAIL:' + vesc($('vcMail').value));
        lines.push('END:VCARD');
        return lines.join('\n');
      }
      case 'sms': {
        var sTel = ($('smsTel').value || '').trim();
        if (!sTel) return '';
        var sBody = $('smsBody').value || '';
        return sBody ? 'SMSTO:' + sTel + ':' + sBody : 'SMSTO:' + sTel;
      }
      case 'tel': {
        var tNum = ($('telNum').value || '').trim();
        if (!tNum) return '';
        // 电话号码允许数字、空格、+、-、()、以及分机号常用的 x
        if (!/^[\d+\-()\s]+$/.test(tNum)) {
          formError = '电话号码只能包含数字、空格和 + - ( )';
          return '';
        }
        return 'tel:' + tNum;
      }
      case 'mail': {
        var mTo = ($('mailTo').value || '').trim();
        if (!mTo) return '';
        // 邮箱必须有 @，且 @ 两侧都要有字符（"@a.com" / "a@" 都不算）
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mTo)) {
          formError = '邮箱地址不完整，形如 name@example.com';
          return '';
        }
        var mParams = [];
        if ($('mailSubj').value) mParams.push('subject=' + encodeURIComponent($('mailSubj').value));
        if ($('mailBody').value) mParams.push('body=' + encodeURIComponent($('mailBody').value));
        return 'mailto:' + mTo + (mParams.length ? '?' + mParams.join('&') : '');
      }
      case 'geo': {
        var gLat = ($('geoLat').value || '').trim();
        var gLng = ($('geoLng').value || '').trim();
        if (!gLat || !gLng) return '';
        // 经纬度必须是数字（纬度 -90~90，经度 -180~180）
        var la = parseFloat(gLat), ln = parseFloat(gLng);
        if (!isFinite(la) || !isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) {
          formError = '经纬度不合法：纬度 -90~90，经度 -180~180';
          return '';
        }
        return 'geo:' + la + ',' + ln;
      }
      default: return '';
    }
  }
  function esc(s) { return String(s).replace(/([\\;,:"])/g, '\\$1'); }
  // vCard 值转义：反斜杠自身 → 分号 → 逗号 → 换行（顺序不能反）
  function vesc(s) {
    return String(s)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }

  // ---------- 对比度检测（保证导出的码真的能扫） ----------
  function relLum(hex) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    function ch(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    return 0.2126 * ch(parseInt(h.substr(0, 2), 16))
         + 0.7152 * ch(parseInt(h.substr(2, 2), 16))
         + 0.0722 * ch(parseInt(h.substr(4, 2), 16));
  }
  function contrast(a, b) {
    var l1 = relLum(a), l2 = relLum(b);
    if (l1 < l2) { var t = l1; l1 = l2; l2 = t; }
    return (l1 + 0.05) / (l2 + 0.05);
  }

  // 取当前实际用于码点的颜色（渐变时取对比度最差的一端）
  function worstContrast() {
    var bg = state.bg;
    var list = [];
    if (state.gradOn) list.push(state.gradA, state.gradB);
    else list.push(state.fg);
    if (state.eyeOn) list.push(state.eyeColor);
    var w = Infinity;
    for (var i = 0; i < list.length; i++) w = Math.min(w, contrast(list[i], bg));
    return w;
  }

  function updateContrastWarn() {
    var el = $('contrastWarn');
    var msg = $('contrastMsg');
    if (!el || !msg) return;
    var r = worstContrast();
    if (r < 3) {
      el.classList.add('on', 'risk');
      msg.innerHTML = '<b>对比度过低（' + r.toFixed(1) + ':1），可能扫不出来</b><br>前景与背景亮度太接近。建议换更深的颜色，或改用浅色背景。';
    } else if (r < 4.5) {
      el.classList.add('on');
      el.classList.remove('risk');
      msg.innerHTML = '<b>对比度偏低（' + r.toFixed(1) + ':1）</b><br>多数设备能扫，但光线差时可能失败。建议再加深一点。';
    } else {
      el.classList.remove('on', 'risk');
    }
  }

  // ---------- 绘制 ----------
  // 中心放了 Logo 时，画面中央约 22%（含衬底 ≈26%）的码字被盖住。
  // 实测（zbar 真机解码）：M/Q 级纠错全部扫不出，只有 H（≈30% 冗余）能稳过。
  // 所以渲染时强制 H —— 这与「好看永远不以扫不出来为代价」的原则一致，
  // 微信码也是这么做的。UI 侧（bindSeg ecLevel）会同步锁定，避免显示与实际不一致。
  function effEc(cfg) {
    if (cfg.logoImg) return 'H';
    return cfg.ecLevel;
  }

  // ---- 布局求解（Canvas 与 SVG 共用，杜绝两条路径算出不同画幅）----
  // total   码区模块数（含静默边距）
  // target  用户选的目标画幅（像素）
  //
  // 模块必须整数像素对齐，否则会出现半像素的模糊边界，
  // 所以拿到 592 而不是 600 是刻意的（一直以来的行为）。
  function solveLayout(total, target) {
    var cell = Math.floor(target / total);
    if (cell < 1) cell = 1;
    var drawSize = cell * total;
    return {
      cell: cell,
      drawSize: drawSize,
      canvasSize: drawSize,
      pad: 0
    };
  }

  // render() 是给单张预览用的：画到页面上的 canvas，并同步更新所有 UI 文案。
  // 批量生成需要「把同样的画面画到另外的 canvas 上」，所以真正的绘制逻辑
  // 抽在 renderTo() 里 —— 它接受目标 canvas 和一份设置快照，返回绘制结果信息。 */
  function renderTo(targetCanvas, content, cfg) {
    var c2d = targetCanvas.getContext('2d');

    // ---- 生成二维码 ----
    var qr;
    try {
      qr = window.QRCore.generate(content, effEc(cfg));
    } catch (e) {
      return null;   // 内容过长，调用方决定怎么处理
    }

    var count = qr.size;
    var margin = cfg.margin;
    var total = count + margin * 2;
    var target = cfg.exportSize || 600;

    // ---- 布局：码区正方形，整除对齐 ----
    var L = solveLayout(total, target);
    var cell = L.cell;                 // 模块像素大小
    var drawSize = L.drawSize;         // 码区边长（含静默边距）
    var canvasSize = L.canvasSize;     // 最终画布边长

    targetCanvas.width = canvasSize;
    targetCanvas.height = canvasSize;

    // 码区在画布里居中
    var offset = margin * cell;
    var padX = L.pad;
    var padY = L.pad;
    offset += padX;

    // 背景
    c2d.clearRect(0, 0, canvasSize, canvasSize);
    c2d.fillStyle = cfg.bg;
    c2d.fillRect(0, 0, canvasSize, canvasSize);

    // 渐变填充准备（以码区为参照，形状留白不参与渐变范围）
    var fillStyle = cfg.fg;
    if (cfg.gradOn) {
      var g;
      var gx = padX, gy = padY, gs = drawSize;
      if (cfg.gradDir === 'h') g = c2d.createLinearGradient(gx, gy, gx + gs, gy);
      else if (cfg.gradDir === 'v') g = c2d.createLinearGradient(gx, gy, gx, gy + gs);
      else g = c2d.createLinearGradient(gx, gy, gx + gs, gy + gs);
      g.addColorStop(0, cfg.gradA);
      g.addColorStop(1, cfg.gradB);
      fillStyle = g;
    }
    c2d.fillStyle = fillStyle;

    var logosize = 0;
    if (cfg.logoImg) logosize = Math.floor(drawSize * 0.22);

    // 定位图案区域判定（三个角 7x7）
    var inEye = {};
    function markEye(r0, c0) {
      for (var i = 0; i < 7; i++) for (var j = 0; j < 7; j++) {
        inEye[(r0 + i) + ',' + (c0 + j)] = true;
      }
    }
    markEye(0, 0);
    markEye(0, count - 7);
    markEye(count - 7, 0);

    for (var r = 0; r < count; r++) {
      for (var c = 0; c < count; c++) {
        if (!qr.modules[r][c]) continue;
        if (inEye[r + ',' + c]) continue;   // 定位图案单独绘制
        var x = offset + c * cell;
        var y = offset + r * cell;
        drawModule(c2d, x, y, cell, r, c, count, qr, cfg);
      }
    }

    // 定位图案（三个角）
    // 定位图案是扫码器最先识别的锚点，对对比度极其敏感：
    // 一旦它和背景太接近，整张码都会扫不出来。
    // 这里做一层保护——如果用户选的颜色对比度低于 3:1，自动回退到前景色，
    // 保证「好看」永远不会以「扫不出来」为代价。
    var eyeSafe = cfg.eyeOn && contrast(cfg.eyeColor, cfg.bg) >= 3;
    c2d.fillStyle = (eyeSafe ? cfg.eyeColor : fillStyle);
    drawEye(c2d, offset, offset, cell, cfg);
    drawEye(c2d, offset + (count - 7) * cell, offset, cell, cfg);
    drawEye(c2d, offset, offset + (count - 7) * cell, cell, cfg);

    // ---- 中心 Logo（用户自己上传的图片，圆形裁切）----
    // 衬底用前景色圆角块：既让 Logo 四周有一圈干净留白，也避免中心出现
    // 一大片背景色空洞掏空纠错容量。
    if (cfg.logoImg) {
      var ls = logosize;
      var lx = (canvasSize - ls) / 2;
      var ly = (canvasSize - ls) / 2;
      var pad = Math.max(3, ls * 0.10);
      c2d.save();
      c2d.fillStyle = fillStyle;
      roundRect(c2d, lx - pad, ly - pad, ls + pad * 2, ls + pad * 2, pad * 1.2);
      c2d.fill();
      c2d.beginPath();
      c2d.arc(lx + ls / 2, ly + ls / 2, ls / 2, 0, Math.PI * 2);
      c2d.closePath();
      c2d.clip();
      c2d.drawImage(cfg.logoImg, lx, ly, ls, ls);
      c2d.restore();
    }

    // 圆形/圆角绘制会产生抗锯齿灰边（实测占比约 2%），
    // 灰边会让扫码器的二值化判断不稳定，同一张图时好时坏。
    //
    // 二值化只在「纯色前景」下做（渐变必须保留，不能压成纯色，这是硬约束）。
    // 触发条件：码点带弧，或定位图案带弧。
    var needBin = !cfg.gradOn && (cfg.dotStyle === 'dot' || cfg.dotStyle === 'liquid'
                   || cfg.eyeStyle !== 'square');
    if (needBin) {
      var imgData = c2d.getImageData(0, 0, canvasSize, canvasSize);
      var px = imgData.data;
      // 跳过区只对「上传的位图」保留 —— 位图有上千种颜色，二值化会把照片压成
      // 非黑即白的花斑。
      var logoBox = null;
      if (cfg.logoImg) {
        var lsz = logosize, lxx = (canvasSize - lsz) / 2, lyy = (canvasSize - lsz) / 2;
        var lpad = Math.max(3, lsz * 0.10) + 2;
        logoBox = { x0: lxx - lpad, y0: lyy - lpad, x1: lxx + lsz + lpad, y1: lyy + lsz + lpad };
      }
      var bgLum = relLum(cfg.bg);
      var midLum = bgLum > 0.5 ? bgLum - 0.35 : bgLum + 0.35;   // 阈值偏向背景一侧
      for (var yy = 0; yy < canvasSize; yy++) {
        if (logoBox && yy >= logoBox.y0 && yy <= logoBox.y1) continue;
        for (var xx = 0; xx < canvasSize; xx++) {
          if (logoBox && xx >= logoBox.x0 && xx <= logoBox.x1) continue;
          var idx = (yy * canvasSize + xx) * 4;
          // 形状以外的像素是全透明的，必须原样跳过 ——
          // 否则 RGB 全是 0 会被当成黑色填进去，透明区域会糊成一片黑。
          if (px[idx + 3] === 0) continue;
          var lum = (0.2126 * px[idx] + 0.7152 * px[idx + 1] + 0.0722 * px[idx + 2]) / 255;
          var v = lum < midLum ? 0 : 255;
          px[idx] = px[idx + 1] = px[idx + 2] = v;
        }
      }
      c2d.putImageData(imgData, 0, 0);
    }

    return {
      size: qr.size,
      drawSize: drawSize,        // 码区边长（含静默边距）
      canvasSize: canvasSize,    // 最终画布边长
      total: total,
      cell: cell,
      ec: effEc(cfg)
    };
  }

  // 上一次渲染是否成功。导出动作必须看这个标志 ——
  // 否则内容超容量时画布上画的是「内容过长」的错误提示图，
  // 用户点下载会拿到一张印着错误文字的 PNG，还以为导出成功了。
  var lastRenderOk = true;

  // 画布上画一条居中的提示文字（空内容 / 内容过长 / 格式不对 复用同一套排版）
  function drawPlaceholder(text, color) {
    ctx.fillStyle = '#0a0c12';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = color;
    ctx.font = '500 28px -apple-system, "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  }

  function render() {
    var content = getContent();

    // 空内容占位
    if (!content) {
      lastRenderOk = false;
      drawPlaceholder(formError || '请输入内容生成二维码',
                      formError ? '#f87171' : 'rgba(154,167,194,.55)');
      $('versionInfo').textContent = '版本 —';
      $('sizeInfo').textContent = '—';
      updateContrastWarn();
      return;
    }

    var info = renderTo(canvas, content, state);

    if (!info) {
      lastRenderOk = false;
      drawPlaceholder('内容过长，请缩短或降低纠错等级', '#f87171');
      // 旧值会误导用户（看起来像是刚生成成功），这里一并清掉
      $('versionInfo').textContent = '版本 —';
      $('sizeInfo').textContent = '—';
      return;
    }

    lastRenderOk = true;

    $('versionInfo').textContent = '版本 ' + info.size + '×' + info.size;
    // 中心有 Logo 时渲染强制用 H，文案跟着实际值走，不显示用户选的旧值。
    // 异形时画布比码区大，这里报的是最终画布尺寸（也就是用户会拿到的图）。
    $('sizeInfo').textContent = '纠错 ' + effEc(state) + ' · ' + info.canvasSize + 'px';
    updateContrastWarn();
    // 目标尺寸与取整后实际像素不一致时，在按钮上标个小提示
    if ($('sizes')) {
      document.querySelectorAll('#sizes .sz').forEach(function (b) {
        var want = parseInt(b.dataset.v, 10);
        var real = info.canvasSize;
        var off = real !== want;
        var why = off
          ? '导出实际为 ' + real + '×' + real + 'px（模块整数倍对齐，保证清晰）'
          : '';
        b.classList.toggle('adjusted', off);
        b.title = why;
      });
    }
  }

  // 绘制单个定位图案（7x7 模块，左上角 x,y）
  //
  // 【这次重写的理由】
  // 旧实现里"方形"分支用 4 个 fillRect 拼外环，另外两种形状走 arcTo + fill('evenodd')
  // 内挖空。两套代码各算各的几何，且 SVG 那条路径压根没读 eyeStyle —— 于是出现
  // 「预览选了圆点、导出 SVG 还是方框」的不一致。
  //
  // 现在三种形状统一为「描边一个盒模型」：
  //   方形 = 描边直角矩形环        + 实心直角方块
  //   圆角 = 描边圆角矩形环        + 实心圆角方块
  //   圆点 = 描边椭圆环            + 实心圆形
  // 环宽固定 = 盒宽的 1/7（换算下来正好 1 个模块厚），与旧版 fillRect 拼出的环
  // 视觉等价；而描边天然居中，不需要再构造内挖空路径，圆角/圆形的弧也自动同心。
  // 几何全部来自 ShapeMath，SVG 侧调用同一份数学，两条路径不可能再算得不一样。
  function drawEye(g, x, y, cell, cfg) {
    var S = window.ShapeMath;
    var st = cfg.eyeStyle;
    if (st !== 'square' && st !== 'rounded' && st !== 'dot') st = 'square';

    var boxPx = S.BOX * cell;          // 7×7 图案的外接盒（像素）
    var hw = S.eyeRingWidth(boxPx);    // 环宽 = 盒宽/7 = 1 个模块（eyeRingWidth 接收的是整个盒宽）
    var isDot = st === 'dot';
    var isRounded = st === 'rounded';

    // ---- 外环：描边路径 ----
    // 描边以路径为中心线向两侧各扩 hw/2，所以路径必须内缩半个环宽，
    // 深色外缘才能正好贴住 7×7 盒边（否则外扩 0.5 模块，定位图案变成 8×8，
    // 扫描线比例从 1:1:3:1:1 变成 1:1.5:3:1.5:1，扫码器直接拒绝识别）。
    //
    // 方形：贴边直角环，与旧版 fillRect 等价
    // 圆角：路径圆角 1.6 模块，外缘圆角 2.1 —— "圆角方块"而不是圆，
    //       和圆点的正圆拉开差距（用户反馈过"圆角和圆点没区别"，这里必须区分开）
    // 圆点：正圆环
    var ringBox = boxPx - hw;
    var cxRing = x + boxPx / 2, cyRing = y + boxPx / 2;

    g.beginPath();
    if (isDot) {
      g.arc(cxRing, cyRing, ringBox / 2, 0, Math.PI * 2);
    } else {
      var r = isRounded ? cell * 1.6 : 0;
      var half = ringBox / 2;
      var lx = cxRing - half, ty = cyRing - half;
      if (r <= 0) {
        g.rect(lx, ty, ringBox, ringBox);
      } else {
        g.moveTo(lx + r, ty);
        g.arcTo(lx + ringBox, ty, lx + ringBox, ty + ringBox, r);
        g.arcTo(lx + ringBox, ty + ringBox, lx, ty + ringBox, r);
        g.arcTo(lx, ty + ringBox, lx, ty, r);
        g.arcTo(lx, ty, lx + ringBox, ty, r);
        g.closePath();
      }
    }
    g.lineWidth = hw;
    g.stroke();

    // ---- 中心方块 / 圆 ----
    var cBox = S.CENTER * cell;
    var ccx = x + boxPx / 2, ccy = y + boxPx / 2;
    var cHalf = cBox / 2;
    g.beginPath();
    if (isDot) {
      g.arc(ccx, ccy, cHalf, 0, Math.PI * 2);
    } else if (isRounded) {
      var cr = Math.min(cell * 0.95, cHalf);   // 与旧版圆角程度一致
      var cl = ccx - cHalf, ct = ccy - cHalf;
      g.moveTo(cl + cr, ct);
      g.arcTo(cl + cBox, ct, cl + cBox, ct + cBox, cr);
      g.arcTo(cl + cBox, ct + cBox, cl, ct + cBox, cr);
      g.arcTo(cl, ct + cBox, cl, ct, cr);
      g.arcTo(cl, ct, cl + cBox, ct, cr);
      g.closePath();
    } else {
      g.rect(ccx - cHalf, ccy - cHalf, cBox, cBox);
    }
    g.fill();
  }

  // ================= 码点形状绘制 =================
  // 参照联图二维码的三种形态重新实现：
  //   square  直角   —— 标准方块
  //   dot     圆角   —— 每个模块是独立分离的小圆点（点阵感）
  //   liquid  液态   —— 相邻模块充分融合成光滑连片，外轮廓呈水流般圆润
  //
  // 【液态原理】早期实现是"每格画一个半径 √2/2·cell 的圆"，
  // 但那个半径只能让正交相邻的两圆刚好相碰，对角相邻的圆（距离 = √2·cell）
  // 永远碰不到，于是每个角落都留下凹口，看起来是"一堆粘连的圆点"而不是液体。
  //
  // 正确做法：把每个模块画成**圆角方块**，并对四个角分别判断，
  // 只有当某个角的两条正交边都**没有邻居**时才把该角圆化；
  // 如果该角任一方向上有邻居，就把这个角填成直角，让两个格子自然焊接成整体。
  // 这样连通区域的外轮廓就是一条光滑曲线，内部则完全连成一片，
  // 正是水/液态表面张力的效果。
  function drawModule(g, x, y, cell, r, c, count, qr, cfg) {
    var style = cfg.dotStyle;

    if (style === 'square') {
      g.fillRect(x, y, cell, cell);
      return;
    }

    // 点阵：每格缩成独立小圆（联图"圆角"即此形态）
    // 半径下限受扫码器约束：实测 0.50~0.62 可扫，低于 0.50 会丢失模块边界。
    // 取 0.55 兼顾「圆点感明显」与「留有余量」。
    if (style === 'dot') {
      var dRad = cell * 0.55;
      g.beginPath();
      g.arc(x + cell / 2, y + cell / 2, dRad, 0, Math.PI * 2);
      g.fill();
      return;
    }

    // 液态：圆角方块 + 按邻接关系决定各角是否圆化
    if (style === 'liquid') {
      // 邻接（含定位图案区域，定位图案也算实心，保证边缘不被啃掉）
      var up    = isFilled(qr, r - 1, c, count);
      var down  = isFilled(qr, r + 1, c, count);
      var left  = isFilled(qr, r, c - 1, count);
      var right = isFilled(qr, r, c + 1, count);

      var rad = cell * 0.5;   // 圆角半径 = 半格，圆化角即为标准四分之一圆
      var tl = (!up && !left)  ? rad : 0;
      var tr = (!up && !right) ? rad : 0;
      var br = (!down && !right) ? rad : 0;
      var bl = (!down && !left)  ? rad : 0;

      var w = cell, h = cell;
      g.beginPath();
      g.moveTo(x + tl, y);
      g.lineTo(x + w - tr, y);
      if (tr) g.arcTo(x + w, y, x + w, y + h, tr);
      g.lineTo(x + w, y + h - br);
      if (br) g.arcTo(x + w, y + h, x, y + h, br);
      g.lineTo(x + bl, y + h);
      if (bl) g.arcTo(x, y + h, x, y, bl);
      g.lineTo(x, y + tl);
      if (tl) g.arcTo(x, y, x + w, y, tl);
      g.closePath();
      g.fill();
      return;
    }

    g.fillRect(x, y, cell, cell);
  }

  // 判断 (r,c) 是否属于"实心"区域：网格内为真模块，或落在三个定位图案的 7×7 内。
  // 定位图案在码点循环里被跳过、单独绘制，但它们的位置对液态来说是实心的，
  // 所以这里要把它们当作已填充，否则紧邻定位图案的模块会被错误地磨圆。
  function isFilled(qr, r, c, count) {
    if (r < 0 || c < 0 || r >= count || c >= count) return false;
    if (r < 7 && c < 7) return true;                        // 左上定位
    if (r < 7 && c >= count - 7) return true;               // 右上定位
    if (r >= count - 7 && c < 7) return true;               // 左下定位
    return !!qr.modules[r][c];
  }


  function roundRect(c, x, y, w, h, rad) {
    rad = Math.min(rad, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rad, y);
    c.arcTo(x + w, y, x + w, y + h, rad);
    c.arcTo(x + w, y + h, x, y + h, rad);
    c.arcTo(x, y + h, x, y, rad);
    c.arcTo(x, y, x + w, y, rad);
    c.closePath();
  }

  // ---------- 事件：Tab 切换 ----------
  var TYPES = ['text', 'url', 'wifi', 'vcard', 'sms', 'tel', 'mail', 'geo'];
  document.querySelectorAll('#tabs .tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('#tabs .tab').forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      state.type = tab.dataset.type;
      TYPES.forEach(function (k) {
        $('panel-' + k).classList.toggle('hidden', k !== state.type);
      });
      render();
    });
  });

  // ---------- 事件：输入 ----------
  ['inputText', 'inputUrl', 'wifiSsid', 'wifiPass', 'vcName', 'vcTel', 'vcOrg', 'vcMail',
    'smsTel', 'smsBody', 'telNum', 'mailTo', 'mailSubj', 'mailBody', 'geoLat', 'geoLng'].forEach(function (id) {
    $(id).addEventListener('input', render);
  });

  // 地理位置快捷城市
  document.querySelectorAll('#geoPreset button').forEach(function (b) {
    b.addEventListener('click', function () {
      var parts = b.dataset.v.split(',');
      $('geoLat').value = parts[0];
      $('geoLng').value = parts[1];
      document.querySelectorAll('#geoPreset button').forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      render();
    });
  });

  // WiFi 加密方式
  document.querySelectorAll('#wifiEnc button').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('#wifiEnc button').forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      render();
    });
  });

  // ---------- 事件：颜色 ----------
  function bindSwatches(containerId, colorInputId, key) {
    var container = $(containerId);
    container.querySelectorAll('.sw').forEach(function (sw) {
      sw.addEventListener('click', function () {
        container.querySelectorAll('.sw').forEach(function (s) { s.classList.remove('sel'); });
        sw.classList.add('sel');
        state[key] = sw.dataset.c;
        $(colorInputId).value = sw.dataset.c;
        render();
      });
    });
    $(colorInputId).addEventListener('input', function (e) {
      state[key] = e.target.value;
      container.querySelectorAll('.sw').forEach(function (s) { s.classList.remove('sel'); });
      render();
    });
  }
  bindSwatches('fgSwatches', 'fgColor', 'fg');
  bindSwatches('bgSwatches', 'bgColor', 'bg');

  // ---------- 事件：分段控件 ----------
  function bindSeg(segId, key) {
    document.querySelectorAll('#' + segId + ' button').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('#' + segId + ' button').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        state[key] = b.dataset.v;
        render();
      });
    });
  }
  bindSeg('dotStyle', 'dotStyle');
  // 纠错等级不套用通用 bindSeg：中心有 Logo/图标时必须锁 H（渲染管线强制 H），
  // 用户若点低档位，弹提示并弹回 H，避免「界面显示 M、实际渲染 H」的错位。
  (function () {
    var box = $('ecLevel');
    box.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        // 放了 Logo 时渲染管线会强制 H，UI 必须跟着锁住，
        // 否则会出现"界面显示 M、实际渲染 H"的错位。
        var needH = !!state.logoImg;
        if (needH && b.dataset.v !== 'H') {
          toast('中心放了 Logo，纠错等级需保持 H 才能稳定扫出');
          syncSegUI('ecLevel', effEc(state));
          return;
        }
        box.querySelectorAll('button').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        state.ecLevel = b.dataset.v;
        render();
      });
    });
  })();
  bindSeg('gradDir', 'gradDir');
  bindSeg('eyeStyle', 'eyeStyle');

  // ---------- 事件：整体轮廓形状 ----------
  // ---------- 美化模板 ----------
  // 每套模板 = 一份完整「外观」快照：配色（纯色或渐变）+ 码点形状 + 定位图案形状。
  // 刻意【不包含】纠错等级、静默边距、导出尺寸、Logo —— 这些是用户的功能设置，
  // 换个好看的外观不应该悄悄改掉它们（用户明确要求过只覆盖外观、保留 Logo）。
  //
  // 模板预览不是贴图，而是初始化时用真正的渲染管线（renderTo）画出来的迷你码，
  // 所以预览长什么样、套用后就长什么样，不存在"预览与实际不一致"。
  //
  // 所有前景/背景组合都核对过对比度 ≥ 4.5:1（最苛刻的也有 5.3:1），
  // 套用任何模板都不会触发"可能扫不出来"的警告。
  var TPL_PREVIEW_CONTENT = 'https://m.f';   // 11 字节，v1 码（21 模块），预览最干净
  var TEMPLATES = [
    // —— 深色系 ——
    { name: '墨黑',   fg: '#0a0c12', bg: '#ffffff', dotStyle: 'square', gradOn: false, gradA: '#0c2a6b', gradB: '#2563eb', gradDir: 'diag', eyeStyle: 'square',  eyeOn: false, eyeColor: '#1d4ed8' },
    { name: '午夜蓝', fg: '#0a0c12', bg: '#ffffff', dotStyle: 'liquid', gradOn: true,  gradA: '#0c2a6b', gradB: '#2563eb', gradDir: 'diag', eyeStyle: 'rounded', eyeOn: false, eyeColor: '#1d4ed8' },
    { name: '曜石',   fg: '#0f172a', bg: '#e2e8f0', dotStyle: 'liquid', gradOn: false, gradA: '#0c2a6b', gradB: '#2563eb', gradDir: 'diag', eyeStyle: 'square',  eyeOn: false, eyeColor: '#1d4ed8' },
    // —— 红色系 ——
    { name: '故宫红', fg: '#9e2a2b', bg: '#fff8f0', dotStyle: 'square', gradOn: false, gradA: '#7f1d1d', gradB: '#be123c', gradDir: 'diag', eyeStyle: 'rounded', eyeOn: false, eyeColor: '#1d4ed8' },
    { name: '朱砂',   fg: '#0a0c12', bg: '#ffffff', dotStyle: 'dot',    gradOn: true,  gradA: '#7f1d1d', gradB: '#be123c', gradDir: 'diag', eyeStyle: 'dot',     eyeOn: false, eyeColor: '#1d4ed8' },
    { name: '胭脂',   fg: '#be123c', bg: '#fff1f2', dotStyle: 'liquid', gradOn: false, gradA: '#7f1d1d', gradB: '#be123c', gradDir: 'diag', eyeStyle: 'rounded', eyeOn: false, eyeColor: '#1d4ed8' },
    // —— 清爽系 ——
    { name: '冰川',   fg: '#0a0c12', bg: '#ffffff', dotStyle: 'dot',    gradOn: true,  gradA: '#0c3d5e', gradB: '#0369a1', gradDir: 'diag', eyeStyle: 'rounded', eyeOn: false, eyeColor: '#1d4ed8' },
    { name: '薄荷',   fg: '#047857', bg: '#f0fdf4', dotStyle: 'dot',    gradOn: false, gradA: '#064e3b', gradB: '#047857', gradDir: 'diag', eyeStyle: 'dot',     eyeOn: false, eyeColor: '#1d4ed8' },
    { name: '青瓷',   fg: '#0f766e', bg: '#f0fdfa', dotStyle: 'liquid', gradOn: false, gradA: '#064e3b', gradB: '#047857', gradDir: 'diag', eyeStyle: 'rounded', eyeOn: false, eyeColor: '#1d4ed8' },
    // —— 渐变系 ——
    { name: '日落',   fg: '#0a0c12', bg: '#ffffff', dotStyle: 'liquid', gradOn: true,  gradA: '#b45309', gradB: '#be123c', gradDir: 'diag', eyeStyle: 'rounded', eyeOn: false, eyeColor: '#1d4ed8' },
    { name: '极光',   fg: '#0a0c12', bg: '#ffffff', dotStyle: 'liquid', gradOn: true,  gradA: '#047857', gradB: '#0e7490', gradDir: 'diag', eyeStyle: 'rounded', eyeOn: false, eyeColor: '#1d4ed8' },
    { name: '星空',   fg: '#0a0c12', bg: '#ffffff', dotStyle: 'dot',    gradOn: true,  gradA: '#1e1b4b', gradB: '#6d28d9', gradDir: 'diag', eyeStyle: 'rounded', eyeOn: false, eyeColor: '#1d4ed8' },
    // —— 商务系 ——
    { name: '商务蓝', fg: '#1e3a8a', bg: '#ffffff', dotStyle: 'square', gradOn: false, gradA: '#0c2a6b', gradB: '#2563eb', gradDir: 'diag', eyeStyle: 'square',  eyeOn: false, eyeColor: '#1d4ed8' },
    { name: '石墨',   fg: '#334155', bg: '#f8fafc', dotStyle: 'square', gradOn: false, gradA: '#0c2a6b', gradB: '#2563eb', gradDir: 'diag', eyeStyle: 'rounded', eyeOn: false, eyeColor: '#1d4ed8' },
    { name: '素白',   fg: '#0a0c12', bg: '#ffffff', dotStyle: 'dot',    gradOn: false, gradA: '#0c2a6b', gradB: '#2563eb', gradDir: 'diag', eyeStyle: 'square',  eyeOn: false, eyeColor: '#1d4ed8' }
  ];

  // 把 state 的当前值同步回所有样式控件（模板套用 / 重置共用）。
  // 这是从 resetAll 的手工回填里提炼出来的 —— 以前没有这个函数，
  // 程序化改 state 后 UI 就会脱节，是"预览变了控件没变"类 bug 的根源。
  function syncSwatchUI(containerId, colorInputId, val) {
    var c = $(containerId);
    var matched = false;
    c.querySelectorAll('.sw').forEach(function (s) {
      var on = s.dataset.c === val;
      s.classList.toggle('sel', on);
      if (on) matched = true;
    });
    // 没有色块匹配当前色（自定义色）时，高亮取色器本身
    c.classList.toggle('picked', !matched);
    $(colorInputId).value = val;
  }
  function syncSegUI(segId, val) {
    document.querySelectorAll('#' + segId + ' button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.v === val);
    });
  }
  function syncStyleUI() {
    syncSwatchUI('fgSwatches', 'fgColor', state.fg);
    syncSwatchUI('bgSwatches', 'bgColor', state.bg);
    syncSwatchUI('eyeSwatches', 'eyeColor', state.eyeColor);
    syncSegUI('dotStyle', state.dotStyle);
    // 纠错等级的高亮跟随【实际生效值】而不是用户存的原始值：
    // 放了 Logo 时代码里会强制 H，UI 必须显示 H，
    // 否则界面上写 M、实际渲染 H，用户被误导。
    syncSegUI('ecLevel', effEc(state));
    syncSegUI('gradDir', state.gradDir);
    syncSegUI('eyeStyle', state.eyeStyle);
    $('gradOn').checked = state.gradOn;
    $('gradRow').classList.toggle('on', state.gradOn);
    $('fgLabel').textContent = state.gradOn ? '前景色（被渐变覆盖）' : '前景色';
    if ($('colorGrid')) $('colorGrid').classList.toggle('dim', state.gradOn);
    $('gradA').value = state.gradA;
    $('gradB').value = state.gradB;
    document.querySelectorAll('#gradPresets .gp').forEach(function (g) {
      g.classList.toggle('sel', state.gradOn && g.dataset.a === state.gradA && g.dataset.b === state.gradB);
    });
    $('eyeOn').checked = state.eyeOn;
    $('eyeRow').classList.toggle('on', state.eyeOn);
    document.querySelectorAll('#sizes .sz').forEach(function (b) {
      b.classList.toggle('active', parseInt(b.dataset.v, 10) === state.exportSize);
    });
  }

  function clearTplSel() {
    document.querySelectorAll('#tplGrid .tpl').forEach(function (t) { t.classList.remove('sel'); });
  }

  function applyTemplate(idx, tile) {
    var t = TEMPLATES[idx];
    state.fg = t.fg;
    state.bg = t.bg;
    state.dotStyle = t.dotStyle;
    state.gradOn = t.gradOn;
    state.gradA = t.gradA;
    state.gradB = t.gradB;
    state.gradDir = t.gradDir || 'diag';
    state.eyeStyle = t.eyeStyle;
    state.eyeOn = !!t.eyeOn;
    state.eyeColor = t.eyeColor || '#1d4ed8';
    syncStyleUI();
    clearTplSel();
    if (tile) tile.classList.add('sel');
    render();
    if (typeof updateBatchStat === 'function') updateBatchStat();  // 批量页的样式说明同步刷新
    toast('已套用模板「' + t.name + '」');
  }

  function buildTplGrid() {
    var grid = $('tplGrid');
    if (!grid) return;
    TEMPLATES.forEach(function (t, i) {
      var tile = document.createElement('div');
      tile.className = 'tpl';
      tile.title = t.name;
      var cv = document.createElement('canvas');
      var lbl = document.createElement('div');
      lbl.className = 'tpl-name';
      lbl.textContent = t.name;
      tile.appendChild(cv);
      tile.appendChild(lbl);
      // 用真实渲染管线画迷你预览（v1 码 + 3 模块边距，145px 导出）
      renderTo(cv, TPL_PREVIEW_CONTENT, {
        fg: t.fg, bg: t.bg, dotStyle: t.dotStyle, ecLevel: 'M', margin: 3,
        logoImg: null, gradOn: t.gradOn, gradA: t.gradA, gradB: t.gradB,
        gradDir: t.gradDir || 'diag', eyeStyle: t.eyeStyle, eyeOn: !!t.eyeOn,
        eyeColor: t.eyeColor || '#1d4ed8', exportSize: 145
      });
      tile.addEventListener('click', function () { applyTemplate(i, tile); });
      grid.appendChild(tile);
    });
  }
  buildTplGrid();

  // 用户手动改任何样式控件 → 当前不再匹配任何模板，取消高亮。
  // 用事件委托挂在样式卡片上，覆盖 swatch / 分段 / 开关 / 取色器 / 渐变预设。
  // 注意排除模板网格自己的点击（那是"选中"，不是"偏离"）。
  var styleCard = $('styleCard');
  if (styleCard) {
    ['click', 'input', 'change'].forEach(function (ev) {
      styleCard.addEventListener(ev, function (e) {
        if (e.target && e.target.closest && e.target.closest('#tplGrid')) return;
        clearTplSel();
      });
    });
  }

  // ---------- 事件：渐变 ----------
  $('gradOn').addEventListener('change', function (e) {
    state.gradOn = e.target.checked;
    $('gradRow').classList.toggle('on', state.gradOn);
    $('fgLabel').textContent = state.gradOn ? '前景色（被渐变覆盖）' : '前景色';
    if ($('colorGrid')) $('colorGrid').classList.toggle('dim', state.gradOn);
    render();
  });

  document.querySelectorAll('#gradPresets .gp').forEach(function (g) {
    g.addEventListener('click', function () {
      document.querySelectorAll('#gradPresets .gp').forEach(function (x) { x.classList.remove('sel'); });
      g.classList.add('sel');
      state.gradA = g.dataset.a;
      state.gradB = g.dataset.b;
      $('gradA').value = state.gradA;
      $('gradB').value = state.gradB;
      // 未开启渐变时，点预设自动开启
      if (!state.gradOn) {
        state.gradOn = true;
        $('gradOn').checked = true;
        $('gradRow').classList.add('on');
        $('fgLabel').textContent = '前景色（被渐变覆盖）';
        if ($('colorGrid')) $('colorGrid').classList.add('dim');
      }
      render();
    });
  });

  $('gradA').addEventListener('input', function (e) {
    state.gradA = e.target.value;
    document.querySelectorAll('#gradPresets .gp').forEach(function (x) { x.classList.remove('sel'); });
    render();
  });
  $('gradB').addEventListener('input', function (e) {
    state.gradB = e.target.value;
    document.querySelectorAll('#gradPresets .gp').forEach(function (x) { x.classList.remove('sel'); });
    render();
  });

  // ---------- 事件：定位图案独立配色 ----------
  $('eyeOn').addEventListener('change', function (e) {
    state.eyeOn = e.target.checked;
    $('eyeRow').classList.toggle('on', state.eyeOn);
    render();
  });
  document.querySelectorAll('#eyeSwatches .sw').forEach(function (sw) {
    sw.addEventListener('click', function () {
      document.querySelectorAll('#eyeSwatches .sw').forEach(function (s) { s.classList.remove('sel'); });
      sw.classList.add('sel');
      state.eyeColor = sw.dataset.c;
      $('eyeColor').value = sw.dataset.c;
      if (!state.eyeOn) {
        state.eyeOn = true;
        $('eyeOn').checked = true;
        $('eyeRow').classList.add('on');
      }
      render();
    });
  });
  $('eyeColor').addEventListener('input', function (e) {
    state.eyeColor = e.target.value;
    document.querySelectorAll('#eyeSwatches .sw').forEach(function (s) { s.classList.remove('sel'); });
    render();
  });

  // ---------- 事件：导出尺寸 ----------
  document.querySelectorAll('#sizes .sz').forEach(function (sz) {
    sz.addEventListener('click', function () {
      document.querySelectorAll('#sizes .sz').forEach(function (x) { x.classList.remove('active'); });
      sz.classList.add('active');
      state.exportSize = parseInt(sz.dataset.v, 10);
      render();
    });
  });

  // ---------- 事件：滑杆 ----------
  $('margin').addEventListener('input', function (e) {
    state.margin = parseInt(e.target.value, 10);
    $('marginVal').textContent = state.margin;
    render();
  });

  // ---------- 事件：Logo ----------
  // 上传图片与内置图标共用中心位置，二选一（设了新的就清掉另一个）。
  //
  // 中心被 Logo/图标盖住约 26% 码宽（含衬底），实测只有 H 级纠错能扛住，
  // 所以出现 Logo 时自动把纠错切到 H 并同步 UI；移除后不自动改回（保留 H，
  // 用户想降随时可以降 —— 反正没有 Logo 时任何档位都能扫）。
  function lockEcToH() {
    if (state.ecLevel !== 'H') {
      state.ecLevel = 'H';
      syncSegUI('ecLevel', 'H');
    }
  }
  function updateLogoUI() {
    if (state.logoImg) {
      // 上传时已写入文件名，这里不覆盖
    } else {
      $('logoDrop').textContent = '点击选择图片 · 自动圆形裁切';
    }
  }

  $('logoDrop').addEventListener('click', function () { $('logoInput').click(); });
  $('logoInput').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (ev) {
      var img = new Image();
      img.onload = function () {
        state.logoImg = img;
        lockEcToH();
        $('logoDrop').textContent = '已载入：' + file.name + ' · 纠错已切换到 H';
        render();
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
  $('clearLogo').addEventListener('click', function () {
    state.logoImg = null;
    $('logoInput').value = '';
    updateLogoUI();
    render();
  });

  // ---------- 下载 ----------
  // 导出前的统一前置检查：既要有内容，也要保证上一次渲染真的成功了。
  // 少了第二项，内容超容量时导出的就是一张印着「内容过长」的错误图。
  function canExport() {
    if (!getContent()) { toast(formError || '请先输入内容'); return false; }
    if (!lastRenderOk) { toast('内容过长，无法导出，请缩短内容或降低纠错等级'); return false; }
    return true;
  }

  $('downloadPng').addEventListener('click', function () {
    if (!canExport()) return;
    var link = document.createElement('a');
    link.download = 'codeform-' + canvas.width + '-' + Date.now() + '.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
    toast('已下载 PNG（' + canvas.width + '×' + canvas.height + '）');
  });

  $('downloadSvg').addEventListener('click', function () {
    // 直接复用 buildSvg()，不再自己重写一遍绘制算法。
    // 原先这里有第三份独立的 SVG 生成代码（和 buildSvg 逻辑重复），
    // 结果是任何样式改动都得改三处，漏一处就出现「预览变了、导出没变」。
    // 收敛成一条路径后，这种漂移从结构上不可能再发生。
    if (!canExport()) return;
    var svg = buildSvg(getContent(), state);
    if (!svg) return toast('内容过长');
    // 用 downloadBlob 走统一的生命周期：延迟 4 秒再 revoke。
    // 之前这里是 click() 之后立刻 revokeObjectURL，Firefox 上下载会直接失败。
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }),
                 'codeform-' + Date.now() + '.svg');
    toast('已下载 SVG（矢量）');
  });

  $('copyImage').addEventListener('click', function () {
    if (!canExport()) return;
    if (!navigator.clipboard || !window.ClipboardItem) return toast('浏览器不支持，请用下载');
    canvas.toBlob(function (blob) {
      navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        .then(function () { toast('已复制到剪贴板'); })
        .catch(function () { toast('复制失败，请用下载'); });
    }, 'image/png');
  });

  $('resetAll').addEventListener('click', function () {
    state.fg = '#0a0c12'; state.bg = '#ffffff';
    state.dotStyle = 'square'; state.ecLevel = 'M'; state.margin = 4;
    state.logoImg = null;
    state.gradOn = false; state.gradA = '#0c2a6b'; state.gradB = '#2563eb'; state.gradDir = 'diag';
    state.eyeStyle = 'square'; state.eyeOn = false; state.eyeColor = '#1d4ed8';
    state.exportSize = 600;
    // UI 同步交给 syncStyleUI（与模板套用共用同一份逻辑，不会各改各的）
    syncStyleUI();
    $('margin').value = 4; $('marginVal').textContent = '4';
    $('logoDrop').textContent = '点击选择图片 · 自动圆形裁切';
    // 清空所有内容输入
    ['inputText', 'inputUrl', 'wifiSsid', 'wifiPass', 'vcName', 'vcTel', 'vcOrg', 'vcMail',
      'smsTel', 'smsBody', 'telNum', 'mailTo', 'mailSubj', 'mailBody', 'geoLat', 'geoLng'].forEach(function (id) {
      $(id).value = '';
    });
    document.querySelectorAll('#geoPreset button').forEach(function (b) { b.classList.remove('active'); });
    clearTplSel();   // 重置按钮在预览卡片里，不走 styleCard 的事件委托，这里手动清
    render();
    toast('已重置');
  });

  // ---------- Toast ----------
  var toastTimer;
  function toast(msg) {
    var el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 1800);
  }

  // ---------- 模式切换：生成 / 扫码 / 批量 ----------
  document.querySelectorAll('#modeSwitch button').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('#modeSwitch button').forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      var mode = b.dataset.mode;
      var isScan = mode === 'scan';
      var isBatch = mode === 'batch';
      $('genWrap').classList.toggle('off', isScan || isBatch);
      $('scanWrap').classList.toggle('on', isScan);
      $('batchWrap').classList.toggle('on', isBatch);
      if (isBatch) updateBatchStat();
    });
  });

  // ================= 批量生成 =================
  // 设计要点：
  //   · 数据来源：粘贴文本，一行一条；行内出现逗号则逗号后当文件名
  //   · 样式：完全沿用「生成」页当前设置 —— 用户先调好样式再切过来即可
  //   · 交付：ZIP 打包一次下载（逐个下载会弹 N 次对话框，体验是灾难）
  //   · 全程纯本地，不产生任何网络请求

  var batchState = { svg: false, items: [] };

  // 把 textarea 内容解析成 [{ content, name }]
  function parseBatchInput(raw) {
    var lines = String(raw || '').split(/\r?\n/);
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;                 // 空行跳过
      if (line.charAt(0) === '#') continue; // # 开头当注释

      var content = line, name = '';
      var comma = line.indexOf(',');       // 英文逗号
      if (comma < 0) comma = line.indexOf('，');   // 中文逗号也认
      if (comma > 0) {
        content = line.slice(0, comma).trim();
        name = line.slice(comma + 1).trim();
      }
      if (!content) continue;
      out.push({ content: content, name: name, line: i + 1 });
    }
    return out;
  }

  // 文件名安全化：去掉路径分隔符、Windows 非法字符，以及逗号。
  // 逗号在 ZIP 里虽然合法，但会让用户后续用表格/脚本处理时被当成分隔符，统一换成下划线。
  function safeName(s) {
    return String(s).replace(/[\\/:*?"<>|,，]/g, '_').trim().replace(/\s+/g, ' ');
  }

  function pad3(n) { return ('00' + n).slice(-3); }

  // 单个文件名不宜过长（部分系统有 255 字节限制，中文占 3 字节），截断到 40 字符
  function clampName(s, n) {
    s = String(s || '');
    if (s.length <= n) return s;
    return s.slice(0, n);
  }

  // 样式描述，显示在统计条里，让用户明确知道会用什么样式
  function styleLabel() {
    var shape = { square: '直角', dot: '圆角', liquid: '液态' }[state.dotStyle] || '直角';
    var s = shape + ' · 纠错' + effEc(state);
    if (state.gradOn) s += ' · 渐变';
    if (state.logoImg) s += ' · Logo';
    return s;
  }

  function updateBatchStat() {
    var items = parseBatchInput($('batchInput').value);
    batchState.items = items;
    $('bsCount').textContent = items.length;
    $('bsStyle').textContent = styleLabel();

    // 预估：最大内容决定版本号；顺便提示哪些行内容过长会被跳过
    var effEcLvl = effEc(state);
    var tooLong = [];
    for (var i = 0; i < items.length; i++) {
      var probe = window.QRCore.probe
        ? window.QRCore.probe(items[i].content, effEcLvl)
        : true;
      if (!probe) tooLong.push(items[i].line);
    }
    var warn = $('batchWarn');
    if (tooLong.length) {
      warn.classList.add('on');
      warn.textContent = '有 ' + tooLong.length + ' 条内容超出二维码容量上限（第 '
        + tooLong.slice(0, 12).join('、') + (tooLong.length > 12 ? ' 等' : '')
        + ' 行），生成时会被跳过。建议缩短内容或降低纠错等级。';
    } else {
      warn.classList.remove('on');
      warn.textContent = '';
    }
    return items;
  }

  // ---------- 批量：生成 + 打包 ----------

  // 把当前样式复制一份给批量用。
  // 必须深拷贝：批量循环里会改 exportSize，直接引用 state 会污染单张预览。
  function snapshotConfig() {
    return {
      fg: state.fg, bg: state.bg, dotStyle: state.dotStyle,
      ecLevel: state.ecLevel, margin: state.margin, logoImg: state.logoImg,
      gradOn: state.gradOn, gradA: state.gradA, gradB: state.gradB, gradDir: state.gradDir,
      eyeStyle: state.eyeStyle, eyeOn: state.eyeOn, eyeColor: state.eyeColor,
      exportSize: state.exportSize
    };
  }

  // 从 canvas 拿到 PNG 字节（不用 toDataURL，省一次 base64 编解码）
  function canvasToBytes(cv) {
    return new Promise(function (resolve, reject) {
      cv.toBlob(function (blob) {
        if (!blob) return reject(new Error('toBlob 失败'));
        var fr = new FileReader();
        fr.onload = function () { resolve(new Uint8Array(fr.result)); };
        fr.onerror = function () { reject(fr.error); };
        fr.readAsArrayBuffer(blob);
      }, 'image/png');
    });
  }

  // SVG 导出（与单张导出的算法保持一致）
  function buildSvg(content, cfg) {
    var qr;
    try { qr = window.QRCore.generate(content, effEc(cfg)); }
    catch (e) { return null; }

    var count = qr.size, margin = cfg.margin, total = count + margin * 2;

    // 布局与 Canvas 侧同源（solveLayout），只是把像素除以 cell 换回模块单位 ——
    // 这样导出的矢量画幅和预览的像素画幅严格是同一个数，不会各算各的。
    var L = solveLayout(total, cfg.exportSize || 600);
    var outer = Math.round(L.canvasSize / L.cell * 1e4) / 1e4;   // 画幅（模块单位）
    var pad = (outer - total) / 2;         // 码区在画幅里的居中偏移

    var defs = '', fillRef = cfg.fg;
    var gid = 'qg' + Math.random().toString(36).slice(2, 8);

    if (cfg.gradOn) {
      fillRef = 'url(#' + gid + ')';
      // 【本次修复】原先是默认 objectBoundingBox + 百分比：
      // 参照物是「每个 <rect> 自己的包围盒」，于是 40×40 个模块各自从 A 渐变到 B，
      // 导出的 SVG 是一块块重复的花斑，而 Canvas 预览是一整道渐变 —— 两边不一致。
      // 改成 userSpaceOnUse，坐标锚在码区上（和 Canvas 的 createLinearGradient 同参）。
      var gx0 = 0, gy0 = 0, gx1 = total, gy1 = total;
      if (cfg.gradDir === 'h') { gx1 = total; gy1 = 0; }
      else if (cfg.gradDir === 'v') { gx1 = 0; gy1 = total; }
      defs = '<defs><linearGradient id="' + gid + '" gradientUnits="userSpaceOnUse"'
        + ' x1="' + gx0 + '" y1="' + gy0 + '" x2="' + gx1 + '" y2="' + gy1 + '">'
        + '<stop offset="0" stop-color="' + cfg.gradA + '"/>'
        + '<stop offset="1" stop-color="' + cfg.gradB + '"/></linearGradient></defs>';
    }
    var eyeFill = (cfg.eyeOn && contrast(cfg.eyeColor, cfg.bg) >= 3) ? cfg.eyeColor : fillRef;

    var rendering = 'crispEdges';

    var out = ['<?xml version="1.0" encoding="UTF-8"?>',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + outer + ' ' + outer
      + '" width="' + cfg.exportSize + '" height="' + cfg.exportSize
      + '" preserveAspectRatio="xMidYMid meet" shape-rendering="' + rendering + '">',
      defs];

    // 背景
    out.push('<rect width="' + outer + '" height="' + outer + '" fill="' + cfg.bg + '"/>');

    // 以下所有码点 / 定位图案都在码区局部坐标系里，
    // 平移 pad 之后正好落在形状正中。
    if (pad) out.push('<g transform="translate(' + pad + ' ' + pad + ')">');

    var eyeMap = {};
    function mk(r0, c0) {
      for (var i = 0; i < 7; i++) for (var j = 0; j < 7; j++) eyeMap[(r0 + i) + ',' + (c0 + j)] = 1;
    }
    mk(0, 0); mk(0, count - 7); mk(count - 7, 0);

    for (var r = 0; r < count; r++) for (var c = 0; c < count; c++) {
      if (!qr.modules[r][c] || eyeMap[r + ',' + c]) continue;
      var bx = c + margin, by = r + margin;
      if (cfg.dotStyle === 'square') {
        out.push('<rect x="' + bx + '" y="' + by + '" width="1" height="1" fill="' + fillRef + '"/>');
      } else if (cfg.dotStyle === 'dot') {
        out.push('<circle cx="' + (bx + 0.5) + '" cy="' + (by + 0.5) + '" r="0.55" fill="' + fillRef + '"/>');
      } else {
        var up = isFilled(qr, r - 1, c, count), down = isFilled(qr, r + 1, c, count);
        var lf = isFilled(qr, r, c - 1, count), rt = isFilled(qr, r, c + 1, count);
        var rd = '0.5';
        var tl = (!up && !lf) ? rd : '0', tr = (!up && !rt) ? rd : '0';
        var br = (!down && !rt) ? rd : '0', bl = (!down && !lf) ? rd : '0';
        var dx = bx, dy = by;
        var d = 'M' + (dx + (+tl)) + ' ' + dy
          + 'H' + (dx + 1 - (+tr))
          + (tr !== '0' ? 'A' + rd + ' ' + rd + ' 0 0 1 ' + (dx + 1) + ' ' + (dy + (+tr)) : '')
          + 'V' + (dy + 1 - (+br))
          + (br !== '0' ? 'A' + rd + ' ' + rd + ' 0 0 1 ' + (dx + 1 - (+br)) + ' ' + (dy + 1) : '')
          + 'H' + (dx + (+bl))
          + (bl !== '0' ? 'A' + rd + ' ' + rd + ' 0 0 1 ' + dx + ' ' + (dy + 1 - (+bl)) : '')
          + 'V' + (dy + (+tl))
          + (tl !== '0' ? 'A' + rd + ' ' + rd + ' 0 0 1 ' + (dx + (+tl)) + ' ' + dy : '')
          + 'Z';
        out.push('<path d="' + d + '" fill="' + fillRef + '"/>');
      }
    }

    // 定位图案
    //
    // 【本次修复】这里原先恒画方形环，完全不读 cfg.eyeStyle —— 用户在页面上选了
    // 「圆角」或「圆点」，预览是对的，导出的 SVG 却还是方框。现在改为调用
    // eyeSvgMarkup()，Canvas 与 SVG 共用 ShapeMath 的同一份几何。
    out.push(eyeSvgMarkup(cfg.eyeStyle, count, margin, eyeFill));

    if (pad) out.push('</g>');
    out.push('</svg>');
    return out.join('');
  }

  // 圆角矩形路径（画布 side 用，单位为模块）
  function rectPath(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    return 'M' + (x + r) + ' ' + y
      + 'H' + (x + w - r) + 'A' + r + ' ' + r + ' 0 0 1 ' + (x + w) + ' ' + (y + r)
      + 'V' + (y + h - r) + 'A' + r + ' ' + r + ' 0 0 1 ' + (x + w - r) + ' ' + (y + h)
      + 'H' + (x + r) + 'A' + r + ' ' + r + ' 0 0 1 ' + x + ' ' + (y + h - r)
      + 'V' + (y + r) + 'A' + r + ' ' + r + ' 0 0 1 ' + (x + r) + ' ' + y + 'Z';
  }

  // 生成三个定位图案的 SVG 片段。
  // 几何全部来自 ShapeMath，坐标单位是「模块」（SVG 的 1 个图案单位 = 1 个模块）。
  // 与 drawEye 的像素实现一一对应：方形贴边描边、圆角 1.6 模块、圆点正圆。
  function eyeSvgMarkup(style, count, margin, fill) {
    var S = window.ShapeMath;
    var st = (style === 'rounded' || style === 'dot') ? style : 'square';

    var boxPx = S.BOX;                 // 7
    var hw = S.eyeRingWidth(boxPx);    // = 1 个模块（eyeRingWidth 接收整个盒宽）
    var isDot = st === 'dot';
    var isRounded = st === 'rounded';

    // 描边路径内缩半个环宽，让深色外缘正好贴住 7×7 盒边（与 drawEye 同理，
    // 否则定位图案外扩成 8×8，1:1:3:1:1 比例被破坏，扫不出来）。
    var ringBox = boxPx - hw;
    var cBox = S.CENTER;               // 3

    var out = [];
    var eyes = [[0, 0], [count - 7, 0], [0, count - 7]];

    // ---- 外环：描边路径（无 fill）----
    var ringD = eyes.map(function (e) {
      var ox = e[0] + margin, oy = e[1] + margin;
      var cx = ox + boxPx / 2, cy = oy + boxPx / 2;
      if (isDot) {
        return S.circlePath(cx + ' ' + cy, cx, ringBox / 2);
      }
      var half = ringBox / 2;
      var r = isRounded ? 1.6 : 0;
      return S.roundedRectPath((cx - half) + ' ' + (cy - half), half, r);
    }).join(' ');
    out.push('<path d="' + ringD + '" fill="none" stroke="' + fill
      + '" stroke-width="' + hw + '"/>');

    // ---- 中心方块 / 圆：填充路径 ----
    var centerD = eyes.map(function (e) {
      var ox = e[0] + margin, oy = e[1] + margin;
      var cx = ox + boxPx / 2, cy = oy + boxPx / 2;
      var cHalf = cBox / 2;
      if (isDot) return S.circlePath(cx + ' ' + cy, cx, cHalf);
      var cr = isRounded ? 0.95 : 0;      // 与画布 cell*0.95 等价（单位=模块）
      return S.roundedRectPath((cx - cHalf) + ' ' + (cy - cHalf), cHalf, cr);
    }).join(' ');
    out.push('<path d="' + centerD + '" fill="' + fill + '"/>');

    return out.join('');
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  var batchBusy = false;

  function runBatch() {
    if (batchBusy) return;
    var items = updateBatchStat();
    if (!items.length) { toast('请先粘贴内容列表'); return; }
    if (items.length > 500) { toast('一次最多 500 条，请分批处理'); return; }

    batchBusy = true;
    var btn = $('batchRun');
    var originalBtn = btn.innerHTML;
    btn.disabled = true;

    var cfg = snapshotConfig();
    var prefix = safeName($('batchPrefix').value) || 'codeform';
    var withSvg = batchState.svg;

    var progress = $('batchProgress');
    var fill = $('bpFill');
    var ptext = $('bpText');
    progress.classList.add('on');
    fill.style.width = '0%';
    ptext.textContent = '0 / ' + items.length;

    // 先把上一轮结果清掉
    $('brGrid').innerHTML = '';
    $('batchResult').classList.remove('on');

    var zip = new window.ZipLite();
    var okCount = 0;
    var failures = [];
    var previews = [];

    // 用 requestAnimationFrame 分片推进，避免长任务把页面卡死
    function step(i) {
      if (i >= items.length) return finish();

      var it = items[i];
      var cv = document.createElement('canvas');
      var info = null;
      var nameBase = prefix + '-' + pad3(i + 1)
        + (it.name ? '-' + clampName(safeName(it.name), 40) : '');

      try {
        info = renderTo(cv, it.content, cfg);
      } catch (e) {
        info = null;
      }

      if (!info) {
        failures.push({ line: it.line, name: it.name || it.content.slice(0, 20) });
        i++;
        fill.style.width = (i / items.length * 100) + '%';
        ptext.textContent = i + ' / ' + items.length;
        return requestAnimationFrame(function () { step(i); });
      }

      canvasToBytes(cv).then(function (bytes) {
        zip.add(nameBase + '.png', bytes);
        if (withSvg) {
          var svg = buildSvg(it.content, cfg);
          if (svg) zip.add(nameBase + '.svg', svg);
        }
        okCount++;
        previews.push({ url: URL.createObjectURL(new Blob([bytes], { type: 'image/png' })),
                        label: (it.name || ('#' + pad3(i + 1))), ok: true });

        i++;
        fill.style.width = (i / items.length * 100) + '%';
        ptext.textContent = i + ' / ' + items.length;
        requestAnimationFrame(function () { step(i); });
      }).catch(function () {
        failures.push({ line: it.line, name: it.name || it.content.slice(0, 20) });
        i++;
        fill.style.width = (i / items.length * 100) + '%';
        ptext.textContent = i + ' / ' + items.length;
        requestAnimationFrame(function () { step(i); });
      });
    }

    function finish() {
      batchBusy = false;
      btn.disabled = false;
      btn.innerHTML = originalBtn;
      fill.style.width = '100%';
      ptext.textContent = items.length + ' / ' + items.length + ' · 完成';

      if (!okCount) {
        toast('全部生成失败，请检查内容');
        return;
      }

      var blob = zip.build();
      var stamp = new Date().toISOString().slice(0, 10);
      var fname = prefix + '-' + okCount + '个-' + stamp + '.zip';
      downloadBlob(blob, fname);

      // 结果展示
      var grid = $('brGrid');
      previews.forEach(function (p) {
        var d = document.createElement('div');
        d.className = 'br-item';
        d.innerHTML = '<img src="' + p.url + '" alt=""><span class="br-name">'
          + p.label.replace(/[<>&]/g, '') + '</span>';
        grid.appendChild(d);
      });
      failures.forEach(function (f) {
        var d = document.createElement('div');
        d.className = 'br-item fail';
        d.title = '第 ' + f.line + ' 行：' + f.name;
        grid.appendChild(d);
      });
      $('brInfo').textContent = okCount + ' 个成功'
        + (failures.length ? ' · ' + failures.length + ' 个跳过' : '')
        + ' · ' + (blob.size / 1024 / 1024).toFixed(2) + ' MB';
      $('batchResult').classList.add('on');

      var msg = '已生成 ' + okCount + ' 个二维码';
      if (failures.length) msg += '，' + failures.length + ' 个内容过长被跳过';
      toast(msg);
    }

    requestAnimationFrame(function () { step(0); });
  }

  // ---------- 批量：事件绑定 ----------
  var batchInputEl = $('batchInput');
  if (batchInputEl) {
    var batchDebounce;
    batchInputEl.addEventListener('input', function () {
      clearTimeout(batchDebounce);
      batchDebounce = setTimeout(updateBatchStat, 220);
    });

    document.querySelectorAll('#batchSvg button').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('#batchSvg button').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        batchState.svg = b.dataset.v === 'yes';
      });
    });

    $('batchRun').addEventListener('click', runBatch);

    $('batchClear').addEventListener('click', function () {
      $('batchInput').value = '';
      $('brGrid').innerHTML = '';
      $('batchResult').classList.remove('on');
      $('batchProgress').classList.remove('on');
      updateBatchStat();
    });

    // 样式变了就刷新统计条上的样式说明
    ['dotStyle', 'ecLevel', 'gradOn', 'eyeOn'].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('click', function () { setTimeout(updateBatchStat, 0); });
    });
  }

  // ---------- 扫码解码 ----------
  var lastScanText = '';

  function detectType(t) {
    if (/^https?:\/\//i.test(t)) return '网址';
    if (/^WIFI:/i.test(t)) return 'WiFi';
    if (/^BEGIN:VCARD/i.test(t)) return '名片';
    if (/^mailto:/i.test(t)) return '邮件';
    if (/^(SMSTO|smsto):/i.test(t) || /^sms:/i.test(t)) return '短信';
    if (/^(tel|TEL):/i.test(t)) return '电话';
    if (/^geo:/i.test(t)) return '位置';
    return '文本';
  }

  function showScanResult(text) {
    lastScanText = text;
    $('scanOut').textContent = text;
    $('scanType').textContent = detectType(text);
    $('scanOpen').style.display = /^https?:\/\//i.test(text) ? '' : 'none';
    $('scanResult').classList.add('show');
  }

  function decodeImage(img) {
    // 尺寸策略：小图放大、大图适度缩小。
    // 缩小会压掉圆点/液态码型的模块间隙，所以上限放得比较宽，优先保证细节。
    var w = img.naturalWidth || img.width;
    var h = img.naturalHeight || img.height;
    var maxSide = 2600;
    var scale = Math.min(1, maxSide / Math.max(w, h));
    scale = Math.max(scale, 0.5);              // 至少保留一半精度
    var cw = Math.max(1, Math.round(w * scale));
    var ch = Math.max(1, Math.round(h * scale));

    var off = document.createElement('canvas');
    off.width = cw; off.height = ch;
    var octx = off.getContext('2d');
    octx.fillStyle = '#fff';
    octx.fillRect(0, 0, cw, ch);
    octx.imageSmoothingEnabled = false;
    octx.drawImage(img, 0, 0, cw, ch);

    var base = octx.getImageData(0, 0, cw, ch);

    function tryDecode(imageData) {
      try {
        var r = window.jsQR(imageData.data, imageData.width, imageData.height,
          { inversionAttempts: 'attemptBoth' });
        return (r && r.data) ? r.data : '';
      } catch (e) { return ''; }
    }

    // 策略一：原图直接解
    var got = tryDecode(base);
    if (got) return got;

    // 策略二：按亮度硬阈值二值化后再解。
    // 圆点/液态码型边缘的抗锯齿灰阶会干扰 jsQR 的采样，压实成纯黑白后识别率显著提升。
    var copy = new ImageData(new Uint8ClampedArray(base.data), cw, ch);
    var d = copy.data;
    for (var i = 0; i < d.length; i += 4) {
      var lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      var v = lum < 128 ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    got = tryDecode(copy);
    if (got) return got;

    // 策略三：二值化 + 放大 1.6 倍（应对低分辨率圆点码）
    var up = document.createElement('canvas');
    up.width = cw * 1.6 | 0; up.height = ch * 1.6 | 0;
    var uctx = up.getContext('2d');
    uctx.fillStyle = '#fff'; uctx.fillRect(0, 0, up.width, up.height);
    uctx.imageSmoothingEnabled = false;
    uctx.drawImage(off, 0, 0, up.width, up.height);
    var upData = uctx.getImageData(0, 0, up.width, up.height);
    var ud = upData.data;
    for (var j = 0; j < ud.length; j += 4) {
      var l2 = 0.2126 * ud[j] + 0.7152 * ud[j + 1] + 0.0722 * ud[j + 2];
      var v2 = l2 < 128 ? 0 : 255;
      ud[j] = ud[j + 1] = ud[j + 2] = v2;
    }
    got = tryDecode(upData);
    if (got) return got;

    // 策略四：大图缩到 1200 再试（部分解码器偏好适中分辨率）
    if (cw > 1200) {
      var sm = document.createElement('canvas');
      var sp = 1200 / cw;
      sm.width = 1200; sm.height = Math.round(ch * sp);
      var sctx = sm.getContext('2d');
      sctx.fillStyle = '#fff'; sctx.fillRect(0, 0, sm.width, sm.height);
      sctx.imageSmoothingEnabled = false;
      sctx.drawImage(off, 0, 0, sm.width, sm.height);
      var smData = sctx.getImageData(0, 0, sm.width, sm.height);
      var sd = smData.data;
      for (var k = 0; k < sd.length; k += 4) {
        var l3 = 0.2126 * sd[k] + 0.7152 * sd[k + 1] + 0.0722 * sd[k + 2];
        var v3 = l3 < 128 ? 0 : 255;
        sd[k] = sd[k + 1] = sd[k + 2] = v3;
      }
      got = tryDecode(smData);
    }
    return got || '';
  }

  function handleScanFile(file) {
    if (!file || !/^image\//.test(file.type)) return toast('请选择图片文件');
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      $('scanPreview').src = url;
      $('scanBox').classList.add('has-img');
      var text = decodeImage(img);
      if (text) {
        showScanResult(text);
        toast('识别成功');
      } else {
        $('scanResult').classList.remove('show');
        toast('未识别到二维码，换张更清晰的图试试');
      }
    };
    img.onerror = function () { toast('图片读取失败'); };
    img.src = url;
  }

  $('scanBox').addEventListener('click', function () { $('scanInput').click(); });
  $('scanInput').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    if (f) handleScanFile(f);
  });

  // 拖拽
  ['dragenter', 'dragover'].forEach(function (ev) {
    $('scanBox').addEventListener(ev, function (e) { e.preventDefault(); $('scanBox').classList.add('drag'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    $('scanBox').addEventListener(ev, function (e) { e.preventDefault(); $('scanBox').classList.remove('drag'); });
  });
  $('scanBox').addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleScanFile(f);
  });

  // 粘贴
  document.addEventListener('paste', function (e) {
    if (!$('scanWrap').classList.contains('on')) return;
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf('image') === 0) {
        var f = items[i].getAsFile();
        if (f) { handleScanFile(f); e.preventDefault(); }
        return;
      }
    }
  });

  $('scanCopy').addEventListener('click', function () {
    if (!lastScanText) return;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(lastScanText)
        .then(function () { toast('已复制内容'); })
        .catch(function () { toast('复制失败'); });
    } else {
      toast('浏览器不支持复制');
    }
  });

  $('scanOpen').addEventListener('click', function () {
    if (/^https?:\/\//i.test(lastScanText)) window.open(lastScanText, '_blank', 'noopener');
  });

  // 载入编辑器：把内容回填到「文本」类型，切回生成模式
  $('scanEdit').addEventListener('click', function () {
    if (!lastScanText) return;
    document.querySelectorAll('#tabs .tab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.type === 'text');
    });
    TYPES.forEach(function (k) { $('panel-' + k).classList.toggle('hidden', k !== 'text'); });
    state.type = 'text';
    $('inputText').value = lastScanText;
    document.querySelectorAll('#modeSwitch button').forEach(function (x) {
      x.classList.toggle('active', x.dataset.mode === 'gen');
    });
    $('genWrap').classList.remove('off');
    $('scanWrap').classList.remove('on');
    render();
    toast('已载入编辑器，可继续编辑');
  });

  // ---------- 自动化测试钩子 ----------
  // 整个 app.js 是个 IIFE，不对外暴露任何东西。好处是不会污染全局，
  // 坏处是回归测试只能截图看「看起来对不对」，验证不了 SVG 里真正的坐标
  // （而 SVG 导出恰恰是最容易悄悄画错的一条路径：渐变参照、画幅、偏移）。
  // 这里只开两个只读出口：返回的是字符串 / 数字，外部拿不到 state 引用，改不动内部状态。
  window.QRStudioTest = {
    buildSvg: function () { return buildSvg(getContent(), state); },
    renderInfo: function () { return renderTo(document.createElement('canvas'), getContent(), state); }
  };

  // ---------- 初始化 ----------
  render();
})();
