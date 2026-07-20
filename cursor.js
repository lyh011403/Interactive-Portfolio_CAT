/**
 * cursor.js — 貓掌游標
 * 手掌_A.png = 正常狀態（爪子伸出）
 * 手掌_B.png = 按下狀態（爪子踩下）
 * 微動畫：
 *  - 懸停連結/按鈕：輕輕上下浮動（呼吸感）
 *  - 按下：切換到 B 圖，整體縮小並往下偏移（踩踏感）
 *  - 放開：彈回 A 圖，帶 overshoot 彈跳
 *  - 移動時：輕微俯角旋轉跟隨方向
 *  - 閒置超過 2 秒：小幅晃動（貓咪不耐煩）
 */
(function () {
    'use strict';

    /* ── 路徑 ───────────────────────────────── */
    var BASE = (function () {
        var scripts = document.getElementsByTagName('script');
        for (var i = 0; i < scripts.length; i++) {
            var src = scripts[i].src || '';
            if (src.indexOf('cursor.js') !== -1) {
                return src.replace(/cursor\.js.*$/, '');
            }
        }
        return '';
    })();

    var IMG_A = BASE + 'CAT/%E6%89%8B%E6%8E%8C_A.png'; // 手掌_A.png
    var IMG_B = BASE + 'CAT/%E6%89%8B%E6%8E%8C_B.png'; // 手掌_B.png
    var IMG_SLEEP = BASE + 'CAT/CAT_SLEEP.gif'; // 閒置時的睡覺貓咪

    /* ── 注入 CSS ────────────────────────────── */
    var style = document.createElement('style');
    style.textContent = [
        /* 隱藏所有原生游標 */
        '*, *::before, *::after { cursor: none !important; }',

        /* 游標容器 */
        '#paw-cursor {',
        '  position: fixed;',
        '  top: 0; left: 0;',
        '  width: 72px; height: 72px;',
        '  pointer-events: none;',
        '  z-index: 2147483647;',
        '  /* 熱點校正：貓掌肉球中心 ≈ 圖片 45% x, 42% y */  ',
        '  transform: translate(-45%, -42%);',
        '  transform-origin: 45% 42%;',
        '  will-change: transform, left, top;',
        '  user-select: none;',
        '  transition: opacity 0.3s ease;',
        '}',

        /* 爪圖本體 */
        '#paw-cursor img {',
        '  width: 100%; height: 100%;',
        '  object-fit: contain;',
        '  display: block;',
        '  transition:',
        '    transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1),',
        '    opacity   0.12s ease;',
        '  filter: drop-shadow(0 4px 8px rgba(0,0,0,0.18));',
        '}',

        /* 按下時 B 圖疊在 A 圖上 */
        '#paw-cursor .paw-b {',
        '  position: absolute;',
        '  top: 0; left: 0;',
        '  opacity: 0;',
        '}',
        '',
        /* 閒置時的睡眠貓咪 */
        '#paw-cursor .paw-sleep {',
        '  position: absolute;',
        '  top: 50%; left: 50%;',
        '  /* 將錨點稍微調整，讓睡覺貓咪偏上一點點，整體放大到 150% 看得更清楚 */',
        '  transform: translate(-50%, -60%);',
        '  width: 150%; height: 150%;',
        '  opacity: 0;',
        '}',

        /* 懸停互動元素時 A 圖輕浮 */
        '#paw-cursor.hover .paw-a {',
        '  animation: pawHover 0.7s ease-in-out infinite alternate;',
        '}',

        /* 按下：A 隱藏，B 顯示 + 縮小踩踏 */
        '#paw-cursor.pressed .paw-a { opacity: 0; transform: scale(0.85) translateY(4px); }',
        '#paw-cursor.pressed .paw-b { opacity: 1; transform: scale(0.85) translateY(5px);',
        '  filter: drop-shadow(0 2px 3px rgba(0,0,0,0.25));',
        '}',

        /* 閒置時：隱藏貓掌，顯示睡覺貓咪 GIF */
        '#paw-cursor.idle .paw-a, #paw-cursor.idle .paw-b { opacity: 0 !important; animation: none; }',
        '#paw-cursor.idle .paw-sleep { opacity: 1; filter: drop-shadow(0 8px 16px rgba(0,0,0,0.2)); }',

        '@keyframes pawHover {',
        '  from { transform: translateY(0px)  scale(1.0); }',
        '  to   { transform: translateY(-5px) scale(1.05); }',
        '}',

        '@keyframes pawIdle {',
        '  0%,100% { transform: rotate(-4deg) translateY(0px); }',
        '  25%     { transform: rotate( 4deg) translateY(-3px); }',
        '  50%     { transform: rotate(-2deg) translateY(1px); }',
        '  75%     { transform: rotate( 3deg) translateY(-2px); }',
        '}',

        /* 點擊漣漪 */
        '.paw-ripple {',
        '  position: fixed;',
        '  pointer-events: none;',
        '  z-index: 2147483646;',
        '  width: 20px; height: 20px;',
        '  border-radius: 50%;',
        '  border: 2px solid rgba(168, 52, 28, 0.7);',
        '  transform: translate(-50%, -50%) scale(1);',
        '  animation: pawRipple 0.5s ease-out forwards;',
        '}',

        '@keyframes pawRipple {',
        '  0%   { transform: translate(-50%,-50%) scale(0.5); opacity: 0.8; }',
        '  100% { transform: translate(-50%,-50%) scale(4);   opacity: 0; }',
        '}',
    ].join('\n');
    document.head.appendChild(style);

    /* ── 建立 DOM ────────────────────────────── */
    var el = document.createElement('div');
    el.id = 'paw-cursor';

    var imgA = document.createElement('img');
    imgA.className = 'paw-a';
    imgA.src = IMG_A;
    imgA.alt = '';
    imgA.draggable = false;

    var imgB = document.createElement('img');
    imgB.className = 'paw-b';
    imgB.src = IMG_B;
    imgB.alt = '';
    imgB.draggable = false;

    var imgSleep = document.createElement('img');
    imgSleep.className = 'paw-sleep';
    imgSleep.src = IMG_SLEEP;
    imgSleep.alt = '';
    imgSleep.draggable = false;

    el.appendChild(imgA);
    el.appendChild(imgB);
    el.appendChild(imgSleep);
    document.body.appendChild(el);

    /* ── 狀態 ────────────────────────────────── */
    var mouseX = -200, mouseY = -200;
    var curX = -200, curY = -200;
    var isHover    = false;
    var isPressed  = false;
    var isVisible  = false;
    var idleTimer  = null;
    var isIdle     = false;
    var lastMoveTime = Date.now();
    var lastTiltX = 0; // 上一幀的 X 速度，用來計算傾斜角

    var LERP = 0.18;  // 跟隨速度，越大越即時

    /* ── 更新游標位置（rAF 迴圈） ───────────── */
    function tick() {
        var dx = mouseX - curX;
        var dy = mouseY - curY;
        curX += dx * LERP;
        curY += dy * LERP;

        // 根據水平速度計算小角度傾斜（-8° ~ 8°）
        var speedX = dx * LERP;
        var tilt = Math.max(-8, Math.min(8, speedX * 0.8));

        el.style.left = curX + 'px';
        el.style.top  = curY + 'px';

        // 傾斜只套用在非按下、非懸停動畫的狀態
        if (!isPressed && !isIdle) {
            if (!isHover) {
                el.style.transform = 'translate(-45%, -42%) rotate(' + tilt.toFixed(1) + 'deg)';
            } else {
                // 懸停時恢復 0 度，讓 pawHover 動畫自然
                el.style.transform = 'translate(-45%, -42%) rotate(0deg)';
            }
        }

        requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);

    /* ── 重置閒置計時器 ─────────────────────── */
    function resetIdle() {
        if (idleTimer) clearTimeout(idleTimer);
        if (isIdle) {
            isIdle = false;
            el.classList.remove('idle');
        }
        idleTimer = setTimeout(function () {
            if (!isPressed) {
                isIdle = true;
                el.classList.add('idle');
                el.style.transform = 'translate(-45%, -42%) rotate(0deg)';
            }
        }, 2000);
    }

    /* ── 滑鼠移動 ───────────────────────────── */
    document.addEventListener('mousemove', function (e) {
        mouseX = e.clientX;
        mouseY = e.clientY;
        lastMoveTime = Date.now();
        resetIdle();

        if (!isVisible) {
            isVisible = true;
            el.style.opacity = '1';
            curX = mouseX; curY = mouseY; // 第一次直接對齊
        }
    });

    /* ── 互動元素偵測 ───────────────────────── */
    var interSel = 'a, button, [role="button"], input, textarea, select, label, [tabindex]';

    document.addEventListener('mouseover', function (e) {
        if (e.target.closest(interSel)) {
            if (!isHover) { isHover = true; el.classList.add('hover'); }
        }
    });

    document.addEventListener('mouseout', function (e) {
        if (e.target.closest(interSel)) {
            var rel = e.relatedTarget;
            if (!rel || !rel.closest(interSel)) {
                isHover = false;
                el.classList.remove('hover');
            }
        }
    });

    /* ── 按下 / 放開 ─────────────────────────── */
    document.addEventListener('mousedown', function (e) {
        isPressed = true;
        isIdle = false;
        if (idleTimer) clearTimeout(idleTimer);
        el.classList.remove('idle');
        el.classList.add('pressed');
        el.style.transform = 'translate(-45%, -42%) rotate(0deg)';
        spawnRipple(e.clientX, e.clientY);
    });

    document.addEventListener('mouseup', function () {
        isPressed = false;
        el.classList.remove('pressed');
        resetIdle();
    });

    /* ── 游標離開 / 進入視窗 ────────────────── */
    document.addEventListener('mouseleave', function () {
        el.style.opacity = '0';
        isVisible = false;
    });

    document.addEventListener('mouseenter', function () {
        el.style.opacity = '1';
        isVisible = true;
    });

    /* ── 漣漪工廠 ────────────────────────────── */
    function spawnRipple(x, y) {
        var r = document.createElement('div');
        r.className = 'paw-ripple';
        r.style.left = x + 'px';
        r.style.top  = y + 'px';
        document.body.appendChild(r);
        r.addEventListener('animationend', function () { r.remove(); });
    }

    /* ── 預載圖片 B 與 SLEEP，避免切換瞬間空白 ──────── */
    (new Image()).src = IMG_B;
    (new Image()).src = IMG_SLEEP;

})();
