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
    var video      = null;
    var duration   = 0;
    var targetTime = 0;
    var prevX      = null;
    var ready      = false;
    var seeking    = false;
    var seekTimeout = null; // 解鎖安全定時器，避免 Chrome 在無 Range 請求伺服器下 seek 永久鎖死
    var currentRenderTime = 0; // 平滑渲染時間
    var lastSeekTime = 0;       // 上一次 seek 的時間戳記
    var animFrameId = null;     // requestAnimationFrame ID
    var prefetchPromise = null; // 網頁預載入 Promise

    /* ── 初始化 ────────────────────────────────────── */
    function isFullyBuffered() {
        if (!video) return false;
        if (!video.buffered || video.buffered.length === 0) return false;
        // 確認緩衝範圍涵蓋了影片結尾（留一點誤差容忍度）
        return video.buffered.end(video.buffered.length - 1) >= duration - 0.1;
    }

    function tryInit(force) {
        if (ready) return;
        if (!video) return;
        if (video.readyState < 1) return; // 確保中繼資料已就緒，防堵 Chrome 未加載 readyState

        var d = video.duration;
        if (!d || d !== d || !isFinite(d) || d <= 0) return; // NaN / Infinity / 0

        duration = d; // 先取得 duration，供 isFullyBuffered 使用

        // 偵測行動裝置（手機/平板）或無 hover 能力的觸控螢幕
        var isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) 
            || (window.matchMedia && window.matchMedia("(any-hover: none)").matches);

        // 桌機端：要求必須完整緩衝才啟用，以達極致 seek 體驗；
        // 行動端：因手機瀏覽器有強制的流量省電限制，不允許背景預下載整支影片，因此只要 readyState 就緒便直接啟用
        if (!force && !isMobile && !isFullyBuffered()) return;

        ready      = true;
        targetTime = d / 2; // 預設視線停在正中間（看著正前方）
        currentRenderTime = d / 2;

        try { video.currentTime = d / 2; } catch (e) {}

        console.log('[HAIN] 影片就緒，duration =', duration.toFixed(3), 's, mobile =', isMobile, 'forced =', !!force);

        // 啟動平滑渲染迴圈
        startRenderLoop();

        // 發送貓咪互動就緒事件
        window.isCatInteractiveReady = true;
        window.dispatchEvent(new CustomEvent('cat-interactive-ready'));
    }

    /* ── Blob 預載入與平滑渲染核心 ─────────────────── */
    function loadVideoBlob(vidEl, url, label) {
        return fetch(url)
            .then(function (res) {
                if (!res.ok) throw new Error('Fetch failed for ' + url);
                return res.blob();
            })
            .then(function (blob) {
                var objectURL = URL.createObjectURL(blob);
                vidEl.src = objectURL;
                vidEl.load();
                console.log('[HAIN] 影片已預載入至 Blob:', label);
            });
    }

    function startRenderLoop() {
        if (animFrameId) return;

        function update() {
            if (!ready) {
                animFrameId = requestAnimationFrame(update);
                return;
            }

            // 若吃蟲中或影片隱藏，跳過 seek
            if (window.isBugEaten || (video && video.style.display === 'none')) {
                animFrameId = requestAnimationFrame(update);
                return;
            }

            // 平滑插值 (Lerp)：讓 currentRenderTime 平滑趨近 targetTime
            var diff = targetTime - currentRenderTime;
            if (Math.abs(diff) < 0.001) {
                currentRenderTime = targetTime;
            } else {
                currentRenderTime += diff * 0.15; // 0.15 為緩動係數
            }

            // 限制 seek 頻率（每 30ms 最多一次）
            var now = Date.now();
            if (!seeking && (now - lastSeekTime > 30)) {
                var seekDiff = Math.abs(video.currentTime - currentRenderTime);
                // 當時間差距大於一定閾值（例如 0.005 秒）時才執行尋軌
                if (seekDiff > 0.005) {
                    seeking = true;
                    lastSeekTime = now;

                    if (seekTimeout) clearTimeout(seekTimeout);
                    seekTimeout = setTimeout(function () {
                        if (seeking) {
                            seeking = false;
                        }
                    }, 100); // 100ms 安全解鎖

                    try {
                        video.currentTime = currentRenderTime;
                    } catch (e) {
                        seeking = false;
                    }
                }
            }

            animFrameId = requestAnimationFrame(update);
        }

        animFrameId = requestAnimationFrame(update);
    }

    /* ── 滑鼠位移計算 ──────────────────────────────── */
    function processX(currentX) {
        if (!ready) return;
        if (window.isBugEaten) return; // 正在咬食中，不接收滑鼠控制影片

        // 「瞬移」偵測：如果這次位移量大到不合理（例如跨螢幕移動、或視窗失焦/mouseleave
        // 沒有確實觸發導致 prevX 停留在舊座標），就不要用增量公式去算，
        // 直接當成「首次進入」重新絕對對齊，避免視線卡在錯誤方向直到重新整理頁面。
        var TELEPORT_THRESHOLD = window.innerWidth * 0.5;
        var isTeleport = prevX !== null && Math.abs(currentX - prevX) > TELEPORT_THRESHOLD;

        if (prevX === null || isTeleport) {
            prevX = currentX;
            // 第一次偵測到滑鼠（或滑鼠離屏重入、或偵測到瞬移）時，絕對對齊滑鼠坐標
            targetTime = (currentX / window.innerWidth) * duration;
            targetTime = Math.max(0, Math.min(duration, targetTime));
            return;
        }

        var delta      = currentX - prevX;
        prevX          = currentX;

        var timeOffset = (delta / window.innerWidth) * 0.8 * duration;
        targetTime     = targetTime + timeOffset;
        targetTime     = Math.max(0, Math.min(duration, targetTime));
    }

    /* ── 掛載事件（在 DOM 就緒後執行） ─────────────── */
    function mount() {
        video = document.getElementById('bg-video');
        var eatVideo = document.getElementById('eat-video');

        if (!video) {
            console.error('[HAIN] 找不到 #bg-video');
            return;
        }

        // 初始化全域吃蟲狀態
        window.isBugEaten = false;

        // 啟動 Blob 預載機制（異步下載整個影片，保證 Seek 零延遲且不需 Range 請求）
        var p1 = loadVideoBlob(video, 'CAT/CAT02.mp4', '轉頭影片');
        var p2 = eatVideo ? loadVideoBlob(eatVideo, 'CAT/CAT_咬.mp4', '咬食影片') : Promise.resolve();

        Promise.all([p1, p2])
            .then(function () {
                console.log('[HAIN] 所有影片資源均已載入記憶體 Blob，啟用零延遲 Seek。');
            })
            .catch(function (err) {
                console.warn('[HAIN] Blob 預載失敗，降級為原生影片加載 (可能是 file:// 協議 CORS 限制):', err);
                try {
                    video.load();
                    if (eatVideo) eatVideo.load();
                } catch (e) {}
            });

        /* seeked：解鎖 */
        video.addEventListener('seeked', function () {
            if (seekTimeout) clearTimeout(seekTimeout);
            seeking = false;
        });

        /* 監聽所有可能帶出 duration 的影片事件 */
        ['loadedmetadata', 'durationchange', 'canplay', 'canplaythrough'].forEach(function (evt) {
            video.addEventListener(evt, function () { tryInit(false); });
        });

        /* 監聽外部強制就緒事件 */
        window.addEventListener('force-cat-ready', function () {
            tryInit(true);
        });

        /* 若已緩存（readyState >= 1 = HAVE_METADATA），直接嘗試 */
        tryInit(false);

        /* 終極保底：每 80ms 輪詢一次，直到 duration 有效 */
        var poll = setInterval(function () {
            tryInit(false);
            if (ready) clearInterval(poll);
        }, 80);

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

        /* 滑鼠離開視窗時重置 prevX，防止重新進入時發生大幅跳躍 */
        document.addEventListener('mouseleave', function () {
            prevX = null;
        });

        /* 保險：mouseleave 在雙螢幕/視窗跨屏移動時有時不會確實觸發，
           額外用「視窗失焦」與「分頁切換到背景」也重置 prevX，
           確保下一次滑鼠移動一定會重新絕對對齊，不會卡在錯誤方向 */
        window.addEventListener('blur', function () {
            prevX = null;
        });
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) prevX = null;
        });

        /* 當 3D 昆蟲模型載入組裝完成時，重置 prevX 以進行精準的重新絕對對齊，
           防止載入期間的 CPU 卡頓/影格遺失導致相對增量計算產生視線漂移 */
        window.addEventListener('bug-model-loaded', function () {
            prevX = null;
        });

        /* 實作貓咪奔跑/咬食影片播控 */
        window.playCatEat = function () {
            if (!eatVideo) return;
            
            // 隱藏轉頭影片，顯示奔跑影片
            video.style.display = 'none';
            eatVideo.style.display = 'block';
            
            // 恢復原本的播放速率
            eatVideo.playbackRate = 1.0;
            
            eatVideo.currentTime = 0;
            var playPromise = eatVideo.play();
            
            if (playPromise !== undefined) {
                playPromise.catch(function (error) {
                    console.warn('[HAIN] 貓咪影片播放受限 (無瀏覽器互動許可)，執行自動復原:', error);
                    // 備份：萬一播放失敗，1秒後強制復原
                    setTimeout(function () {
                        if (window.respawnBug) window.respawnBug();
                    }, 1000);
                });
            }
        };

        /* 監聽奔跑結束事件，切換回轉頭影片並跳轉或觸發昆蟲重生 */
        if (eatVideo) {
            eatVideo.addEventListener('ended', function () {
                var targetHref = window.getTransitionHref ? window.getTransitionHref() : '#';
                if (targetHref && targetHref !== '#' && !targetHref.startsWith('javascript:')) {
                    // 等待預載完成後再執行跳轉，消除黑屏等待時間
                    if (prefetchPromise) {
                        prefetchPromise.then(function () {
                            window.location.href = targetHref;
                        });
                    } else {
                        window.location.href = targetHref;
                    }
                    return;
                }

                // 如果是測試用的空連結，則重置狀態供使用者重複測試
                eatVideo.style.display = 'none';
                video.style.display = 'block';
                document.body.classList.remove('transition-active');
                var overlay = document.querySelector('.transition-overlay');
                if (overlay) overlay.classList.remove('active');

                // 將轉頭影片的目標時間軸平滑重設為中間（正對前方）
                targetTime = duration / 2;
                currentRenderTime = duration / 2;
                prevX = null; // 重置滑鼠坐標，使下一次移動時重新絕對對齊
                try {
                    video.currentTime = targetTime;
                } catch (e) {}

                // 奔跑後等待 1000ms，觸發昆蟲在滑鼠位置重生
                setTimeout(function () {
                    if (window.respawnBug) {
                        window.respawnBug();
                    }
                }, 1000);
            });
        }

        /* ── 全域攔截連結點擊，觸發轉場特效 ── */
        document.querySelectorAll('a').forEach(function(link) {
            link.addEventListener('click', function(e) {
                var href = this.getAttribute('href');
                var target = this.getAttribute('target');
                
                // 排除空白連結、JS 代碼、錨點，以及新分頁開啟
                if (href && href !== '#' && !href.startsWith('javascript:') && target !== '_blank' && !href.startsWith('mailto:')) {
                    e.preventDefault();
                    window.getTransitionHref = function() { return href; };

                    // 啟動背景 Fetch 下載 HTML 預載入，加速跳轉渲染
                    prefetchPromise = fetch(href)
                        .then(function (res) {
                            if (!res.ok) throw new Error();
                            return res.text();
                        })
                        .catch(function (err) {
                            console.warn('[HAIN] 網頁預載失敗:', err);
                        });

                    // 啟動全螢幕黑幕與 UI 隱藏特效
                    document.body.classList.add('transition-active');
                    var overlay = document.querySelector('.transition-overlay');
                    if (overlay) overlay.classList.add('active');

                    // 若首頁有貓咪奔跑影片，則播放；否則(如作品、關於頁面)直接等待黑畫面蓋滿後跳轉
                    if (window.playCatEat && document.getElementById('eat-video')) {
                        window.playCatEat();
                    } else {
                        // 同時等待黑幕蓋滿 800ms 且網頁預載完成後才跳轉
                        var delayPromise = new Promise(function (resolve) {
                            setTimeout(resolve, 800);
                        });
                        var p = prefetchPromise || Promise.resolve();
                        Promise.all([p, delayPromise]).then(function () {
                            window.location.href = href;
                        });
                    }
                }
            });
        });
    }

    /* ── 入口 ──────────────────────────────────────── */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
    } else {
        // script 在 body 底部，DOM 已就緒，直接執行
        mount();
    }

}());
