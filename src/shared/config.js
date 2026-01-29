// ===== CONFIGURATION =====
// Default settings for the scraper. These can be overridden
// by user preferences stored in Tampermonkey's persistent storage.
export const CONFIG = {
    VERSION: '0.3.0',
    MIN_PAGE_TIME: 10,   // Minimum seconds to spend "scanning" each page
    MAX_PAGE_TIME: 40,   // Maximum seconds to spend "scanning" each page
    MIN_JOB_REVIEW_TIME: 3,  // Minimum seconds to spend "reviewing" each job detail
    MAX_JOB_REVIEW_TIME: 8,  // Maximum seconds to spend "reviewing" each job detail
    MIN_JOB_PAUSE: 1,       // Minimum seconds to pause between jobs
    MAX_JOB_PAUSE: 3,       // Maximum seconds to pause between jobs

    /**
     * Load user-saved configuration from persistent storage.
     * Falls back to defaults defined above if nothing is saved.
     */
    load: function() {
        const saved = GM_getValue('lisesca_config', null);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (parsed.MIN_PAGE_TIME !== undefined) {
                    this.MIN_PAGE_TIME = parsed.MIN_PAGE_TIME;
                }
                if (parsed.MAX_PAGE_TIME !== undefined) {
                    this.MAX_PAGE_TIME = parsed.MAX_PAGE_TIME;
                }
                if (parsed.MIN_JOB_REVIEW_TIME !== undefined) {
                    this.MIN_JOB_REVIEW_TIME = parsed.MIN_JOB_REVIEW_TIME;
                }
                if (parsed.MAX_JOB_REVIEW_TIME !== undefined) {
                    this.MAX_JOB_REVIEW_TIME = parsed.MAX_JOB_REVIEW_TIME;
                }
                if (parsed.MIN_JOB_PAUSE !== undefined) {
                    this.MIN_JOB_PAUSE = parsed.MIN_JOB_PAUSE;
                }
                if (parsed.MAX_JOB_PAUSE !== undefined) {
                    this.MAX_JOB_PAUSE = parsed.MAX_JOB_PAUSE;
                }
            } catch (error) {
                console.warn('[LiSeSca] Failed to parse saved config, using defaults:', error);
            }
        }
        console.log('[LiSeSca] Config loaded:', {
            MIN_PAGE_TIME: this.MIN_PAGE_TIME,
            MAX_PAGE_TIME: this.MAX_PAGE_TIME,
            MIN_JOB_REVIEW_TIME: this.MIN_JOB_REVIEW_TIME,
            MAX_JOB_REVIEW_TIME: this.MAX_JOB_REVIEW_TIME,
            MIN_JOB_PAUSE: this.MIN_JOB_PAUSE,
            MAX_JOB_PAUSE: this.MAX_JOB_PAUSE
        });
    },

    /**
     * Save the current configuration to persistent storage.
     */
    save: function() {
        const configData = JSON.stringify({
            MIN_PAGE_TIME: this.MIN_PAGE_TIME,
            MAX_PAGE_TIME: this.MAX_PAGE_TIME,
            MIN_JOB_REVIEW_TIME: this.MIN_JOB_REVIEW_TIME,
            MAX_JOB_REVIEW_TIME: this.MAX_JOB_REVIEW_TIME,
            MIN_JOB_PAUSE: this.MIN_JOB_PAUSE,
            MAX_JOB_PAUSE: this.MAX_JOB_PAUSE
        });
        GM_setValue('lisesca_config', configData);
        console.log('[LiSeSca] Config saved.');
    }
};
