    // ----------------------------------------------------------------------
    // 安全防護機制：XSS 跨站腳本過濾
    // 防止學生在開放問答或暱稱輸入惡意 HTML 語法
    const escapeHTML = (str) => {
        if (typeof str !== 'string') return str;
        return str.replace(/[&<>'"]/g, 
            tag => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                "'": '&#39;',
                '"': '&quot;'
            }[tag] || tag)
        );
    };

    // 負責將含有 (男) 或 (女) 的文字，轉換為帶有圖示的 HTML
    const renderName = (name, isLarge = false) => {
        let clean = escapeHTML(name);
        let icon = '';
        if (clean.endsWith('(男)')) {
            clean = clean.slice(0, -3);
            icon = isLarge 
                ? `<i data-lucide="mars" class="w-8 h-8 text-cyan-400 inline ml-1 align-baseline drop-shadow-sm pointer-events-none"></i>` 
                : `<i data-lucide="mars" class="w-3.5 h-3.5 text-cyan-400 inline ml-0.5 mb-0.5 pointer-events-none"></i>`;
        } else if (clean.endsWith('(女)')) {
            clean = clean.slice(0, -3);
            icon = isLarge 
                ? `<i data-lucide="venus" class="w-8 h-8 text-rose-400 inline ml-1 align-baseline drop-shadow-sm pointer-events-none"></i>` 
                : `<i data-lucide="venus" class="w-3.5 h-3.5 text-rose-400 inline ml-0.5 mb-0.5 pointer-events-none"></i>`;
        }
        return `${clean}${icon}`;
    };
