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

    var qr;
    try {
      qr = window.QRCore.generate(content, state.ecLevel);
    } catch (e) {
      ctx.fillStyle = '#0a0c12';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#f87171';
      ctx.font = '500 28px -apple-system, "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('内容过长，请缩短或降低纠错等级', canvas.width / 2, canvas.height / 2);
      return;
    }

    var count = qr.size;
    var margin = state.margin;
    var total = count + margin * 2;
    // 画布尺寸：以 module 整数倍绘制保证清晰
    var target = state.exportSize || 600;
    var cell = Math.floor(target / total);
    if (cell < 1) cell = 1;
    var drawSize = cell * total;

    canvas.width = drawSize;
    canvas.height = drawSize;

    // 背景
    ctx.fillStyle = state.bg;
    ctx.fillRect(0, 0, drawSize, drawSize);

    var offset = margin * cell;

    // 渐变填充准备
    var fillStyle = state.fg;
    if (state.gradOn) {
      var g;
      if (state.gradDir === 'h') g = ctx.createLinearGradient(0, 0, drawSize, 0);
      else if (state.gradDir === 'v') g = ctx.createLinearGradient(0, 0, 0, drawSize);
      else g = ctx.createLinearGradient(0, 0, drawSize, drawSize);
      g.addColorStop(0, state.gradA);
      g.addColorStop(1, state.gradB);
      fillStyle = g;
    }
    ctx.fillStyle = fillStyle;

    var logosize = 0;
    if (state.logoImg) logosize = Math.floor(drawSize * 0.22);

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
        // 孤立模块判定：四邻皆空才做形状变化，保证连通区域不被切碎
        var iso = !(qr.modules[r - 1] && qr.modules[r - 1][c])
               && !(qr.modules[r + 1] && qr.modules[r + 1][c])
               && !qr.modules[r][c - 1]
               && !qr.modules[r][c + 1];
        drawModule(x, y, cell, r, c, count, iso, qr);
      }
    }

    // 定位图案（三个角）
    // 定位图案是扫码器最先识别的锚点，对对比度极其敏感：
    // 一旦它和背景太接近，整张码都会扫不出来。
    // 这里做一层保护——如果用户选的颜色对比度低于 3:1，自动回退到前景色，
    // 保证「好看」永远不会以「扫不出来」为代价。
    var eyeSafe = state.eyeOn && contrast(state.eyeColor, state.bg) >= 3;
    ctx.fillStyle = (eyeSafe ? state.eyeColor : fillStyle);
    drawEye(offset, offset, cell);
    drawEye(offset + (count - 7) * cell, offset, cell);
    drawEye(offset, offset + (count - 7) * cell, cell);

    // Logo
    if (state.logoImg) {
      var ls = logosize;
      var lx = (drawSize - ls) / 2;
      var ly = (drawSize - ls) / 2;
      var pad = Math.max(3, ls * 0.10);
      // 白色底
      ctx.save();
      ctx.fillStyle = state.bg;
      roundRect(ctx, lx - pad, ly - pad, ls + pad * 2, ls + pad * 2, pad * 1.2);
      ctx.fill();
      // 圆形裁切 logo
      ctx.beginPath();
      ctx.arc(lx + ls / 2, ly + ls / 2, ls / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(state.logoImg, lx, ly, ls, ls);
      ctx.restore();
    }

    // 圆形/圆角绘制会产生抗锯齿灰边（实测占比约 2%），
    // 灰边会让扫码器的二值化判断不稳定，同一张图时好时坏。
    // 仅在「纯色前景 + 非圆形图案」之外的情况下做硬阈值二值化：
    //   - 渐变色需要保留中间色，不做处理
    //   - 直角方块本身无灰边，无需处理
    // 需要处理的场景：dot / liquid（或非方形定位图案）+ 纯色前景
    var needBin = !state.gradOn && (state.dotStyle === 'dot' || state.dotStyle === 'liquid'
                   || (state.eyeOn && state.eyeStyle !== 'square'));
    if (needBin) {
      var imgData = ctx.getImageData(0, 0, drawSize, drawSize);
      var px = imgData.data;
      var logoBox = null;
      if (state.logoImg) {
        var lsz = logosize, lxx = (drawSize - lsz) / 2, lyy = (drawSize - lsz) / 2;
        var lpad = Math.max(3, lsz * 0.10) + 2;
        logoBox = { x0: lxx - lpad, y0: lyy - lpad, x1: lxx + lsz + lpad, y1: lyy + lsz + lpad };
      }
      var bgLum = relLum(state.bg);
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
      ctx.putImageData(imgData, 0, 0);
    }

    $('versionInfo').textContent = '版本 ' + qr.size + '×' + qr.size;
    $('sizeInfo').textContent = '纠错 ' + state.ecLevel + ' · ' + drawSize + 'px';
    updateContrastWarn();
    // 目标尺寸与取整后实际像素不一致时，在按钮上标个小提示
    if ($('sizes')) {
      document.querySelectorAll('#sizes .sz').forEach(function (b) {
        var want = parseInt(b.dataset.v, 10);
        var real = cell * total;
        b.classList.toggle('adjusted', real !== want);
        b.title = real !== want ? ('导出实际为 ' + real + '×' + real + 'px（模块整数倍对齐，保证清晰）') : '';
      });
    }
  }

  // 绘制单个定位图案（7x7 模块，左上角 x,y）
  function drawEye(x, y, cell) {
    var s = cell * 7;
    var st = state.eyeStyle;

    if (st === 'square') {
      // 外框 7x7 环，宽 1 模块
      ctx.fillRect(x, y, s, cell);                    // 上
      ctx.fillRect(x, y + s - cell, s, cell);         // 下
      ctx.fillRect(x, y, cell, s);                    // 左
      ctx.fillRect(x + s - cell, y, cell, s);         // 右
      ctx.fillRect(x + cell * 2, y + cell * 2, cell * 3, cell * 3); // 中心 3x3
      return;
    }

    var rOuter = st === 'dot' ? s / 2 : cell * 1.6;
    var rInner = st === 'dot' ? (cell * 3) / 2 : cell * 0.95;

    // 外环（用 evenodd 挖空）
    ctx.beginPath();
    ctx.moveTo(x + rOuter, y);
    ctx.arcTo(x + s, y, x + s, y + s, rOuter);
    ctx.arcTo(x + s, y + s, x, y + s, rOuter);
    ctx.arcTo(x, y + s, x, y, rOuter);
    ctx.arcTo(x, y, x + s, y, rOuter);
    ctx.closePath();
    // 内挖空
    var ix = x + cell, iy = y + cell, is = s - cell * 2;
    ctx.moveTo(ix + rInner, iy);
    ctx.arcTo(ix + is, iy, ix + is, iy + is, rInner);
    ctx.arcTo(ix + is, iy + is, ix, iy + is, rInner);
    ctx.arcTo(ix, iy + is, ix, iy, rInner);
    ctx.arcTo(ix, iy, ix + is, iy, rInner);
    ctx.closePath();
    ctx.fill('evenodd');

    // 中心 3x3
    var cx = x + cell * 2, cy = y + cell * 2, cs = cell * 3;
    ctx.beginPath();
    if (st === 'dot') {
      ctx.arc(cx + cs / 2, cy + cs / 2, cs / 2, 0, Math.PI * 2);
    } else {
      var rr = Math.min(cell * 0.95, cs / 2);
      ctx.moveTo(cx + rr, cy);
      ctx.arcTo(cx + cs, cy, cx + cs, cy + cs, rr);
      ctx.arcTo(cx + cs, cy + cs, cx, cy + cs, rr);
      ctx.arcTo(cx, cy + cs, cx, cy, rr);
      ctx.arcTo(cx, cy, cx + cs, cy, rr);
    }
    ctx.closePath();
    ctx.fill();
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
  function drawModule(x, y, cell, r, c, count, isolated, qr) {
    var style = state.dotStyle;

    if (style === 'square') {
      ctx.fillRect(x, y, cell, cell);
      return;
    }

    // 点阵：每格缩成独立小圆（联图"圆角"即此形态）
    // 半径下限受扫码器约束：实测 0.50~0.62 可扫，低于 0.50 会丢失模块边界。
    // 取 0.55 兼顾「圆点感明显」与「留有余量」。
    if (style === 'dot') {
      var dRad = cell * 0.55;
      ctx.beginPath();
      ctx.arc(x + cell / 2, y + cell / 2, dRad, 0, Math.PI * 2);
      ctx.fill();
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
      ctx.beginPath();
      ctx.moveTo(x + tl, y);
      ctx.lineTo(x + w - tr, y);
      if (tr) ctx.arcTo(x + w, y, x + w, y + h, tr);
      ctx.lineTo(x + w, y + h - br);
      if (br) ctx.arcTo(x + w, y + h, x, y + h, br);
      ctx.lineTo(x + bl, y + h);
      if (bl) ctx.arcTo(x, y + h, x, y, bl);
      ctx.lineTo(x, y + tl);
      if (tl) ctx.arcTo(x, y, x + w, y, tl);
      ctx.closePath();
      ctx.fill();
      return;
    }

    ctx.fillRect(x, y, cell, cell);
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

  // ---------- 模式切换：生成 / 扫码 ----------
  document.querySelectorAll('#modeSwitch button').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('#modeSwitch button').forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      var scan = b.dataset.mode === 'scan';
      $('genWrap').classList.toggle('off', scan);
      $('scanWrap').classList.toggle('on', scan);
    });
  });

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
