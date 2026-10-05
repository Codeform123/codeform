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
  function getContent() {
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
        var lines = ['BEGIN:VCARD', 'VERSION:3.0', 'N:' + name, 'FN:' + name];
        if ($('vcOrg').value) lines.push('ORG:' + $('vcOrg').value);
        if ($('vcTel').value) lines.push('TEL:' + $('vcTel').value);
        if ($('vcMail').value) lines.push('EMAIL:' + $('vcMail').value);
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
        return tNum ? 'tel:' + tNum : '';
      }
      case 'mail': {
        var mTo = ($('mailTo').value || '').trim();
        if (!mTo) return '';
        var mParams = [];
        if ($('mailSubj').value) mParams.push('subject=' + encodeURIComponent($('mailSubj').value));
        if ($('mailBody').value) mParams.push('body=' + encodeURIComponent($('mailBody').value));
        return 'mailto:' + mTo + (mParams.length ? '?' + mParams.join('&') : '');
      }
      case 'geo': {
        var gLat = ($('geoLat').value || '').trim();
        var gLng = ($('geoLng').value || '').trim();
        return (gLat && gLng) ? 'geo:' + gLat + ',' + gLng : '';
      }
      default: return '';
    }
  }
  function esc(s) { return String(s).replace(/([\\;,:"])/g, '\\$1'); }

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
  // render() 是给单张预览用的：画到页面上的 canvas，并同步更新所有 UI 文案。
  // 批量生成需要「把同样的画面画到另外的 canvas 上」，所以真正的绘制逻辑
  // 抽在 renderTo() 里 —— 它接受目标 canvas 和一份设置快照，返回绘制结果信息。 */
  function renderTo(targetCanvas, content, cfg) {
    var c2d = targetCanvas.getContext('2d');
    var qr;
    try {
      qr = window.QRCore.generate(content, cfg.ecLevel);
    } catch (e) {
      return null;   // 内容过长，调用方决定怎么处理
    }

    var count = qr.size;
    var margin = cfg.margin;
    var total = count + margin * 2;
    var target = cfg.exportSize || 600;
    var cell = Math.floor(target / total);
    if (cell < 1) cell = 1;
    var drawSize = cell * total;

    targetCanvas.width = drawSize;
    targetCanvas.height = drawSize;

    // 背景
    c2d.fillStyle = cfg.bg;
    c2d.fillRect(0, 0, drawSize, drawSize);

    var offset = margin * cell;

    // 渐变填充准备
    var fillStyle = cfg.fg;
    if (cfg.gradOn) {
      var g;
      if (cfg.gradDir === 'h') g = c2d.createLinearGradient(0, 0, drawSize, 0);
      else if (cfg.gradDir === 'v') g = c2d.createLinearGradient(0, 0, 0, drawSize);
      else g = c2d.createLinearGradient(0, 0, drawSize, drawSize);
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

    // Logo
    if (cfg.logoImg) {
      var ls = logosize;
      var lx = (drawSize - ls) / 2;
      var ly = (drawSize - ls) / 2;
      var pad = Math.max(3, ls * 0.10);
      c2d.save();
      c2d.fillStyle = cfg.bg;
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
    // 仅在「纯色前景 + 非圆形图案」之外的情况下做硬阈值二值化。
    var needBin = !cfg.gradOn && (cfg.dotStyle === 'dot' || cfg.dotStyle === 'liquid'
                   || (cfg.eyeOn && cfg.eyeStyle !== 'square'));
    if (needBin) {
      var imgData = c2d.getImageData(0, 0, drawSize, drawSize);
      var px = imgData.data;
      var logoBox = null;
      if (cfg.logoImg) {
        var lsz = logosize, lxx = (drawSize - lsz) / 2, lyy = (drawSize - lsz) / 2;
        var lpad = Math.max(3, lsz * 0.10) + 2;
        logoBox = { x0: lxx - lpad, y0: lyy - lpad, x1: lxx + lsz + lpad, y1: lyy + lsz + lpad };
      }
      var bgLum = relLum(cfg.bg);
      var midLum = bgLum > 0.5 ? bgLum - 0.35 : bgLum + 0.35;   // 阈值偏向背景一侧
      for (var yy = 0; yy < drawSize; yy++) {
        if (logoBox && yy >= logoBox.y0 && yy <= logoBox.y1) continue;
        for (var xx = 0; xx < drawSize; xx++) {
          if (logoBox && xx >= logoBox.x0 && xx <= logoBox.x1) continue;
          var idx = (yy * drawSize + xx) * 4;
          var lum = (0.2126 * px[idx] + 0.7152 * px[idx + 1] + 0.0722 * px[idx + 2]) / 255;
          var v = lum < midLum ? 0 : 255;
          px[idx] = px[idx + 1] = px[idx + 2] = v;
        }
      }
      c2d.putImageData(imgData, 0, 0);
    }

    return { size: qr.size, drawSize: drawSize, total: total, cell: cell };
  }

  function render() {
    var content = getContent();

    // 空内容占位
    if (!content) {
      ctx.fillStyle = '#0a0c12';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(154,167,194,.55)';
      ctx.font = '500 30px -apple-system, "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('请输入内容生成二维码', canvas.width / 2, canvas.height / 2);
      $('versionInfo').textContent = '版本 —';
      $('sizeInfo').textContent = '—';
      updateContrastWarn();
      return;
    }

    var info = renderTo(canvas, content, state);

    if (!info) {
      ctx.fillStyle = '#0a0c12';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#f87171';
      ctx.font = '500 28px -apple-system, "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('内容过长，请缩短或降低纠错等级', canvas.width / 2, canvas.height / 2);
      return;
    }

    $('versionInfo').textContent = '版本 ' + info.size + '×' + info.size;
    $('sizeInfo').textContent = '纠错 ' + state.ecLevel + ' · ' + info.drawSize + 'px';
    updateContrastWarn();
    // 目标尺寸与取整后实际像素不一致时，在按钮上标个小提示
    if ($('sizes')) {
      document.querySelectorAll('#sizes .sz').forEach(function (b) {
        var want = parseInt(b.dataset.v, 10);
        var real = info.cell * info.total;
        b.classList.toggle('adjusted', real !== want);
        b.title = real !== want ? ('导出实际为 ' + real + '×' + real + 'px（模块整数倍对齐，保证清晰）') : '';
      });
    }
  }

  // 绘制单个定位图案（7x7 模块，左上角 x,y）
  function drawEye(g, x, y, cell, cfg) {
    var s = cell * 7;
    var st = cfg.eyeStyle;

    if (st === 'square') {
      // 外框 7x7 环，宽 1 模块
      g.fillRect(x, y, s, cell);                    // 上
      g.fillRect(x, y + s - cell, s, cell);         // 下
      g.fillRect(x, y, cell, s);                    // 左
      g.fillRect(x + s - cell, y, cell, s);         // 右
      g.fillRect(x + cell * 2, y + cell * 2, cell * 3, cell * 3); // 中心 3x3
      return;
    }

    var rOuter = st === 'dot' ? s / 2 : cell * 1.6;
    var rInner = st === 'dot' ? (cell * 3) / 2 : cell * 0.95;

    // 外环（用 evenodd 挖空）
    g.beginPath();
    g.moveTo(x + rOuter, y);
    g.arcTo(x + s, y, x + s, y + s, rOuter);
    g.arcTo(x + s, y + s, x, y + s, rOuter);
    g.arcTo(x, y + s, x, y, rOuter);
    g.arcTo(x, y, x + s, y, rOuter);
    g.closePath();
    // 内挖空
    var ix = x + cell, iy = y + cell, is = s - cell * 2;
    g.moveTo(ix + rInner, iy);
    g.arcTo(ix + is, iy, ix + is, iy + is, rInner);
    g.arcTo(ix + is, iy + is, ix, iy + is, rInner);
    g.arcTo(ix, iy + is, ix, iy, rInner);
    g.arcTo(ix, iy, ix + is, iy, rInner);
    g.closePath();
    g.fill('evenodd');

    // 中心 3x3
    var cx = x + cell * 2, cy = y + cell * 2, cs = cell * 3;
    g.beginPath();
    if (st === 'dot') {
      g.arc(cx + cs / 2, cy + cs / 2, cs / 2, 0, Math.PI * 2);
    } else {
      var rr = Math.min(cell * 0.95, cs / 2);
      g.moveTo(cx + rr, cy);
      g.arcTo(cx + cs, cy, cx + cs, cy + cs, rr);
      g.arcTo(cx + cs, cy + cs, cx, cy + cs, rr);
      g.arcTo(cx, cy + cs, cx, cy, rr);
      g.arcTo(cx, cy, cx + cs, cy, rr);
    }
    g.closePath();
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
  bindSeg('ecLevel', 'ecLevel');
  bindSeg('gradDir', 'gradDir');
  bindSeg('eyeStyle', 'eyeStyle');

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
  $('logoDrop').addEventListener('click', function () { $('logoInput').click(); });
  $('logoInput').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (ev) {
      var img = new Image();
      img.onload = function () {
        state.logoImg = img;
        $('logoDrop').textContent = '已载入：' + file.name;
        render();
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
  $('clearLogo').addEventListener('click', function () {
    state.logoImg = null;
    $('logoInput').value = '';
    $('logoDrop').textContent = '点击选择图片 · 自动圆形裁切';
    render();
  });

  // ---------- 下载 ----------
  $('downloadPng').addEventListener('click', function () {
    if (!getContent()) return toast('请先输入内容');
    var link = document.createElement('a');
    link.download = 'codeform-' + canvas.width + '-' + Date.now() + '.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
    toast('已下载 PNG（' + canvas.width + '×' + canvas.height + '）');
  });

  $('downloadSvg').addEventListener('click', function () {
    var content = getContent();
    if (!content) return toast('请先输入内容');
    var qr;
    try { qr = window.QRCore.generate(content, state.ecLevel); }
    catch (e) { return toast('内容过长'); }
    var count = qr.size, margin = state.margin, total = count + margin * 2;

    // 填充定义：纯色 或 渐变
    var defs = '', fillRef = state.fg;
    if (state.gradOn) {
      fillRef = 'url(#qg)';
      var x1 = '0%', y1 = '0%', x2 = '100%', y2 = '100%';
      if (state.gradDir === 'h') { x2 = '100%'; y2 = '0%'; }
      else if (state.gradDir === 'v') { x2 = '0%'; y2 = '100%'; }
      defs = '<defs><linearGradient id="qg" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '">'
        + '<stop offset="0%" stop-color="' + state.gradA + '"/>'
        + '<stop offset="100%" stop-color="' + state.gradB + '"/></linearGradient></defs>';
    }
    var eyeFill = (state.eyeOn && contrast(state.eyeColor, state.bg) >= 3) ? state.eyeColor : fillRef;

    var svg = ['<?xml version="1.0" encoding="UTF-8"?>',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total + '" width="' + state.exportSize + '" height="' + state.exportSize + '" shape-rendering="crispEdges">',
      defs,
      '<rect width="' + total + '" height="' + total + '" fill="' + state.bg + '"/>'];

    // 定位图案区域
    var eyeMap = {};
    function m(r0, c0) { for (var i = 0; i < 7; i++) for (var j = 0; j < 7; j++) eyeMap[(r0 + i) + ',' + (c0 + j)] = 1; }
    m(0, 0); m(0, count - 7); m(count - 7, 0);

    for (var r = 0; r < count; r++) for (var c = 0; c < count; c++) {
      if (!qr.modules[r][c] || eyeMap[r + ',' + c]) continue;
      var bx = c + margin, by = r + margin;
      // 与画布绘制逻辑保持一致
      if (state.dotStyle === 'square') {
        svg.push('<rect x="' + bx + '" y="' + by + '" width="1" height="1" fill="' + fillRef + '"/>');
      } else if (state.dotStyle === 'dot') {
        svg.push('<circle cx="' + (bx + 0.5) + '" cy="' + (by + 0.5) + '" r="0.55" fill="' + fillRef + '"/>');
      } else { // liquid：圆角方块 + 按邻接关系决定各角圆化（与画布同算法）
        var up = isFilled(qr, r - 1, c, count);
        var down = isFilled(qr, r + 1, c, count);
        var left = isFilled(qr, r, c - 1, count);
        var right = isFilled(qr, r, c + 1, count);
        var rd = '0.5';
        var tl = (!up && !left) ? rd : '0';
        var tr = (!up && !right) ? rd : '0';
        var br = (!down && !right) ? rd : '0';
        var bl = (!down && !left) ? rd : '0';
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
        svg.push('<path d="' + d + '" fill="' + fillRef + '"/>');
      }
    }

    // 定位图案：外环(7x7 挖空 5x5) + 中心 3x3
    function eyePath(ox, oy) {
      var s = 'M' + (ox + 7) + ' ' + oy + 'H' + ox + 'V' + (oy + 7) + 'H' + (ox + 7) + 'Z'
        + 'M' + (ox + 1) + ' ' + (oy + 1) + 'V' + (oy + 6) + 'H' + (ox + 6) + 'V' + (oy + 1) + 'Z';
      return s;
    }
    var eyes = [[0, 0], [count - 7, 0], [0, count - 7]];
    var d = eyes.map(function (e) { return eyePath(e[0] + margin, e[1] + margin); }).join(' ');
    svg.push('<path d="' + d + '" fill="' + eyeFill + '" fill-rule="evenodd"/>');
    eyes.forEach(function (e) {
      svg.push('<rect x="' + (e[0] + margin + 2) + '" y="' + (e[1] + margin + 2) + '" width="3" height="3" fill="' + eyeFill + '"/>');
    });

    svg.push('</svg>');
    var blob = new Blob([svg.join('')], { type: 'image/svg+xml' });
    var link = document.createElement('a');
    link.download = 'codeform-' + Date.now() + '.svg';
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
    toast('已下载 SVG（矢量）');
  });

  $('copyImage').addEventListener('click', function () {
    if (!getContent()) return toast('请先输入内容');
    if (!navigator.clipboard || !window.ClipboardItem) return toast('浏览器不支持，请用下载');
    canvas.toBlob(function (blob) {
      navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        .then(function () { toast('已复制到剪贴板'); })
        .catch(function () { toast('复制失败，请用下载'); });
    }, 'image/png');
  });

  $('resetAll').addEventListener('click', function () {
    state.fg = '#0a0c12'; state.bg = '#ffffff';
    state.dotStyle = 'square'; state.ecLevel = 'M'; state.margin = 4; state.logoImg = null;
    state.gradOn = false; state.gradA = '#0c2a6b'; state.gradB = '#2563eb'; state.gradDir = 'diag';
    state.eyeStyle = 'square'; state.eyeOn = false; state.eyeColor = '#1d4ed8';
    state.exportSize = 600;
    $('fgColor').value = '#0a0c12'; $('bgColor').value = '#ffffff';
    $('margin').value = 4; $('marginVal').textContent = '4';
    $('logoDrop').textContent = '点击选择图片 · 自动圆形裁切';
    $('gradOn').checked = false; $('gradRow').classList.remove('on');
    $('fgLabel').textContent = '前景色';
    if ($('colorGrid')) $('colorGrid').classList.remove('dim');
    $('gradA').value = '#0c2a6b'; $('gradB').value = '#2563eb';
    $('eyeOn').checked = false; $('eyeRow').classList.remove('on');
    $('eyeColor').value = '#1d4ed8';
    document.querySelectorAll('#gradPresets .gp').forEach(function (g) { g.classList.remove('sel'); });
    document.querySelectorAll('#dotStyle button').forEach(function (b) { b.classList.toggle('active', b.dataset.v === 'square'); });
    document.querySelectorAll('#ecLevel button').forEach(function (b) { b.classList.toggle('active', b.dataset.v === 'M'); });
    document.querySelectorAll('#gradDir button').forEach(function (b) { b.classList.toggle('active', b.dataset.v === 'diag'); });
    document.querySelectorAll('#eyeStyle button').forEach(function (b) { b.classList.toggle('active', b.dataset.v === 'square'); });
    document.querySelectorAll('#sizes .sz').forEach(function (b) { b.classList.toggle('active', b.dataset.v === '600'); });
    document.querySelectorAll('#fgSwatches .sw').forEach(function (s) { s.classList.toggle('sel', s.dataset.c === '#0a0c12'); });
    document.querySelectorAll('#bgSwatches .sw').forEach(function (s) { s.classList.toggle('sel', s.dataset.c === '#ffffff'); });
    document.querySelectorAll('#eyeSwatches .sw').forEach(function (s) { s.classList.toggle('sel', s.dataset.c === '#1d4ed8'); });
    // 清空所有内容输入
    ['inputText', 'inputUrl', 'wifiSsid', 'wifiPass', 'vcName', 'vcTel', 'vcOrg', 'vcMail',
      'smsTel', 'smsBody', 'telNum', 'mailTo', 'mailSubj', 'mailBody', 'geoLat', 'geoLng'].forEach(function (id) {
      $(id).value = '';
    });
    document.querySelectorAll('#geoPreset button').forEach(function (b) { b.classList.remove('active'); });
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
    var s = shape + ' · 纠错' + state.ecLevel;
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
    var tooLong = [];
    for (var i = 0; i < items.length; i++) {
      var probe = window.QRCore.probe
        ? window.QRCore.probe(items[i].content, state.ecLevel)
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
    try { qr = window.QRCore.generate(content, cfg.ecLevel); }
    catch (e) { return null; }

    var count = qr.size, margin = cfg.margin, total = count + margin * 2;
    var defs = '', fillRef = cfg.fg;
    var gid = 'qg' + Math.random().toString(36).slice(2, 8);

    if (cfg.gradOn) {
      fillRef = 'url(#' + gid + ')';
      var x1 = '0%', y1 = '0%', x2 = '100%', y2 = '100%';
      if (cfg.gradDir === 'h') { x2 = '100%'; y2 = '0%'; }
      else if (cfg.gradDir === 'v') { x2 = '0%'; y2 = '100%'; }
      defs = '<defs><linearGradient id="' + gid + '" x1="' + x1 + '" y1="' + y1
        + '" x2="' + x2 + '" y2="' + y2 + '">'
        + '<stop offset="0%" stop-color="' + cfg.gradA + '"/>'
        + '<stop offset="100%" stop-color="' + cfg.gradB + '"/></linearGradient></defs>';
    }
    var eyeFill = (cfg.eyeOn && contrast(cfg.eyeColor, cfg.bg) >= 3) ? cfg.eyeColor : fillRef;

    var out = ['<?xml version="1.0" encoding="UTF-8"?>',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total
      + '" width="' + cfg.exportSize + '" height="' + cfg.exportSize
      + '" shape-rendering="crispEdges">',
      defs,
      '<rect width="' + total + '" height="' + total + '" fill="' + cfg.bg + '"/>'];

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
    var eyes = [[0, 0], [count - 7, 0], [0, count - 7]];
    var dpath = eyes.map(function (e) {
      var ox = e[0] + margin, oy = e[1] + margin;
      return 'M' + (ox + 7) + ' ' + oy + 'H' + ox + 'V' + (oy + 7) + 'H' + (ox + 7) + 'Z'
        + 'M' + (ox + 1) + ' ' + (oy + 1) + 'V' + (oy + 6) + 'H' + (ox + 6) + 'V' + (oy + 1) + 'Z';
    }).join(' ');
    out.push('<path d="' + dpath + '" fill="' + eyeFill + '" fill-rule="evenodd"/>');
    eyes.forEach(function (e) {
      out.push('<rect x="' + (e[0] + margin + 2) + '" y="' + (e[1] + margin + 2)
        + '" width="3" height="3" fill="' + eyeFill + '"/>');
    });

    out.push('</svg>');
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

  // ---------- 初始化 ----------
  render();
})();
