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
