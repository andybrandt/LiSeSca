// ===== CONFIGURATION =====
// Default settings for the scraper. These can be overridden
// by user preferences stored in Tampermonkey's persistent storage.
export const CONFIG = {
    VERSION: '0.3.15',
    MIN_PAGE_TIME: 10,   // Minimum seconds to spend "scanning" each page
    MAX_PAGE_TIME: 40,   // Maximum seconds to spend "scanning" each page
    MIN_JOB_REVIEW_TIME: 3,  // Minimum seconds to spend "reviewing" each job detail
    MAX_JOB_REVIEW_TIME: 8,  // Maximum seconds to spend "reviewing" each job detail
    MIN_JOB_PAUSE: 1,       // Minimum seconds to pause between jobs
    MAX_JOB_PAUSE: 3,       // Maximum seconds to pause between jobs

    // AI filtering configuration (stored separately)
    ANTHROPIC_API_KEY: '',  // User's Anthropic API key
    JOB_CRITERIA: '',       // User's job search criteria (free-form text)

    /**
     * Load user-saved configuration from persistent storage.
     * Falls back to defaults defined above if nothing is saved.
     */
    load: function() {
        // Load timing configuration
        var saved = GM_getValue('lisesca_config', null);
        if (saved) {
            try {
                var parsed = JSON.parse(saved);
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

        // Load AI configuration (separate storage key)
        var aiSaved = GM_getValue('lisesca_ai_config', null);
        if (aiSaved) {
            try {
                var aiParsed = JSON.parse(aiSaved);
                if (aiParsed.ANTHROPIC_API_KEY !== undefined) {
                    this.ANTHROPIC_API_KEY = aiParsed.ANTHROPIC_API_KEY;
                }
                if (aiParsed.JOB_CRITERIA !== undefined) {
                    this.JOB_CRITERIA = aiParsed.JOB_CRITERIA;
                }
            } catch (error) {
                console.warn('[LiSeSca] Failed to parse saved AI config:', error);
            }
        }

        console.log('[LiSeSca] Config loaded:', {
            MIN_PAGE_TIME: this.MIN_PAGE_TIME,
            MAX_PAGE_TIME: this.MAX_PAGE_TIME,
            MIN_JOB_REVIEW_TIME: this.MIN_JOB_REVIEW_TIME,
            MAX_JOB_REVIEW_TIME: this.MAX_JOB_REVIEW_TIME,
            MIN_JOB_PAUSE: this.MIN_JOB_PAUSE,
            MAX_JOB_PAUSE: this.MAX_JOB_PAUSE,
            AI_CONFIGURED: !!(this.ANTHROPIC_API_KEY && this.JOB_CRITERIA)
        });
    },

    /**
     * Save the current timing configuration to persistent storage.
     */
    save: function() {
        var configData = JSON.stringify({
            MIN_PAGE_TIME: this.MIN_PAGE_TIME,
            MAX_PAGE_TIME: this.MAX_PAGE_TIME,
            MIN_JOB_REVIEW_TIME: this.MIN_JOB_REVIEW_TIME,
            MAX_JOB_REVIEW_TIME: this.MAX_JOB_REVIEW_TIME,
            MIN_JOB_PAUSE: this.MIN_JOB_PAUSE,
            MAX_JOB_PAUSE: this.MAX_JOB_PAUSE
        });
        GM_setValue('lisesca_config', configData);
        console.log('[LiSeSca] Config saved.');
    },

    /**
     * Save the AI filtering configuration to persistent storage.
     */
    saveAIConfig: function() {
        var aiConfigData = JSON.stringify({
            ANTHROPIC_API_KEY: this.ANTHROPIC_API_KEY,
            JOB_CRITERIA: this.JOB_CRITERIA
        });
        GM_setValue('lisesca_ai_config', aiConfigData);
        console.log('[LiSeSca] AI config saved.');
    },

    /**
     * Check if AI filtering is properly configured.
     * @returns {boolean} True if both API key and criteria are set.
     */
    isAIConfigured: function() {
        return !!(this.ANTHROPIC_API_KEY && this.JOB_CRITERIA);
    }
};
