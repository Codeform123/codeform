/* ZipLite — 极简 ZIP 打包器（stored 模式，不压缩）
 *
 * 为什么不用现成的 zip 库：
 *   1. 保持零外链依赖 —— 整站所有 JS 都是本地文件
 *   2. PNG 已经是压缩格式，再套一层 DEFLATE 几乎压不掉体积，白白多几百 KB 代码
 *   3. stored 模式实现简单到可以完整审计，不会有隐藏的坑
 *
 * 生成的 ZIP 是标准格式，Windows / macOS / Linux 的解压工具都能正常打开。
 *
 * 用法：
 *   var zip = new ZipLite();
 *   zip.add('a.png', uint8array);        // 或 zip.add('a.txt', '字符串')
 *   var blob = zip.build();              // 返回 Blob
 *   download(blob, 'pack.zip');
 */
(function () {
  'use strict';

  // ---- CRC32（ZIP 每个文件都要带校验和）----
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // ---- UTF-8 编码（文件名可能是中文）----
  function utf8(str) {
    if (window.TextEncoder) return new TextEncoder().encode(str);
    // 兜底：手写 UTF-8
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) {
        out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      } else if (c >= 0xD800 && c <= 0xDBFF) {
        var c2 = str.charCodeAt(++i);
        var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
        out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63),
                 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else {
        out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
    }
    return new Uint8Array(out);
  }

  function toBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (typeof data === 'string') return utf8(data);
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    return new Uint8Array(data);
  }

  // ---- 小端写入工具 ----
  function Writer() {
    this.parts = [];
    this.len = 0;
  }
  Writer.prototype.u8 = function (v) {
    this.parts.push(new Uint8Array([v & 0xFF])); this.len += 1;
  };
  Writer.prototype.u16 = function (v) {
    this.parts.push(new Uint8Array([v & 0xFF, (v >>> 8) & 0xFF])); this.len += 2;
  };
  Writer.prototype.u32 = function (v) {
    this.parts.push(new Uint8Array([
      v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF
    ])); this.len += 4;
  };
  Writer.prototype.raw = function (bytes) {
    this.parts.push(bytes); this.len += bytes.length;
  };
  Writer.prototype.merge = function () {
    var out = new Uint8Array(this.len);
    var off = 0;
    for (var i = 0; i < this.parts.length; i++) {
      out.set(this.parts[i], off);
      off += this.parts[i].length;
    }
    return out;
  };

  function ZipLite() {
    this.entries = [];
  }

  // 统一走 DOS 时间；用固定值可让同内容产物完全可复现
  ZipLite.prototype.add = function (name, data) {
    var nameBytes = utf8(name);
    var content = toBytes(data);
    this.entries.push({
      name: name,
      nameBytes: nameBytes,
      content: content,
      crc: crc32(content),
      size: content.length
    });
    return this;
  };

  ZipLite.prototype.count = function () { return this.entries.length; };

  // 返回 Blob（application/zip）
  ZipLite.prototype.build = function () {
    var w = new Writer();
    var central = [];   // 记录每个文件对应的「中央目录」条目
    var offset = 0;

    var DOS_TIME = 0;   // 00:00:00
    var DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;   // 2026-01-01

    for (var i = 0; i < this.entries.length; i++) {
      var e = this.entries[i];
      var localStart = offset;

      // ---- 本地文件头 ----
      var lh = new Writer();
      lh.u32(0x04034B50);          // 签名
      lh.u16(20);                  // 版本需求 2.0
      lh.u16(0x0800);              // 标志位：bit 11 = 文件名是 UTF-8
      lh.u16(0);                   // 压缩方式 0 = stored
      lh.u16(DOS_TIME);
      lh.u16(DOS_DATE);
      lh.u32(e.crc);
      lh.u32(e.size);              // 压缩后大小
      lh.u32(e.size);              // 原始大小
      lh.u16(e.nameBytes.length);
      lh.u16(0);                   // 扩展字段长度
      var lhBytes = lh.merge();

      w.raw(lhBytes);
      w.raw(e.nameBytes);
      w.raw(e.content);
      offset += lhBytes.length + e.nameBytes.length + e.content.length;

      central.push({ entry: e, localOffset: localStart });
    }

    // ---- 中央目录 ----
    var cdStart = offset;
    for (var j = 0; j < central.length; j++) {
      var c = central[j], ce = c.entry;
      var ch = new Writer();
      ch.u32(0x02014B50);          // 中央目录签名
      ch.u16(20);                  // 创建版本
      ch.u16(20);                  // 解压所需版本
      ch.u16(0x0800);              // UTF-8 标志
      ch.u16(0);                   // stored
      ch.u16(DOS_TIME);
      ch.u16(DOS_DATE);
      ch.u32(ce.crc);
      ch.u32(ce.size);
      ch.u32(ce.size);
      ch.u16(ce.nameBytes.length);
      ch.u16(0);                   // 扩展字段
      ch.u16(0);                   // 注释
      ch.u16(0);                   // 磁盘号
      ch.u16(0);                   // 内部属性
      ch.u32(0x20);                // 外部属性（归档位）
      ch.u32(c.localOffset);
      var chBytes = ch.merge();
      w.raw(chBytes);
      w.raw(ce.nameBytes);
      offset += chBytes.length + ce.nameBytes.length;
    }
    var cdSize = offset - cdStart;

    // ---- 中央目录结束记录 ----
    var eocd = new Writer();
    eocd.u32(0x06054B50);
    eocd.u16(0);                   // 当前磁盘
    eocd.u16(0);                   // 目录起始磁盘
    eocd.u16(central.length);      // 本磁盘条目数
    eocd.u16(central.length);      // 总条目数
    eocd.u32(cdSize);
    eocd.u32(cdStart);
    eocd.u16(0);                   // 注释长度
    w.raw(eocd.merge());

    return new Blob([w.merge()], { type: 'application/zip' });
  };

  window.ZipLite = ZipLite;
})();
