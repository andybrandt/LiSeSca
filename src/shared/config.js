// ===== CONFIGURATION =====
// Default settings for the scraper. These can be overridden
// by user preferences stored in Tampermonkey's persistent storage.
export const CONFIG = {
    VERSION: '0.4.0',
    MIN_PAGE_TIME: 10,   // Minimum seconds to spend "scanning" each page
    MAX_PAGE_TIME: 40,   // Maximum seconds to spend "scanning" each page
    MIN_JOB_REVIEW_TIME: 3,  // Minimum seconds to spend "reviewing" each job detail
    MAX_JOB_REVIEW_TIME: 8,  // Maximum seconds to spend "reviewing" each job detail
    MIN_JOB_PAUSE: 1,       // Minimum seconds to pause between jobs
    MAX_JOB_PAUSE: 3,       // Maximum seconds to pause between jobs

    // AI filtering configuration (stored separately)
    ANTHROPIC_API_KEY: '',  // User's Anthropic API key
    MOONSHOT_API_KEY: '',   // User's Moonshot API key
    AI_MODEL: '',           // Selected model ID (provider derived from model prefix)
    JOB_CRITERIA: '',       // User's job search criteria (free-form text)
    PEOPLE_CRITERIA: '',    // User's people search criteria (free-form text)
    CACHED_MODELS: {        // Cached model lists for dropdown
        anthropic: [],
        moonshot: [],
        lastFetch: { anthropic: 0, moonshot: 0 }
    },

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
                if (aiParsed.MOONSHOT_API_KEY !== undefined) {
                    this.MOONSHOT_API_KEY = aiParsed.MOONSHOT_API_KEY;
                }
                if (aiParsed.AI_MODEL !== undefined) {
                    this.AI_MODEL = aiParsed.AI_MODEL;
                }
                if (aiParsed.JOB_CRITERIA !== undefined) {
                    this.JOB_CRITERIA = aiParsed.JOB_CRITERIA;
                }
                if (aiParsed.PEOPLE_CRITERIA !== undefined) {
                    this.PEOPLE_CRITERIA = aiParsed.PEOPLE_CRITERIA;
                }
                if (aiParsed.CACHED_MODELS !== undefined) {
                    this.CACHED_MODELS = aiParsed.CACHED_MODELS;
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
            AI_MODEL: this.AI_MODEL,
            AI_CONFIGURED: this.isAIConfigured(),
            PEOPLE_AI_CONFIGURED: this.isPeopleAIConfigured()
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
            MOONSHOT_API_KEY: this.MOONSHOT_API_KEY,
            AI_MODEL: this.AI_MODEL,
            JOB_CRITERIA: this.JOB_CRITERIA,
            PEOPLE_CRITERIA: this.PEOPLE_CRITERIA,
            CACHED_MODELS: this.CACHED_MODELS
        });
        GM_setValue('lisesca_ai_config', aiConfigData);
        console.log('[LiSeSca] AI config saved.');
    },

    /**
     * Determine the provider for a given model ID based on its prefix.
     * @param {string} modelId - The model identifier.
     * @returns {string|null} 'anthropic', 'moonshot', or null if unknown.
     */
    getProviderForModel: function(modelId) {
        if (!modelId) {
            return null;
        }
        // Anthropic models start with 'claude'
        if (modelId.startsWith('claude')) {
            return 'anthropic';
        }
        // Moonshot models start with 'kimi' or 'moonshot'
        if (modelId.startsWith('kimi') || modelId.startsWith('moonshot')) {
            return 'moonshot';
        }
        return null;
    },

    /**
     * Get the API key for the currently selected model's provider.
     * @returns {string} The API key, or empty string if not available.
     */
    getActiveAPIKey: function() {
        var provider = this.getProviderForModel(this.AI_MODEL);
        if (provider === 'anthropic') {
            return this.ANTHROPIC_API_KEY || '';
        }
        if (provider === 'moonshot') {
            return this.MOONSHOT_API_KEY || '';
        }
        // Fallback: if no model selected, return Anthropic key for backward compatibility
        return this.ANTHROPIC_API_KEY || '';
    },

    /**
     * Check if any API key is available.
     * @returns {boolean} True if at least one API key is set.
     */
    hasAnyAPIKey: function() {
        return !!(this.ANTHROPIC_API_KEY || this.MOONSHOT_API_KEY);
    },

    /**
     * Check if AI filtering is properly configured.
     * Requires: a selected model with valid API key + job criteria.
     * @returns {boolean} True if configured properly.
     */
    isAIConfigured: function() {
        if (!this.JOB_CRITERIA) {
            return false;
        }
        // If model is selected, check that provider's key
        if (this.AI_MODEL) {
            var provider = this.getProviderForModel(this.AI_MODEL);
            if (provider === 'anthropic') {
                return !!this.ANTHROPIC_API_KEY;
            }
            if (provider === 'moonshot') {
                return !!this.MOONSHOT_API_KEY;
            }
        }
        // Backward compatibility: if no model selected, check Anthropic key
        return !!this.ANTHROPIC_API_KEY;
    },

    /**
     * Check if People AI filtering is properly configured.
     * Requires: a selected model with valid API key + people criteria.
     * @returns {boolean} True if configured properly.
     */
    isPeopleAIConfigured: function() {
        if (!this.PEOPLE_CRITERIA) {
            return false;
        }
        // If model is selected, check that provider's key
        if (this.AI_MODEL) {
            var provider = this.getProviderForModel(this.AI_MODEL);
            if (provider === 'anthropic') {
                return !!this.ANTHROPIC_API_KEY;
            }
            if (provider === 'moonshot') {
                return !!this.MOONSHOT_API_KEY;
            }
        }
        // Backward compatibility: if no model selected, check Anthropic key
        return !!this.ANTHROPIC_API_KEY;
    }
};
