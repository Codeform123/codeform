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
    logoImg: null
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
    var target = 600;
    var cell = Math.floor(target / total);
    if (cell < 1) cell = 1;
    var drawSize = cell * total;

    canvas.width = drawSize;
    canvas.height = drawSize;

    // 背景
    ctx.fillStyle = state.bg;
    ctx.fillRect(0, 0, drawSize, drawSize);

    var offset = margin * cell;
    ctx.fillStyle = state.fg;

    var logosize = 0;
    if (state.logoImg) logosize = Math.floor(drawSize * 0.22);

    for (var r = 0; r < count; r++) {
      for (var c = 0; c < count; c++) {
        if (!qr.modules[r][c]) continue;
        var x = offset + c * cell;
        var y = offset + r * cell;
        // 定位角保护：不做形状变化
        drawModule(x, y, cell, r, c, count);
      }
    }

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

    $('versionInfo').textContent = '版本 ' + qr.size + '×' + qr.size;
    $('sizeInfo').textContent = '纠错 ' + state.ecLevel + ' · ' + drawSize + 'px';
  }

  function drawModule(x, y, cell, r, c, count) {
    if (state.dotStyle === 'square') {
      ctx.fillRect(x, y, cell, cell);
      return;
    }
    var gap = Math.max(0.5, cell * 0.08);
    if (state.dotStyle === 'dot') {
      var radius = (cell - gap) / 2;
      ctx.beginPath();
      ctx.arc(x + cell / 2, y + cell / 2, Math.max(0.6, radius), 0, Math.PI * 2);
      ctx.fill();
    } else { // rounded
      roundRect(ctx, x + gap / 2, y + gap / 2, cell - gap, cell - gap, Math.max(1, cell * 0.28));
      ctx.fill();
    }
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
    link.download = 'qr-studio-' + Date.now() + '.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
    toast('已下载 PNG');
  });

  $('downloadSvg').addEventListener('click', function () {
    var content = getContent();
    if (!content) return toast('请先输入内容');
    var qr;
    try { qr = window.QRCore.generate(content, state.ecLevel); }
    catch (e) { return toast('内容过长'); }
    var count = qr.size, margin = state.margin, total = count + margin * 2;
    var svg = ['<?xml version="1.0" encoding="UTF-8"?>',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total + '" shape-rendering="crispEdges">',
      '<rect width="' + total + '" height="' + total + '" fill="' + state.bg + '"/>'];
    for (var r = 0; r < count; r++) for (var c = 0; c < count; c++) {
      if (qr.modules[r][c]) svg.push('<rect x="' + (c + margin) + '" y="' + (r + margin) + '" width="1" height="1" fill="' + state.fg + '"/>');
    }
    svg.push('</svg>');
    var blob = new Blob([svg.join('')], { type: 'image/svg+xml' });
    var link = document.createElement('a');
    link.download = 'qr-studio-' + Date.now() + '.svg';
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
    $('fgColor').value = '#0a0c12'; $('bgColor').value = '#ffffff';
    $('margin').value = 4; $('marginVal').textContent = '4';
    $('logoDrop').textContent = '点击选择图片 · 自动圆形裁切';
    document.querySelectorAll('#dotStyle button').forEach(function (b) { b.classList.toggle('active', b.dataset.v === 'square'); });
    document.querySelectorAll('#ecLevel button').forEach(function (b) { b.classList.toggle('active', b.dataset.v === 'M'); });
    document.querySelectorAll('#fgSwatches .sw').forEach(function (s) { s.classList.toggle('sel', s.dataset.c === '#0a0c12'); });
    document.querySelectorAll('#bgSwatches .sw').forEach(function (s) { s.classList.toggle('sel', s.dataset.c === '#ffffff'); });
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
    // 等比缩放到合适尺寸（过大影响性能，过小丢精度）
    var maxSide = 1200;
    var w = img.naturalWidth || img.width;
    var h = img.naturalHeight || img.height;
    var scale = Math.min(1, maxSide / Math.max(w, h));
    var cw = Math.max(1, Math.round(w * scale));
    var ch = Math.max(1, Math.round(h * scale));

    var off = document.createElement('canvas');
    off.width = cw; off.height = ch;
    var octx = off.getContext('2d');
    octx.fillStyle = '#fff';
    octx.fillRect(0, 0, cw, ch);
    octx.drawImage(img, 0, 0, cw, ch);

    var data = octx.getImageData(0, 0, cw, ch);
    var result = null;
    try {
      result = window.jsQR(data.data, cw, ch, { inversionAttempts: 'attemptBoth' });
    } catch (e) { result = null; }
    return result && result.data ? result.data : '';
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
