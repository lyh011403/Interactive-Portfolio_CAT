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
    var totalFrames = 31;
    var loadedFrames = 0;
    
    var biteFrames = [];
    var totalBiteFrames = 17;
    var loadedBiteFrames = 0;
    var biteRenderFrame = 0;

    var targetFrame = 15; // 中間幀
    var currentRenderFrame = 15;
    var prevX      = null;
    var ready      = false;
    var animFrameId = null;
    var prefetchPromise = null;

    /* ── 初始化 ────────────────────────────────────── */
    function tryInit() {
        if (ready) return;
        if (loadedFrames < totalFrames || loadedBiteFrames < totalBiteFrames) return;
        
        ready = true;
        targetFrame = (totalFrames - 1) / 2;
        currentRenderFrame = targetFrame;
        
        console.log('[HAIN] 所有序列圖預載完成，啟用零延遲 Canvas 渲染。');
        
        startRenderLoop();
        
        window.isCatInteractiveReady = true;
        window.dispatchEvent(new CustomEvent('cat-interactive-ready'));
    }

    /* ── 載入圖片 ──────────────────────────────────── */
    function loadFrames() {
        for (let i = 0; i < totalFrames; i++) {
            let img = new Image();
            let padIdx = i < 10 ? '0' + i : i;
            img.src = 'CAT/LR_BK_WEBP/frame_' + padIdx + '.webp';
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

        targetFrame = (totalFrames - 1) / 2;
        currentRenderFrame = targetFrame;
        prevX = null;

        setTimeout(function () {
            if (window.respawnBug) window.respawnBug();
        }, 1000);
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
                // 播放咬食動畫 (假設 requestAnimationFrame 為 60fps，我們讓它以大約 24~30fps 播放)
                biteRenderFrame += 0.45; 
                var bIndex = Math.max(0, Math.min(totalBiteFrames - 1, Math.floor(biteRenderFrame)));
                var bImg = biteFrames[bIndex];
                
                if (bImg && bImg.complete && ctx) {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(bImg, 0, 0, canvas.width, canvas.height);
                }

                if (biteRenderFrame >= totalBiteFrames) {
                    window.isBugEaten = false;
                    onBiteEnded();
                }
                
                animFrameId = requestAnimationFrame(update);
                return;
            }

            // 平滑插值 (Lerp)：讓 currentRenderFrame 平滑趨近 targetFrame
            var diff = targetFrame - currentRenderFrame;
            if (Math.abs(diff) < 0.01) {
                currentRenderFrame = targetFrame;
            } else {
                currentRenderFrame += diff * 0.15; // 平滑插值
            }

            var frameIndex = Math.max(0, Math.min(totalFrames - 1, Math.round(currentRenderFrame)));
            var img = frames[frameIndex];
            
            if (img && img.complete && ctx) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            }

            animFrameId = requestAnimationFrame(update);
        }

        animFrameId = requestAnimationFrame(update);
    }

    /* ── 滑鼠位移計算 ──────────────────────────────── */
    function processX(currentX) {
        if (!ready) return;
        if (window.isBugEaten) return;

        var TELEPORT_THRESHOLD = window.innerWidth * 0.5;
        var isTeleport = prevX !== null && Math.abs(currentX - prevX) > TELEPORT_THRESHOLD;

        if (prevX === null || isTeleport) {
            prevX = currentX;
            targetFrame = (currentX / window.innerWidth) * (totalFrames - 1);
            targetFrame = Math.max(0, Math.min(totalFrames - 1, targetFrame));
            return;
        }

        var delta      = currentX - prevX;
        prevX          = currentX;

        var frameOffset = (delta / window.innerWidth) * 0.8 * (totalFrames - 1);
        targetFrame     = targetFrame + frameOffset;
        targetFrame     = Math.max(0, Math.min(totalFrames - 1, targetFrame));
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
            processX(e.clientX);
        });

        /* 觸控 touchmove（手機端） */
        window.addEventListener('touchmove', function (e) {
            if (e.touches && e.touches[0]) {
                processX(e.touches[0].clientX);
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
