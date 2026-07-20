/**
 * HAIN Portfolio — 貓咪頭部滑鼠互動控制
 *
 * 核心規格（嚴格遵守）：
 *  - video: muted / playsinline / preload="auto" / 無 autoplay / 無 loop / 無 controls
 *  - 不呼叫 video.play()
 *  - delta = currentX - prevX
 *  - timeOffset = (delta / innerWidth) * 0.8 * duration
 *  - targetTime = targetTime + timeOffset  （正向：左移→看左，右移→看右）
 *  - targetTime 限制在 [0, duration]
 *  - 排隊 seek：未 seek 時立即執行，seek 中只更新 targetTime，seeked 後再追趕
 *  - 初始停在第一影格（currentTime = 0）
 */


/* ════════════════════════════════════════════════════════════
   加載畫面控制：資源就緒後淡出遮罩
   策略：等主影片 canplaythrough，至少 1.2s 後方可消失
   （讓貓咪有足夠時間跑幾步，視覺上更完整）
   ════════════════════════════════════════════════════════════ */
(function initLoader() {
    var loader = document.getElementById('page-loader');
    if (!loader) return;

    var minDisplayMs = 1800;   // 最短展示時間（ms）
    var startTime    = Date.now();
    var interactiveReady = false;
    var timeoutId    = null;

    function dismiss() {
        var elapsed = Date.now() - startTime;
        var delay   = Math.max(0, minDisplayMs - elapsed);
        setTimeout(function () {
            loader.classList.add('loaded');
            // transition 結束後移除 DOM，釋放記憶體
            loader.addEventListener('transitionend', function () {
                if (loader.parentNode) loader.parentNode.removeChild(loader);
            }, { once: true });
        }, delay);
    }

    function checkAndDismiss() {
        if (!interactiveReady) return;
        dismiss();
    }

    function onInteractiveReady() {
        if (timeoutId) clearTimeout(timeoutId);
        interactiveReady = true;
        checkAndDismiss();
    }

    // 等主影片與貓咪互動就緒事件
    function waitForVideo() {
        var vid = document.getElementById('bg-video');
        if (!vid) {
            interactiveReady = true;
            checkAndDismiss();
            return;
        }

        // 監聽貓咪互動模組就緒事件
        window.addEventListener('cat-interactive-ready', onInteractiveReady);

        // 如果在監聽前就已經就緒了（保險起見）
        if (window.isCatInteractiveReady) {
            onInteractiveReady();
            return;
        }

        // 保險機制：最長等 8 秒，防止資源載入失敗而卡住
        timeoutId = setTimeout(function () {
            console.warn('[HAIN] 載入超時，強制啟用互動並移除載入畫面');
            window.dispatchEvent(new CustomEvent('force-cat-ready'));
            onInteractiveReady();
        }, 8000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', waitForVideo);
    } else {
        waitForVideo();
    }
})();

(function () {
    'use strict';

    /* ── 狀態 ─────────────────────────────────────── */
    var canvas     = null;
    var ctx        = null;
    var frames     = [];
    var totalFrames = 101;
    var loadedFrames = 0;
    
    var biteFrames = [];
    var totalBiteFrames = 17;
    var loadedBiteFrames = 0;
    var biteRenderFrame = 0;

    var targetAngle = 0;
    var currentAngle = 0;
    var targetDist = 0;
    var currentDist = 0;

    var prevX      = null;
    var ready      = false;
    var animFrameId = null;
    var prefetchPromise = null;

    /* ── 初始化 ────────────────────────────────────── */
    function tryInit() {
        if (ready) return;
        if (loadedFrames < totalFrames || loadedBiteFrames < totalBiteFrames) return;
        
        ready = true;
        targetAngle = 0;
        currentAngle = 0;
        targetDist = 0;
        currentDist = 0;
        
        console.log('[HAIN] 所有序列圖預載完成，啟用零延遲 Canvas 渲染。');
        
        startRenderLoop();
        
        window.isCatInteractiveReady = true;
        window.dispatchEvent(new CustomEvent('cat-interactive-ready'));
    }

    /* ── 載入圖片 ──────────────────────────────────── */
    function loadFrames() {
        for (let i = 0; i < totalFrames; i++) {
            let img = new Image();
            let padIdx = i.toString().padStart(3, '0');
            img.src = 'CAT/LR_360_2_WEBP/frame_' + padIdx + '.webp';
            img.onload = function() {
                loadedFrames++;
                tryInit();
            };
            img.onerror = function() {
                console.error('[HAIN] 圖片載入失敗: ' + img.src);
            };
            frames.push(img);
        }

        for (let i = 0; i < totalBiteFrames; i++) {
            let img = new Image();
            let padIdx = i < 10 ? '0' + i : i;
            img.src = 'CAT/BITE_BG_WEBP/bite_' + padIdx + '.webp';
            img.onload = function() {
                loadedBiteFrames++;
                tryInit();
            };
            img.onerror = function() {
                console.error('[HAIN] 咬食圖片載入失敗: ' + img.src);
            };
            biteFrames.push(img);
        }
    }

    /* ── 咬食結束處理 ──────────────────────────────── */
    function onBiteEnded() {
        var targetHref = window.getTransitionHref ? window.getTransitionHref() : '#';
        if (targetHref && targetHref !== '#' && !targetHref.startsWith('javascript:')) {
            if (prefetchPromise) {
                prefetchPromise.then(function () { window.location.href = targetHref; });
            } else {
                window.location.href = targetHref;
            }
            return;
        }

        document.body.classList.remove('transition-active');
        var overlay = document.querySelector('.transition-overlay');
        if (overlay) overlay.classList.remove('active');

        targetAngle = 0;
        currentAngle = 0;
        targetDist = 0;
        currentDist = 0;
        biteRenderFrame = 0;
        prevX = null;

        setTimeout(function () {
            if (window.respawnBug) window.respawnBug();
        }, 1000);
    }

    /* ── 360度角度對應幀數計算 ────────────────────────── */
    function getFrameForAngle(adjustedAngle) {
        // 依照使用者精確指定的影格：
        // Up (0) -> Frame 16
        // Right (PI/2) -> Frame 31
        // Down (PI) -> Frame 43
        // Left (3*PI/2) -> Frame 58
        // Up (2*PI) -> Frame 72
        var points = [
            { a: 0, f: 16 },
            { a: Math.PI / 2, f: 31 },
            { a: Math.PI, f: 43 },
            { a: 3 * Math.PI / 2, f: 58 },
            { a: 2 * Math.PI, f: 72 }
        ];

        for (var i = 0; i < points.length - 1; i++) {
            var p1 = points[i];
            var p2 = points[i+1];
            if (adjustedAngle >= p1.a && adjustedAngle <= p2.a) {
                var t = (adjustedAngle - p1.a) / (p2.a - p1.a);
                return p1.f + t * (p2.f - p1.f);
            }
        }
        return 16;
    }

    /* ── 圓形最短路徑插值 ────────────────────────────── */
    function interpolateCircle(f1, f2, t) {
        var diff = f2 - f1;
        while (diff < -50) diff += 100;
        while (diff > 50) diff -= 100;
        var val = f1 + diff * t;
        if (val < 0) val += 100;
        if (val >= 100) val -= 100;
        return val;
    }

    /* ── 平滑渲染核心 ──────────────────────────────── */
    function startRenderLoop() {
        if (animFrameId) return;

        function update() {
            if (!ready) {
                animFrameId = requestAnimationFrame(update);
                return;
            }

            if (canvas && canvas.style.display === 'none') {
                animFrameId = requestAnimationFrame(update);
                return;
            }

            if (window.isBugEaten) {
                // 正常線性速率，不調快也不做特殊減速，保持序列幀原本的流暢質感
                biteRenderFrame += 0.35; 
                var bIndex = Math.max(0, Math.min(totalBiteFrames - 1, Math.floor(biteRenderFrame)));
                var bImg = biteFrames[bIndex];
                
                if (bImg && bImg.complete && ctx) {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    // 咬的動作整體下移 60px，保證與平常追蹤頭部位置完美對齊不跳變
                    var biteOffsetY = 60;
                    ctx.drawImage(bImg, 0, biteOffsetY, canvas.width, canvas.height);
                }

                if (biteRenderFrame >= totalBiteFrames) {
                    window.isBugEaten = false;
                    onBiteEnded();
                }
                
                animFrameId = requestAnimationFrame(update);
                return;
            }

            // 在「角度輸入空間」做最短路徑平滑插值，徹底解決影格邊界突變造成的抖動
            var diffAngle = targetAngle - currentAngle;
            while (diffAngle < -Math.PI) diffAngle += 2 * Math.PI;
            while (diffAngle > Math.PI) diffAngle -= 2 * Math.PI;

            if (Math.abs(diffAngle) < 0.001) {
                currentAngle = targetAngle;
            } else {
                currentAngle += diffAngle * 0.15; // 平滑插值速度
            }

            // 確保角度在 [0, 2*PI] 之間
            if (currentAngle < 0) currentAngle += 2 * Math.PI;
            if (currentAngle >= 2 * Math.PI) currentAngle -= 2 * Math.PI;

            // 在「距離輸入空間」做平滑插值
            var diffDist = targetDist - currentDist;
            if (Math.abs(diffDist) < 0.1) {
                currentDist = targetDist;
            } else {
                currentDist += diffDist * 0.15;
            }

            // 根據插值後的角度與距離計算出最終應顯示的影格值
            var angleFrame = getFrameForAngle(currentAngle);
            var minDeadzone = 60;
            var maxDeadzone = 160;
            
            // 根據角度選擇最接近的正面中性影格 (0 或 100)
            var centerFrame = (currentAngle <= Math.PI) ? 0 : 100;
            
            var frameVal = 0;
            if (currentDist < minDeadzone) {
                frameVal = centerFrame;
            } else if (currentDist < maxDeadzone) {
                var t = (currentDist - minDeadzone) / (maxDeadzone - minDeadzone);
                frameVal = interpolateCircle(centerFrame, angleFrame, t);
            } else {
                frameVal = angleFrame;
            }

            var frameIndex = Math.max(0, Math.min(totalFrames - 1, Math.round(frameVal)));
            var img = frames[frameIndex];
            
            if (img && img.complete && ctx) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            }

            animFrameId = requestAnimationFrame(update);
        }

        animFrameId = requestAnimationFrame(update);
    }

    /* ── 2D 滑鼠座標計算 ────────────────────────────── */
    function processXY(clientX, clientY) {
        if (!ready) return;
        if (window.isBugEaten) return;

        // 計算 Canvas 中心點（貓咪頭部位置）
        var rect = canvas.getBoundingClientRect();
        var catCenterX = rect.left + rect.width / 2;
        var catCenterY = rect.top + rect.height / 2;

        var dx = clientX - catCenterX;
        var dy = clientY - catCenterY;
        targetDist = Math.sqrt(dx * dx + dy * dy);

        var angle = Math.atan2(dy, dx);
        
        // 調整角度，讓向上為 0 弧度，順時針增加
        targetAngle = angle + Math.PI / 2;
        if (targetAngle < 0) targetAngle += 2 * Math.PI;
    }

    /* ── 掛載事件（在 DOM 就緒後執行） ─────────────── */
    function mount() {
        canvas = document.getElementById('bg-canvas');

        if (!canvas) {
            console.error('[HAIN] 找不到 #bg-canvas');
            return;
        }
        
        ctx = canvas.getContext('2d');

        // 初始化全域吃蟲狀態
        window.isBugEaten = false;

        // 開始載入圖片序列
        loadFrames();

        /* 監聽外部強制就緒事件 */
        window.addEventListener('force-cat-ready', function () {
            ready = true;
            window.isCatInteractiveReady = true;
            window.dispatchEvent(new CustomEvent('cat-interactive-ready'));
        });

        /* 滑鼠 mousemove */
        window.addEventListener('mousemove', function (e) {
            processXY(e.clientX, e.clientY);
        });

        /* 觸控 touchmove（手機端） */
        window.addEventListener('touchmove', function (e) {
            if (e.touches && e.touches[0]) {
                processXY(e.touches[0].clientX, e.touches[0].clientY);
            }
        }, { passive: true });

        /* 滑鼠離開視窗時重置 prevX */
        document.addEventListener('mouseleave', function () { prevX = null; });
        window.addEventListener('blur', function () { prevX = null; });
        document.addEventListener('visibilitychange', function () { if (document.hidden) prevX = null; });
        window.addEventListener('bug-model-loaded', function () { prevX = null; });

        /* 實作貓咪奔跑/咬食影片播控 */
        window.playCatEat = function () {
            window.isBugEaten = true;
            biteRenderFrame = 0;
        };

        /* ── 全域攔截連結點擊，觸發轉場特效 ── */
        document.querySelectorAll('a').forEach(function(link) {
            link.addEventListener('click', function(e) {
                var href = this.getAttribute('href');
                var target = this.getAttribute('target');
                
                if (href && href !== '#' && !href.startsWith('javascript:') && target !== '_blank' && !href.startsWith('mailto:')) {
                    e.preventDefault();
                    window.getTransitionHref = function() { return href; };

                    prefetchPromise = fetch(href)
                        .then(function (res) {
                            if (!res.ok) throw new Error();
                            return res.text();
                        })
                        .catch(function (err) {
                            console.warn('[HAIN] 網頁預載失敗:', err);
                        });

                    document.body.classList.add('transition-active');
                    var overlay = document.querySelector('.transition-overlay');
                    if (overlay) overlay.classList.add('active');

                    if (window.playCatEat) {
                        window.playCatEat();
                    } else {
                        var delayPromise = new Promise(function (resolve) { setTimeout(resolve, 800); });
                        var p = prefetchPromise || Promise.resolve();
                        Promise.all([p, delayPromise]).then(function () {
                            window.location.href = href;
                        });
                    }
                }
            });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
    } else {
        mount();
    }
}());
