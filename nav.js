// 全站配色主題配置
const themes = {
    classic: { accent: '#A8341C' },
    orange:  { accent: '#E67E22' },
    blue:    { accent: '#1F618D' },
    brown:   { accent: '#8A5E38' }
};

// 立即套用 CSS 變數，避免其他頁面文字/按鈕顏色閃爍
const savedTheme = localStorage.getItem('cat-theme') || 'classic';
document.documentElement.style.setProperty('--accent', (themes[savedTheme] || themes.classic).accent);

function applyGlobalTheme(themeName) {
    const theme = themes[themeName] || themes.classic;
    document.documentElement.style.setProperty('--accent', theme.accent);
    
    // 如果有貓咪畫布，則加上對應的花色濾鏡
    const catCanvas = document.getElementById('bg-canvas');
    if (catCanvas) {
        catCanvas.classList.remove('theme-classic', 'theme-orange', 'theme-blue', 'theme-brown');
        catCanvas.classList.add('theme-' + themeName);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const menuToggle = document.getElementById('menuToggle');
    const mobileMenu = document.getElementById('mobileMenu');

    if (menuToggle && mobileMenu) {
        menuToggle.addEventListener('click', () => {
            const isExpanded = menuToggle.getAttribute('aria-expanded') === 'true' || false;
            menuToggle.setAttribute('aria-expanded', !isExpanded);
            menuToggle.classList.toggle('open');
            mobileMenu.classList.toggle('open');
            
            // Toggle aria-hidden on mobile menu
            mobileMenu.setAttribute('aria-hidden', isExpanded);
        });
    }

    // ── 貓咪花色與主題切換 ──────────────────────────────
    // 確保 Canvas 也套用到正確的 class
    applyGlobalTheme(savedTheme);

    const themePicker = document.querySelector('.theme-picker');
    if (themePicker) {
        const buttons = themePicker.querySelectorAll('.theme-btn');
        
        // 設定目前的 active 按鈕
        buttons.forEach(btn => {
            if (btn.getAttribute('data-theme') === savedTheme) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
            
            btn.addEventListener('click', () => {
                const themeName = btn.getAttribute('data-theme');
                localStorage.setItem('cat-theme', themeName);
                applyGlobalTheme(themeName);
                
                // 更新按鈕 active 狀態
                buttons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });
    }
});

/* ── 全站防複製防盜用保護 ── */
(function () {
    // 禁止右鍵選單
    document.addEventListener('contextmenu', function (e) {
        e.preventDefault();
    });

    // 禁止複製 / 剪下
    document.addEventListener('copy',  function (e) { e.preventDefault(); });
    document.addEventListener('cut',   function (e) { e.preventDefault(); });

    // 禁止鍵盤快捷鍵：Ctrl+C / Ctrl+X / Ctrl+S / Ctrl+U / F12
    document.addEventListener('keydown', function (e) {
        var ctrl = e.ctrlKey || e.metaKey;
        if (
            (ctrl && (e.key === 'c' || e.key === 'C')) ||  // 複製
            (ctrl && (e.key === 'x' || e.key === 'X')) ||  // 剪下
            (ctrl && (e.key === 's' || e.key === 'S')) ||  // 另存
            (ctrl && (e.key === 'u' || e.key === 'U')) ||  // 檢視原始碼
            e.key === 'F12'                                 // 開發者工具
        ) {
            e.preventDefault();
        }
    });

    // 禁止拖曳選取文字後拖出去
    document.addEventListener('dragstart', function (e) {
        e.preventDefault();
    });
})();
