/* QR Studio — 定位图案路径换算（Canvas / SVG 共用）
 *
 * 【设计意图】
 * 定位图案需要同时输出到 Canvas（像素）和 SVG（矢量）两条路径。
 * 两条路径的坐标系完全不同：
 *   Canvas —— 单位是像素，一个模块 = cell 像素，需要绝对坐标
 *   SVG    —— 单位是「模块」，且 SVG 里 1 个图案单位 = 1 个模块
 * 如果各写一套，几何稍有偏差就会出现「预览对了、导出歪了」。
 *
 * 做法：所有几何都在「单位盒」里算好（外接盒边长 = 1），
 * 再乘以各自的尺寸系数。这样两条路径共用同一份数学，不可能算不一样。
 *
 * 【三种形状的统一实现】
 *   方形 square  —— 外环直角矩形环 + 中心直角方块
 *   圆角 rounded —— 外环圆角矩形环 + 中心圆角方块
 *   圆点 dot     —— 外环椭圆环        + 中心圆形
 * 环形一律用「描边」实现：stroke 宽 = 盒子宽度的 1/7，正好等于 1 个模块的环宽，
 * 与旧版 fillRect 拼出来的环在视觉上完全一致；且圆角/圆形的环能自动居中，
 * 不用再做内挖空路径。
 *
 * 模块内路径统一按「1 单位 = 1 模块」设计，调用方传 scale 即可：
 *   Canvas: scale = cell      （模块像素）
 *   SVG   : scale = 1
 */
(function (root) {
  'use strict';

  var RING = 1 / 7;      // 环宽占外接盒的比例（7 模块盒子里 1 模块厚）
  var BOX = 7;           // 定位图案外接盒 = 7×7 模块
  var CENTER = 3;        // 中心方块 = 3×3 模块
  var CENTER_INSET = 2;  // 中心方块相对外接盒的偏移

  // 环的 stroke 宽度（外接盒边长 7 时为 1）
  function eyeRingWidth(boxSize) {
    return boxSize * RING;
  }

  // 环的外接盒中心（盒居中于 7×7 区域内）
  function eyeRingBox(x, y, boxSize, ringBoxSize) {
    return (boxSize - ringBoxSize) / 2 + x;
  }

  // 中心方块的外接盒中心
  function eyeCenterBox(x, y, boxSize, centerBoxSize) {
    return (boxSize - centerBoxSize) / 2 + x;
  }

  // 圆角环的圆角半径：必须让内、外两条弧同心
  function eyeRoundedRingRadius(boxSize) {
    return boxSize / 2 - eyeRingWidth(boxSize) / 2;
  }

  // 圆角矩形路径（半径 r，r 为 0 时退化为纯直角矩形，路径写法与旧版完全一致）
  function roundedRectPath(moveXY, half, r) {
    r = String(r);
    var x = moveXY.split(' ')[0];
    var y = moveXY.split(' ')[1];
    if (r === '0') {
      return 'M' + x + ' ' + y
        + 'H' + (+x + half * 2)
        + 'V' + (+y + half * 2)
        + 'H' + x
        + 'V' + y + 'Z';
    }
    var h = half;
    return 'M' + (+x + (+r)) + ' ' + y
      + 'H' + (+x + h * 2 - (+r))
      + 'A' + r + ' ' + r + ' 0 0 1 ' + (+x + h * 2) + ' ' + (+y + (+r))
      + 'V' + (+y + h * 2 - (+r))
      + 'A' + r + ' ' + r + ' 0 0 1 ' + (+x + h * 2 - (+r)) + ' ' + (+y + h * 2)
      + 'H' + (+x + (+r))
      + 'A' + r + ' ' + r + ' 0 0 1 ' + x + ' ' + (+y + h * 2 - (+r))
      + 'V' + (+y + (+r))
      + 'A' + r + ' ' + r + ' 0 0 1 ' + (+x + (+r)) + ' ' + y
      + 'Z';
  }

  // 圆形路径（用两段半圆弧，兼容所有渲染器）
  function circlePath(centerXY, cx, r) {
    var x = centerXY.split(' ')[0];
    var y = centerXY.split(' ')[1];
    return 'M' + x + ' ' + (+y - r)
      + 'A' + r + ' ' + r + ' 0 0 1 ' + x + ' ' + (+y + r)
      + 'A' + r + ' ' + r + ' 0 0 1 ' + x + ' ' + (+y - r)
      + 'Z';
  }

  root.ShapeMath = {
    RING: RING, BOX: BOX, CENTER: CENTER, CENTER_INSET: CENTER_INSET,
    eyeRingWidth: eyeRingWidth,
    eyeRingBox: eyeRingBox,
    eyeCenterBox: eyeCenterBox,
    eyeRoundedRingRadius: eyeRoundedRingRadius,
    roundedRectPath: roundedRectPath,
    circlePath: circlePath
  };
})(typeof window !== 'undefined' ? window : this);
