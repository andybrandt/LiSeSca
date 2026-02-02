// ==UserScript==
// @name         LiSeSca - LinkedIn Search Scraper
// @namespace    https://github.com/andybrandt/lisesca
// @version      0.3.16
// @description  Scrapes LinkedIn people search and job search results with human emulation
// @author       Andy Brandt
// @homepageURL  https://github.com/andybrandt/LiSeSca
// @updateURL    https://github.com/andybrandt/LiSeSca/raw/refs/heads/master/lisesca.user.js
// @downloadURL  https://github.com/andybrandt/LiSeSca/raw/refs/heads/master/lisesca.user.js
// @match        https://www.linkedin.com/*
// @noframes	
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      api.anthropic.com
// @require      https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js
// @require      https://cdn.jsdelivr.net/npm/turndown@7.2.0/dist/turndown.js
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ===== CONFIGURATION =====
    // Default settings for the scraper. These can be overridden
    // by user preferences stored in Tampermonkey's persistent storage.
    const CONFIG = {
        VERSION: '0.4.0',
        MIN_PAGE_TIME: 10,   // Minimum seconds to spend "scanning" each page
        MAX_PAGE_TIME: 40,   // Maximum seconds to spend "scanning" each page
        MIN_JOB_REVIEW_TIME: 3,  // Minimum seconds to spend "reviewing" each job detail
        MAX_JOB_REVIEW_TIME: 8,  // Maximum seconds to spend "reviewing" each job detail
        MIN_JOB_PAUSE: 1,       // Minimum seconds to pause between jobs
        MAX_JOB_PAUSE: 3,       // Maximum seconds to pause between jobs

        // AI filtering configuration (stored separately)
        ANTHROPIC_API_KEY: '',  // User's Anthropic API key
        JOB_CRITERIA: '',       // User's job search criteria (free-form text)
        PEOPLE_CRITERIA: '',    // User's people search criteria (free-form text)

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
                    if (aiParsed.PEOPLE_CRITERIA !== undefined) {
                        this.PEOPLE_CRITERIA = aiParsed.PEOPLE_CRITERIA;
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
                AI_CONFIGURED: !!(this.ANTHROPIC_API_KEY && this.JOB_CRITERIA),
                PEOPLE_AI_CONFIGURED: !!(this.ANTHROPIC_API_KEY && this.PEOPLE_CRITERIA)
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
                JOB_CRITERIA: this.JOB_CRITERIA,
                PEOPLE_CRITERIA: this.PEOPLE_CRITERIA
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
        },

        /**
         * Check if People AI filtering is properly configured.
         * @returns {boolean} True if both API key and people criteria are set.
         */
        isPeopleAIConfigured: function() {
            return !!(this.ANTHROPIC_API_KEY && this.PEOPLE_CRITERIA);
        }
    };

    // ===== STATE MANAGEMENT =====
    // Persists scraping state across page reloads using Tampermonkey storage.
    // This enables the state machine pattern needed for multi-page scraping.
    // Each key is prefixed with 'lisesca_' to avoid collisions.
    const State = {
        /** Storage key names */
        KEYS: {
            IS_SCRAPING: 'lisesca_isScraping',
            CURRENT_PAGE: 'lisesca_currentPage',
            TARGET_PAGE_COUNT: 'lisesca_targetPageCount',
            START_PAGE: 'lisesca_startPage',
            SCRAPED_BUFFER: 'lisesca_scrapedBuffer',
            SEARCH_URL: 'lisesca_searchUrl',
            FORMATS: 'lisesca_formats',
            INCLUDE_VIEWED: 'lisesca_includeViewed',
            AI_ENABLED: 'lisesca_aiEnabled',          // AI job filtering toggle
            FULL_AI_ENABLED: 'lisesca_fullAIEnabled', // Full AI evaluation toggle (three-tier)
            PEOPLE_AI_ENABLED: 'lisesca_peopleAIEnabled',          // AI people filtering toggle
            PEOPLE_FULL_AI_ENABLED: 'lisesca_peopleFullAIEnabled', // Full AI evaluation toggle for people
            // Job-specific state keys
            SCRAPE_MODE: 'lisesca_scrapeMode',       // 'people' or 'jobs'
            JOB_INDEX: 'lisesca_jobIndex',            // current job index on page (0-based)
            JOB_IDS_ON_PAGE: 'lisesca_jobIdsOnPage',  // JSON array of job IDs for current page
            JOB_TOTAL: 'lisesca_jobTotal',            // total jobs count for "All" mode
            // AI evaluation statistics
            AI_JOBS_EVALUATED: 'lisesca_aiJobsEvaluated',  // count of jobs evaluated by AI
            AI_JOBS_ACCEPTED: 'lisesca_aiJobsAccepted',    // count of jobs accepted by AI
            AI_PEOPLE_EVALUATED: 'lisesca_aiPeopleEvaluated', // count of people evaluated by AI
            AI_PEOPLE_ACCEPTED: 'lisesca_aiPeopleAccepted',   // count of people accepted by AI
            // People deep-scrape state keys
            CURRENT_PROFILE_URL: 'lisesca_currentProfileUrl',
            DEEP_SCRAPE_MODE: 'lisesca_deepScrapeMode',   // 'normal' or 'deep'
            PROFILE_INDEX: 'lisesca_profileIndex',        // current profile index on page (0-based)
            PROFILES_ON_PAGE: 'lisesca_profilesOnPage'    // JSON array of profiles for current page
        },

        /**
         * Get a value from persistent storage.
         * @param {string} key - The storage key.
         * @param {*} defaultValue - Value to return if key is not found.
         * @returns {*} The stored value or defaultValue.
         */
        get: function(key, defaultValue) {
            return GM_getValue(key, defaultValue);
        },

        /**
         * Set a value in persistent storage.
         * @param {string} key - The storage key.
         * @param {*} value - The value to store.
         */
        set: function(key, value) {
            GM_setValue(key, value);
        },

        /**
         * Check whether a scraping session is currently active.
         * @returns {boolean}
         */
        isScraping: function() {
            return this.get(this.KEYS.IS_SCRAPING, false);
        },

        /**
         * Get the current scrape mode ('people' or 'jobs').
         * @returns {string} The scrape mode, or 'people' as default.
         */
        getScrapeMode: function() {
            return this.get(this.KEYS.SCRAPE_MODE, 'people');
        },

        /**
         * Retrieve the full scraping state object.
         * @returns {Object} State with all scraping session properties.
         */
        getScrapingState: function() {
            return {
                isScraping: this.get(this.KEYS.IS_SCRAPING, false),
                currentPage: this.get(this.KEYS.CURRENT_PAGE, 1),
                targetPageCount: this.get(this.KEYS.TARGET_PAGE_COUNT, 1),
                startPage: this.get(this.KEYS.START_PAGE, 1),
                scrapedBuffer: this.getBuffer(),
                searchUrl: this.get(this.KEYS.SEARCH_URL, ''),
                formats: this.getFormats(),
                includeViewed: this.getIncludeViewed(),
                scrapeMode: this.getScrapeMode(),
                jobIndex: this.get(this.KEYS.JOB_INDEX, 0),
                jobIdsOnPage: this.getJobIdsOnPage(),
                profileIndex: this.get(this.KEYS.PROFILE_INDEX, 0),
                profilesOnPage: this.getProfilesOnPage(),
                currentProfileUrl: this.get(this.KEYS.CURRENT_PROFILE_URL, ''),
                deepScrapeMode: this.get(this.KEYS.DEEP_SCRAPE_MODE, 'normal')
            };
        },

        /**
         * Initialize a new scraping session.
         * @param {number} targetPageCount - How many pages to scrape (9999 for "all").
         * @param {number} startPage - The page number where scraping begins.
         * @param {string} searchUrl - The base search URL (without page parameter).
         * @param {string} scrapeMode - 'people' or 'jobs'.
         */
        startSession: function(targetPageCount, startPage, searchUrl, scrapeMode) {
            this.set(this.KEYS.IS_SCRAPING, true);
            this.set(this.KEYS.CURRENT_PAGE, startPage);
            this.set(this.KEYS.TARGET_PAGE_COUNT, targetPageCount);
            this.set(this.KEYS.START_PAGE, startPage);
            this.set(this.KEYS.SEARCH_URL, searchUrl);
            this.set(this.KEYS.SCRAPED_BUFFER, JSON.stringify([]));
            this.set(this.KEYS.SCRAPE_MODE, scrapeMode || 'people');
            // Reset job-specific state
            this.set(this.KEYS.JOB_INDEX, 0);
            this.set(this.KEYS.JOB_IDS_ON_PAGE, JSON.stringify([]));
            this.set(this.KEYS.JOB_TOTAL, 0);
            // Reset AI evaluation counters
            this.set(this.KEYS.AI_JOBS_EVALUATED, 0);
            this.set(this.KEYS.AI_JOBS_ACCEPTED, 0);
            this.set(this.KEYS.AI_PEOPLE_EVALUATED, 0);
            this.set(this.KEYS.AI_PEOPLE_ACCEPTED, 0);
            // Reset people deep-scrape state
            this.set(this.KEYS.CURRENT_PROFILE_URL, '');
            this.set(this.KEYS.DEEP_SCRAPE_MODE, 'normal');
            this.set(this.KEYS.PROFILE_INDEX, 0);
            this.set(this.KEYS.PROFILES_ON_PAGE, JSON.stringify([]));
            console.log('[LiSeSca] Session started: mode=' + (scrapeMode || 'people')
                + ', pages=' + targetPageCount + ', startPage=' + startPage);
        },

        /**
         * Append newly extracted items to the persistent buffer.
         * This is the "data safety" strategy: after each extraction, we persist
         * the cumulative results. If the browser crashes, previous data is safe.
         * @param {Array} newItems - Array of data objects (profiles or jobs).
         */
        appendBuffer: function(newItems) {
            const buffer = this.getBuffer();
            const updated = buffer.concat(newItems);
            this.set(this.KEYS.SCRAPED_BUFFER, JSON.stringify(updated));
            console.log('[LiSeSca] Buffer updated: ' + updated.length + ' total items.');
        },

        /**
         * Read selected export formats from the UI checkboxes.
         * @returns {Array<string>} Array of format identifiers (e.g. ['xlsx', 'csv']).
         */
        readFormatsFromUI: function() {
            var formats = [];
            var xlsxCheck = document.getElementById('lisesca-fmt-xlsx');
            var csvCheck = document.getElementById('lisesca-fmt-csv');
            var mdCheck = document.getElementById('lisesca-fmt-md');

            if (xlsxCheck && xlsxCheck.checked) {
                formats.push('xlsx');
            }
            if (csvCheck && csvCheck.checked) {
                formats.push('csv');
            }
            if (mdCheck && mdCheck.checked) {
                formats.push('md');
            }
            return formats;
        },

        /**
         * Read the "Include viewed" preference from the UI checkbox.
         * @returns {boolean} True if viewed jobs should be included.
         */
        readIncludeViewedFromUI: function() {
            var includeViewedCheck = document.getElementById('lisesca-include-viewed');
            if (!includeViewedCheck) {
                return true;
            }
            return includeViewedCheck.checked;
        },

        /**
         * Save selected export formats to persistent storage.
         * @param {Array<string>} formats - Array of format identifiers.
         */
        saveFormats: function(formats) {
            this.set(this.KEYS.FORMATS, JSON.stringify(formats));
        },

        /**
         * Save the "Include viewed" preference to persistent storage.
         * @param {boolean} includeViewed - True to include viewed jobs.
         */
        saveIncludeViewed: function(includeViewed) {
            this.set(this.KEYS.INCLUDE_VIEWED, includeViewed === true);
        },

        /**
         * Retrieve the saved export formats from persistent storage.
         * Falls back to ['xlsx'] if nothing is saved.
         * @returns {Array<string>} Array of format identifiers.
         */
        getFormats: function() {
            var raw = this.get(this.KEYS.FORMATS, '["xlsx"]');
            try {
                return JSON.parse(raw);
            } catch (error) {
                console.warn('[LiSeSca] Failed to parse formats, defaulting to xlsx:', error);
                return ['xlsx'];
            }
        },

        /**
         * Retrieve the saved "Include viewed" preference.
         * Defaults to true if not set.
         * @returns {boolean}
         */
        getIncludeViewed: function() {
            return this.get(this.KEYS.INCLUDE_VIEWED, true);
        },

        /**
         * Read the "AI people selection" preference from the UI checkbox.
         * @returns {boolean} True if AI filtering is enabled for people.
         */
        readPeopleAIEnabledFromUI: function() {
            var aiEnabledCheck = document.getElementById('lisesca-people-ai-enabled');
            if (!aiEnabledCheck) {
                return false;
            }
            return aiEnabledCheck.checked;
        },

        /**
         * Save the "AI people selection" preference to persistent storage.
         * @param {boolean} aiEnabled - True to enable AI filtering for people.
         */
        savePeopleAIEnabled: function(aiEnabled) {
            this.set(this.KEYS.PEOPLE_AI_ENABLED, aiEnabled === true);
        },

        /**
         * Retrieve the saved "AI people selection" preference.
         * Defaults to false if not set.
         * @returns {boolean}
         */
        getPeopleAIEnabled: function() {
            return this.get(this.KEYS.PEOPLE_AI_ENABLED, false);
        },

        /**
         * Read the "Full AI evaluation" preference from the UI checkbox (people).
         * @returns {boolean} True if full AI evaluation is enabled for people.
         */
        readPeopleFullAIEnabledFromUI: function() {
            var fullAICheck = document.getElementById('lisesca-people-full-ai-enabled');
            if (!fullAICheck) {
                return false;
            }
            return fullAICheck.checked;
        },

        /**
         * Save the "Full AI evaluation" preference to persistent storage (people).
         * @param {boolean} fullAIEnabled - True to enable full AI evaluation for people.
         */
        savePeopleFullAIEnabled: function(fullAIEnabled) {
            this.set(this.KEYS.PEOPLE_FULL_AI_ENABLED, fullAIEnabled === true);
        },

        /**
         * Retrieve the saved "Full AI evaluation" preference for people.
         * Defaults to false if not set.
         * @returns {boolean}
         */
        getPeopleFullAIEnabled: function() {
            return this.get(this.KEYS.PEOPLE_FULL_AI_ENABLED, false);
        },

        /**
         * Read the "AI job selection" preference from the UI checkbox.
         * @returns {boolean} True if AI filtering is enabled.
         */
        readAIEnabledFromUI: function() {
            var aiEnabledCheck = document.getElementById('lisesca-ai-enabled');
            if (!aiEnabledCheck) {
                return false;
            }
            return aiEnabledCheck.checked;
        },

        /**
         * Save the "AI job selection" preference to persistent storage.
         * @param {boolean} aiEnabled - True to enable AI filtering.
         */
        saveAIEnabled: function(aiEnabled) {
            this.set(this.KEYS.AI_ENABLED, aiEnabled === true);
        },

        /**
         * Retrieve the saved "AI job selection" preference.
         * Defaults to false if not set.
         * @returns {boolean}
         */
        getAIEnabled: function() {
            return this.get(this.KEYS.AI_ENABLED, false);
        },

        /**
         * Read the "Full AI evaluation" preference from the UI checkbox.
         * @returns {boolean} True if full AI evaluation is enabled.
         */
        readFullAIEnabledFromUI: function() {
            var fullAICheck = document.getElementById('lisesca-full-ai-enabled');
            if (!fullAICheck) {
                return false;
            }
            return fullAICheck.checked;
        },

        /**
         * Save the "Full AI evaluation" preference to persistent storage.
         * @param {boolean} fullAIEnabled - True to enable full AI evaluation.
         */
        saveFullAIEnabled: function(fullAIEnabled) {
            this.set(this.KEYS.FULL_AI_ENABLED, fullAIEnabled === true);
        },

        /**
         * Retrieve the saved "Full AI evaluation" preference.
         * Defaults to false if not set.
         * @returns {boolean}
         */
        getFullAIEnabled: function() {
            return this.get(this.KEYS.FULL_AI_ENABLED, false);
        },

        /**
         * Get the count of jobs evaluated by AI in this session.
         * @returns {number}
         */
        getAIJobsEvaluated: function() {
            return this.get(this.KEYS.AI_JOBS_EVALUATED, 0);
        },

        /**
         * Get the count of jobs accepted by AI in this session.
         * @returns {number}
         */
        getAIJobsAccepted: function() {
            return this.get(this.KEYS.AI_JOBS_ACCEPTED, 0);
        },

        /**
         * Get the count of people evaluated by AI in this session.
         * @returns {number}
         */
        getAIPeopleEvaluated: function() {
            return this.get(this.KEYS.AI_PEOPLE_EVALUATED, 0);
        },

        /**
         * Get the count of people accepted by AI in this session.
         * @returns {number}
         */
        getAIPeopleAccepted: function() {
            return this.get(this.KEYS.AI_PEOPLE_ACCEPTED, 0);
        },

        /**
         * Increment the AI jobs evaluated counter.
         */
        incrementAIJobsEvaluated: function() {
            var current = this.get(this.KEYS.AI_JOBS_EVALUATED, 0);
            this.set(this.KEYS.AI_JOBS_EVALUATED, current + 1);
        },

        /**
         * Increment the AI jobs accepted counter.
         */
        incrementAIJobsAccepted: function() {
            var current = this.get(this.KEYS.AI_JOBS_ACCEPTED, 0);
            this.set(this.KEYS.AI_JOBS_ACCEPTED, current + 1);
        },

        /**
         * Increment the AI people evaluated counter.
         */
        incrementAIPeopleEvaluated: function() {
            var current = this.get(this.KEYS.AI_PEOPLE_EVALUATED, 0);
            this.set(this.KEYS.AI_PEOPLE_EVALUATED, current + 1);
        },

        /**
         * Increment the AI people accepted counter.
         */
        incrementAIPeopleAccepted: function() {
            var current = this.get(this.KEYS.AI_PEOPLE_ACCEPTED, 0);
            this.set(this.KEYS.AI_PEOPLE_ACCEPTED, current + 1);
        },

        /**
         * Get the current scraped data buffer.
         * @returns {Array} Array of data objects (profiles or jobs).
         */
        getBuffer: function() {
            const raw = this.get(this.KEYS.SCRAPED_BUFFER, '[]');
            try {
                return JSON.parse(raw);
            } catch (error) {
                console.warn('[LiSeSca] Failed to parse buffer, resetting:', error);
                return [];
            }
        },

        /**
         * Get the stored job IDs for the current page.
         * @returns {Array<string>} Array of job ID strings.
         */
        getJobIdsOnPage: function() {
            var raw = this.get(this.KEYS.JOB_IDS_ON_PAGE, '[]');
            try {
                return JSON.parse(raw);
            } catch (error) {
                console.warn('[LiSeSca] Failed to parse job IDs, resetting:', error);
                return [];
            }
        },

        /**
         * Get the stored profiles for the current page (deep scrape).
         * @returns {Array<Object>} Array of profile objects.
         */
        getProfilesOnPage: function() {
            var raw = this.get(this.KEYS.PROFILES_ON_PAGE, '[]');
            try {
                return JSON.parse(raw);
            } catch (error) {
                console.warn('[LiSeSca] Failed to parse profiles on page, resetting:', error);
                return [];
            }
        },

        /**
         * Advance to the next page number.
         */
        advancePage: function() {
            const current = this.get(this.KEYS.CURRENT_PAGE, 1);
            this.set(this.KEYS.CURRENT_PAGE, current + 1);
        },

        /**
         * Clear all scraping state, ending the session.
         */
        clear: function() {
            GM_deleteValue(this.KEYS.IS_SCRAPING);
            GM_deleteValue(this.KEYS.CURRENT_PAGE);
            GM_deleteValue(this.KEYS.TARGET_PAGE_COUNT);
            GM_deleteValue(this.KEYS.START_PAGE);
            GM_deleteValue(this.KEYS.SCRAPED_BUFFER);
            GM_deleteValue(this.KEYS.SEARCH_URL);
            GM_deleteValue(this.KEYS.FORMATS);
            GM_deleteValue(this.KEYS.SCRAPE_MODE);
            GM_deleteValue(this.KEYS.JOB_INDEX);
            GM_deleteValue(this.KEYS.JOB_IDS_ON_PAGE);
            GM_deleteValue(this.KEYS.JOB_TOTAL);
            GM_deleteValue(this.KEYS.AI_JOBS_EVALUATED);
            GM_deleteValue(this.KEYS.AI_JOBS_ACCEPTED);
            GM_deleteValue(this.KEYS.AI_PEOPLE_EVALUATED);
            GM_deleteValue(this.KEYS.AI_PEOPLE_ACCEPTED);
            GM_deleteValue(this.KEYS.CURRENT_PROFILE_URL);
            GM_deleteValue(this.KEYS.DEEP_SCRAPE_MODE);
            GM_deleteValue(this.KEYS.PROFILE_INDEX);
            GM_deleteValue(this.KEYS.PROFILES_ON_PAGE);
            console.log('[LiSeSca] Session state cleared.');
        }
    };

    // ===== PAGE DETECTION =====
    // Detects whether we are on a people search page, a jobs page, or neither.
    // Used to adapt the UI and dispatch to the correct controller.
    const PageDetector = {

        /**
         * Determine the current page type based on the URL.
         * @returns {string} 'people', 'jobs', or 'unknown'.
         */
        getPageType: function() {
            var href = window.location.href;
            if (href.indexOf('linkedin.com/search/results/people') !== -1) {
                return 'people';
            }
            if (href.indexOf('linkedin.com/jobs/search') !== -1 ||
                href.indexOf('linkedin.com/jobs/collections') !== -1) {
                return 'jobs';
            }
            return 'unknown';
        },

        /**
         * Check if we are on a LinkedIn people search page.
         * @returns {boolean}
         */
        isOnPeopleSearchPage: function() {
            return this.getPageType() === 'people';
        },

        /**
         * Check if we are on a LinkedIn jobs page.
         * @returns {boolean}
         */
        isOnJobsPage: function() {
            return this.getPageType() === 'jobs';
        }
    };

    // ===== SPA NAVIGATION HANDLER =====
    // Detects URL changes in LinkedIn's SPA by intercepting History API.
    // Calls a callback when navigation occurs so the UI can be rebuilt appropriately.

    const SpaHandler = {
        /** Callback function to invoke on navigation: callback(newPageType, oldPageType) */
        onNavigate: null,

        /** Last known URL to detect actual changes */
        lastUrl: '',

        /** Whether the handler has been initialized */
        initialized: false,

        /**
         * Initialize the SPA handler.
         * Wraps History API methods and listens for popstate events.
         * @param {function} callback - Called with (newPageType, oldPageType) on navigation.
         */
        init: function(callback) {
            if (this.initialized) {
                console.log('[LiSeSca] SpaHandler already initialized, skipping.');
                return;
            }

            this.onNavigate = callback;
            this.lastUrl = window.location.href;
            this.initialized = true;

            var self = this;

            // Wrap history.pushState to intercept SPA navigations
            var originalPushState = history.pushState;
            history.pushState = function() {
                var result = originalPushState.apply(this, arguments);
                self.handleUrlChange();
                return result;
            };

            // Wrap history.replaceState to intercept URL replacements
            var originalReplaceState = history.replaceState;
            history.replaceState = function() {
                var result = originalReplaceState.apply(this, arguments);
                self.handleUrlChange();
                return result;
            };

            // Listen for back/forward button navigation
            window.addEventListener('popstate', function() {
                self.handleUrlChange();
            });

            console.log('[LiSeSca] SpaHandler initialized. Monitoring URL changes.');
        },

        /**
         * Check if the URL has actually changed and invoke the callback if so.
         */
        handleUrlChange: function() {
            var currentUrl = window.location.href;

            // Only trigger if the URL actually changed
            if (currentUrl === this.lastUrl) {
                return;
            }

            var oldUrl = this.lastUrl;
            this.lastUrl = currentUrl;

            // Determine page types before and after navigation
            var oldPageType = this.getPageTypeFromUrl(oldUrl);
            var newPageType = PageDetector.getPageType();

            console.log('[LiSeSca] SPA navigation detected: ' + oldPageType + ' -> ' + newPageType);

            // Invoke the callback if one is registered
            if (this.onNavigate) {
                this.onNavigate(newPageType, oldPageType);
            }
        },

        /**
         * Determine page type from a URL string (for analyzing old URL).
         * @param {string} url - The URL to analyze.
         * @returns {string} 'people', 'jobs', or 'unknown'.
         */
        getPageTypeFromUrl: function(url) {
            if (url.indexOf('linkedin.com/search/results/people') !== -1) {
                return 'people';
            }
            if (url.indexOf('linkedin.com/jobs/search') !== -1 ||
                url.indexOf('linkedin.com/jobs/collections') !== -1) {
                return 'jobs';
            }
            return 'unknown';
        }
    };

    // ===== AI CLIENT =====
    // Handles communication with Anthropic's Claude API for job filtering.
    // Uses GM_xmlhttpRequest for cross-origin API calls (Tampermonkey requirement).
    // Maintains conversation history per page to reduce token usage.


    /** System prompt that instructs Claude how to evaluate jobs (basic mode) */
    const SYSTEM_PROMPT = `You are a job relevance filter. Your task is to quickly decide whether a job posting is worth downloading for detailed review, based on the user's job search criteria.

DECISION RULES:
- Return download: true if the job COULD be relevant based on the limited card information shown
- Return download: false ONLY if the job is CLEARLY irrelevant (e.g., completely wrong industry, wrong role type, obviously unrelated field)
- When uncertain, return true — it's better to review an extra job than miss a good one

You will receive the user's criteria first, then job cards one at a time. Each card has only basic info: title, company, location. Make quick decisions based on this limited information.`;

    /** System prompt for Full AI mode with three-tier evaluation */
    const FULL_AI_SYSTEM_PROMPT = `You are a job relevance filter with two-stage evaluation.

STAGE 1 - CARD TRIAGE (limited info: title, company, location):
Use the card_triage tool to make one of three decisions:
- "reject" - Job is CLEARLY irrelevant (wrong industry, completely wrong role type, obviously unrelated field)
- "keep" - Job CLEARLY matches criteria (strong title match, relevant company, good fit)
- "maybe" - Uncertain from card info alone, need to see full job description to decide

Be CONSERVATIVE with "reject" - only use when truly certain the job is irrelevant. When in doubt, use "maybe" to request full details.

ALWAYS provide a brief reason explaining your decision. For rejections, explain WHY the job doesn't match (e.g., "Senior management role, user seeks IC positions", "Healthcare industry, user wants tech").

STAGE 2 - FULL EVALUATION (complete job description):
When you receive full job details after a "maybe" decision, use the full_evaluation tool to make a final accept/reject based on comprehensive analysis of requirements, responsibilities, qualifications, and company info.

ALWAYS provide a reason for your decision, especially for rejections. Be specific about what criteria the job fails to meet.

You will receive the user's criteria first, then job cards one at a time.`;

    /** System prompt for people card triage (reject/keep/maybe) */
    const PEOPLE_TRIAGE_SYSTEM_PROMPT = `You are a LinkedIn profile filter. Evaluate each profile card against the criteria below.

You only see LIMITED info: name, headline, location, connection degree. Use the people_card_triage tool:
- "reject" — CLEARLY irrelevant per criteria (wrong role type, excluded category)
- "keep" — CLEARLY matches criteria
- "maybe" — Uncertain from card alone, need full profile

Be conservative with "reject" — only use when clearly irrelevant. When uncertain, use "maybe".
Always provide a brief reason.

USER'S CRITERIA:
`;

    /** System prompt for full profile evaluation (accept/reject) */
    const PEOPLE_PROFILE_SYSTEM_PROMPT = `You are a LinkedIn profile filter. Evaluate the full profile against the criteria below.

You have FULL profile data: current role, past roles, company, experience. Use the people_full_evaluation tool:
- "accept" — Person matches criteria (has value for user's goals)
- "reject" — Person doesn't fit OR hits exclusion criteria

When borderline, lean toward "accept". Always provide a specific reason.

USER'S CRITERIA:
`;

    /** Tool definition that forces structured boolean response (basic mode) */
    const JOB_EVALUATION_TOOL = {
        name: 'job_evaluation',
        description: 'Indicate whether this job should be downloaded for detailed review',
        input_schema: {
            type: 'object',
            properties: {
                download: {
                    type: 'boolean',
                    description: 'true if job matches criteria, false if clearly irrelevant'
                }
            },
            required: ['download']
        }
    };

    /** Tool for three-tier card triage (Full AI mode) */
    const CARD_TRIAGE_TOOL = {
        name: 'card_triage',
        description: 'Triage a job card based on limited information (title, company, location)',
        input_schema: {
            type: 'object',
            properties: {
                decision: {
                    type: 'string',
                    enum: ['reject', 'keep', 'maybe'],
                    description: 'reject=clearly irrelevant, keep=clearly relevant, maybe=need full details to decide'
                },
                reason: {
                    type: 'string',
                    description: 'Brief explanation for the decision (required for reject, optional for keep/maybe)'
                }
            },
            required: ['decision', 'reason']
        }
    };

    /** Tool for final decision after full job review (Full AI mode) */
    const FULL_EVALUATION_TOOL = {
        name: 'full_evaluation',
        description: 'Final decision after reviewing full job details',
        input_schema: {
            type: 'object',
            properties: {
                accept: {
                    type: 'boolean',
                    description: 'true to accept and save the job, false to reject'
                },
                reason: {
                    type: 'string',
                    description: 'Brief explanation for the decision (especially important for rejections)'
                }
            },
            required: ['accept', 'reason']
        }
    };

    /** Tool for people triage (reject/keep/maybe) */
    const PEOPLE_CARD_TRIAGE_TOOL = {
        name: 'people_card_triage',
        description: 'Triage a person card based on limited information (name, headline, location)',
        input_schema: {
            type: 'object',
            properties: {
                decision: {
                    type: 'string',
                    enum: ['reject', 'keep', 'maybe'],
                    description: 'reject=clearly irrelevant, keep=clearly relevant, maybe=need full profile'
                },
                reason: {
                    type: 'string',
                    description: 'Brief explanation for the decision'
                }
            },
            required: ['decision', 'reason']
        }
    };

    /** Tool for final decision after full profile review */
    const PEOPLE_FULL_EVALUATION_TOOL = {
        name: 'people_full_evaluation',
        description: 'Final decision after reviewing full profile details',
        input_schema: {
            type: 'object',
            properties: {
                accept: {
                    type: 'boolean',
                    description: 'true to accept and save the person, false to reject'
                },
                reason: {
                    type: 'string',
                    description: 'Brief explanation for the decision'
                }
            },
            required: ['accept', 'reason']
        }
    };

    const AIClient = {
        /** Conversation history for the current page */
        conversationHistory: [],

        /** Flag indicating if the conversation has been initialized with criteria */
        isInitialized: false,

        /** Flag indicating if Full AI mode (three-tier) is active for this session */
        fullAIMode: false,

        /** Conversation history for people evaluation */
        peopleConversationHistory: [],

        /** Flag indicating if the people conversation has been initialized */
        peopleInitialized: false,

        /** Flag indicating if full AI mode is active for people evaluation */
        peopleFullAIMode: false,

        /**
         * Check if the AI client is properly configured with API key and criteria.
         * @returns {boolean} True if both API key and criteria are set.
         */
        isConfigured: function() {
            return !!(CONFIG.ANTHROPIC_API_KEY && CONFIG.JOB_CRITERIA);
        },

        /**
         * Check if People AI client is properly configured.
         * @returns {boolean} True if both API key and people criteria are set.
         */
        isPeopleConfigured: function() {
            return !!(CONFIG.ANTHROPIC_API_KEY && CONFIG.PEOPLE_CRITERIA);
        },

        /**
         * Reset the conversation history. Called at the start of each page.
         */
        resetConversation: function() {
            this.conversationHistory = [];
            this.isInitialized = false;
            // Note: fullAIMode is set during initConversation, not reset here
            console.log('[LiSeSca] AI conversation reset for new page.');
        },

        /**
         * Reset the people conversation history. Called at the start of each page.
         */
        resetPeopleConversation: function() {
            this.peopleConversationHistory = [];
            this.peopleInitialized = false;
            console.log('[LiSeSca] People AI conversation reset for new page.');
        },

        /**
         * Initialize the conversation with user criteria.
         * Creates the initial message exchange that sets up the context.
         * @param {boolean} fullAIMode - If true, use three-tier evaluation mode.
         * @returns {Promise<void>}
         */
        initConversation: function(fullAIMode) {
            if (this.isInitialized) {
                return Promise.resolve();
            }

            this.fullAIMode = fullAIMode === true;

            if (this.fullAIMode) {
                // Full AI mode: three-tier evaluation (reject/keep/maybe)
                this.conversationHistory = [
                    {
                        role: 'user',
                        content: 'My job search criteria:\n\n' + CONFIG.JOB_CRITERIA + '\n\nI will send you job cards one at a time. Use the card_triage tool to decide: reject (clearly irrelevant), keep (clearly relevant), or maybe (need full details).'
                    },
                    {
                        role: 'assistant',
                        content: [
                            {
                                type: 'tool_use',
                                id: 'init_ack',
                                name: 'card_triage',
                                input: { decision: 'maybe' }
                            }
                        ]
                    },
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'tool_result',
                                tool_use_id: 'init_ack',
                                content: 'Ready to evaluate jobs using three-tier triage.'
                            }
                        ]
                    }
                ];
                console.log('[LiSeSca] AI conversation initialized (fullAI=true).');
            } else {
                // Basic mode: binary evaluation (download/skip)
                this.conversationHistory = [
                    {
                        role: 'user',
                        content: 'My job search criteria:\n\n' + CONFIG.JOB_CRITERIA + '\n\nI will send you job cards one at a time. Evaluate each one using the job_evaluation tool.'
                    },
                    {
                        role: 'assistant',
                        content: [
                            {
                                type: 'tool_use',
                                id: 'init_ack',
                                name: 'job_evaluation',
                                input: { download: true }
                            }
                        ]
                    },
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'tool_result',
                                tool_use_id: 'init_ack',
                                content: 'Ready to evaluate jobs.'
                            }
                        ]
                    }
                ];
                console.log('[LiSeSca] AI conversation initialized (fullAI=false).');
            }

            this.isInitialized = true;
            return Promise.resolve();
        },

        /**
         * Initialize the people AI conversation.
         * @param {boolean} fullAIMode - If true, enables full AI mode (two-stage).
         * @returns {Promise<void>}
         */
        initPeopleConversation: function(fullAIMode) {
            if (this.peopleInitialized) {
                return Promise.resolve();
            }

            this.peopleFullAIMode = fullAIMode === true;
            // Conversation history starts empty; criteria is in system prompt
            this.peopleConversationHistory = [];

            this.peopleInitialized = true;
            console.log('[LiSeSca] People AI conversation initialized.');
            return Promise.resolve();
        },

        /**
         * Evaluate a job card to determine if it should be downloaded.
         * @param {string} cardMarkdown - The job card formatted as Markdown.
         * @returns {Promise<boolean>} True if the job should be downloaded, false to skip.
         */
        evaluateJob: function(cardMarkdown) {
            var self = this;

            if (!this.isConfigured()) {
                console.warn('[LiSeSca] AI client not configured, allowing job.');
                return Promise.resolve(true);
            }

            return this.initConversation().then(function() {
                return self.sendJobForEvaluation(cardMarkdown);
            }).catch(function(error) {
                console.error('[LiSeSca] AI evaluation error, allowing job:', error);
                return true; // Fail-open: download the job on error
            });
        },

        /**
         * Send a job card to Claude for evaluation.
         * @param {string} cardMarkdown - The job card formatted as Markdown.
         * @returns {Promise<boolean>} True if the job should be downloaded.
         */
        sendJobForEvaluation: function(cardMarkdown) {
            var self = this;

            // Add the job card to the conversation
            var messagesWithJob = this.conversationHistory.concat([
                { role: 'user', content: cardMarkdown }
            ]);

            var requestBody = {
                model: 'claude-sonnet-4-5-20250929',
                max_tokens: 100,
                system: SYSTEM_PROMPT,
                tools: [JOB_EVALUATION_TOOL],
                tool_choice: { type: 'tool', name: 'job_evaluation' },
                messages: messagesWithJob
            };

            return new Promise(function(resolve, reject) {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: 'https://api.anthropic.com/v1/messages',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': CONFIG.ANTHROPIC_API_KEY,
                        'anthropic-version': '2023-06-01'
                    },
                    data: JSON.stringify(requestBody),
                    onload: function(response) {
                        self.handleApiResponse(response, cardMarkdown, resolve, reject);
                    },
                    onerror: function(error) {
                        console.error('[LiSeSca] AI API request failed:', error);
                        reject(new Error('Network error'));
                    },
                    ontimeout: function() {
                        console.error('[LiSeSca] AI API request timed out');
                        reject(new Error('Request timeout'));
                    },
                    timeout: 30000 // 30 second timeout
                });
            });
        },

        /**
         * Handle the API response and extract the evaluation result.
         * @param {Object} response - The GM_xmlhttpRequest response object.
         * @param {string} cardMarkdown - The original job card (for logging).
         * @param {Function} resolve - Promise resolve function.
         * @param {Function} reject - Promise reject function.
         */
        handleApiResponse: function(response, cardMarkdown, resolve, reject) {
            if (response.status !== 200) {
                console.error('[LiSeSca] AI API error:', response.status, response.responseText);
                // Fail-open: allow the job on API errors
                resolve(true);
                return;
            }

            try {
                var data = JSON.parse(response.responseText);

                // Find the tool_use content block
                var toolUse = null;
                if (data.content && Array.isArray(data.content)) {
                    for (var i = 0; i < data.content.length; i++) {
                        if (data.content[i].type === 'tool_use') {
                            toolUse = data.content[i];
                            break;
                        }
                    }
                }

                if (!toolUse || toolUse.name !== 'job_evaluation') {
                    console.warn('[LiSeSca] Unexpected AI response format, allowing job.');
                    resolve(true);
                    return;
                }

                var shouldDownload = toolUse.input.download === true;

                // Update conversation history with this exchange
                this.conversationHistory.push({ role: 'user', content: cardMarkdown });
                this.conversationHistory.push({
                    role: 'assistant',
                    content: [toolUse]
                });
                // Add tool result to complete the exchange
                this.conversationHistory.push({
                    role: 'user',
                    content: [
                        {
                            type: 'tool_result',
                            tool_use_id: toolUse.id,
                            content: shouldDownload ? 'Job queued for download.' : 'Job skipped.'
                        }
                    ]
                });

                console.log('[LiSeSca] AI evaluation: ' + (shouldDownload ? 'DOWNLOAD' : 'SKIP'));
                resolve(shouldDownload);

            } catch (error) {
                console.error('[LiSeSca] Failed to parse AI response:', error);
                resolve(true); // Fail-open
            }
        },

        // ===== FULL AI MODE (Three-tier evaluation) =====

        /**
         * Triage a job card using three-tier evaluation (reject/keep/maybe).
         * Only used in Full AI mode.
         * @param {string} cardMarkdown - The job card formatted as Markdown.
         * @returns {Promise<{decision: string, reason: string}>} Decision object with reason.
         */
        triageCard: function(cardMarkdown) {
            var self = this;

            if (!this.isConfigured()) {
                console.warn('[LiSeSca] AI client not configured, returning "keep".');
                return Promise.resolve({ decision: 'keep', reason: 'AI not configured' });
            }

            return this.initConversation(true).then(function() {
                return self.sendCardForTriage(cardMarkdown);
            }).catch(function(error) {
                console.error('[LiSeSca] AI triage error, returning "keep":', error);
                return { decision: 'keep', reason: 'Error: ' + error.message }; // Fail-open
            });
        },

        /**
         * Send a job card to Claude for three-tier triage.
         * @param {string} cardMarkdown - The job card formatted as Markdown.
         * @returns {Promise<{decision: string, reason: string}>} Decision object with reason.
         */
        sendCardForTriage: function(cardMarkdown) {
            var self = this;

            var messagesWithJob = this.conversationHistory.concat([
                { role: 'user', content: cardMarkdown }
            ]);

            var requestBody = {
                model: 'claude-sonnet-4-5-20250929',
                max_tokens: 200,  // Increased for reason text
                system: FULL_AI_SYSTEM_PROMPT,
                tools: [CARD_TRIAGE_TOOL, FULL_EVALUATION_TOOL],
                tool_choice: { type: 'tool', name: 'card_triage' },
                messages: messagesWithJob
            };

            return new Promise(function(resolve, reject) {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: 'https://api.anthropic.com/v1/messages',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': CONFIG.ANTHROPIC_API_KEY,
                        'anthropic-version': '2023-06-01'
                    },
                    data: JSON.stringify(requestBody),
                    onload: function(response) {
                        self.handleTriageResponse(response, cardMarkdown, resolve, reject);
                    },
                    onerror: function(error) {
                        console.error('[LiSeSca] AI triage request failed:', error);
                        reject(new Error('Network error'));
                    },
                    ontimeout: function() {
                        console.error('[LiSeSca] AI triage request timed out');
                        reject(new Error('Request timeout'));
                    },
                    timeout: 30000
                });
            });
        },

        /**
         * Handle the triage API response and extract the decision.
         * @param {Object} response - The GM_xmlhttpRequest response object.
         * @param {string} cardMarkdown - The original job card.
         * @param {Function} resolve - Promise resolve function.
         * @param {Function} reject - Promise reject function.
         */
        handleTriageResponse: function(response, cardMarkdown, resolve, reject) {
            if (response.status !== 200) {
                console.error('[LiSeSca] AI triage API error:', response.status, response.responseText);
                resolve({ decision: 'keep', reason: 'API error ' + response.status }); // Fail-open
                return;
            }

            try {
                var data = JSON.parse(response.responseText);

                var toolUse = null;
                if (data.content && Array.isArray(data.content)) {
                    for (var i = 0; i < data.content.length; i++) {
                        if (data.content[i].type === 'tool_use') {
                            toolUse = data.content[i];
                            break;
                        }
                    }
                }

                if (!toolUse || toolUse.name !== 'card_triage') {
                    console.warn('[LiSeSca] Unexpected triage response format, returning "keep".');
                    resolve({ decision: 'keep', reason: 'Unexpected response format' });
                    return;
                }

                var decision = toolUse.input.decision;
                var reason = toolUse.input.reason || '(no reason provided)';

                if (decision !== 'reject' && decision !== 'keep' && decision !== 'maybe') {
                    console.warn('[LiSeSca] Invalid triage decision "' + decision + '", returning "keep".');
                    decision = 'keep';
                    reason = 'Invalid decision value: ' + decision;
                }

                // Update conversation history
                this.conversationHistory.push({ role: 'user', content: cardMarkdown });
                this.conversationHistory.push({
                    role: 'assistant',
                    content: [toolUse]
                });

                var resultMessage = '';
                if (decision === 'reject') {
                    resultMessage = 'Job rejected and skipped.';
                } else if (decision === 'keep') {
                    resultMessage = 'Job accepted. Fetching full details for output.';
                } else {
                    resultMessage = 'Need more information. Full job details will follow.';
                }

                this.conversationHistory.push({
                    role: 'user',
                    content: [
                        {
                            type: 'tool_result',
                            tool_use_id: toolUse.id,
                            content: resultMessage
                        }
                    ]
                });

                resolve({ decision: decision, reason: reason });

            } catch (error) {
                console.error('[LiSeSca] Failed to parse triage response:', error);
                resolve({ decision: 'keep', reason: 'Parse error: ' + error.message }); // Fail-open
            }
        },

        /**
         * Evaluate a full job description after a "maybe" triage decision.
         * @param {string} fullJobMarkdown - The complete job formatted as Markdown.
         * @returns {Promise<{accept: boolean, reason: string}>} Decision object with reason.
         */
        evaluateFullJob: function(fullJobMarkdown) {

            if (!this.isConfigured()) {
                console.warn('[LiSeSca] AI client not configured, accepting job.');
                return Promise.resolve({ accept: true, reason: 'AI not configured' });
            }

            return this.sendFullJobForEvaluation(fullJobMarkdown).catch(function(error) {
                console.error('[LiSeSca] AI full evaluation error, accepting job:', error);
                return { accept: true, reason: 'Error: ' + error.message }; // Fail-open
            });
        },

        /**
         * Send full job details to Claude for final evaluation.
         * @param {string} fullJobMarkdown - The complete job formatted as Markdown.
         * @returns {Promise<{accept: boolean, reason: string}>} Decision object with reason.
         */
        sendFullJobForEvaluation: function(fullJobMarkdown) {
            var self = this;

            var contextMessage = 'Here are the full job details for your final decision:\n\n' + fullJobMarkdown;

            var messagesWithJob = this.conversationHistory.concat([
                { role: 'user', content: contextMessage }
            ]);

            var requestBody = {
                model: 'claude-sonnet-4-5-20250929',
                max_tokens: 300,  // Increased for detailed reason text
                system: FULL_AI_SYSTEM_PROMPT,
                tools: [CARD_TRIAGE_TOOL, FULL_EVALUATION_TOOL],
                tool_choice: { type: 'tool', name: 'full_evaluation' },
                messages: messagesWithJob
            };

            return new Promise(function(resolve, reject) {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: 'https://api.anthropic.com/v1/messages',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': CONFIG.ANTHROPIC_API_KEY,
                        'anthropic-version': '2023-06-01'
                    },
                    data: JSON.stringify(requestBody),
                    onload: function(response) {
                        self.handleFullEvaluationResponse(response, contextMessage, resolve, reject);
                    },
                    onerror: function(error) {
                        console.error('[LiSeSca] AI full evaluation request failed:', error);
                        reject(new Error('Network error'));
                    },
                    ontimeout: function() {
                        console.error('[LiSeSca] AI full evaluation request timed out');
                        reject(new Error('Request timeout'));
                    },
                    timeout: 60000 // 60 second timeout for full job evaluation
                });
            });
        },

        /**
         * Handle the full evaluation API response.
         * @param {Object} response - The GM_xmlhttpRequest response object.
         * @param {string} contextMessage - The message sent with full job details.
         * @param {Function} resolve - Promise resolve function.
         * @param {Function} reject - Promise reject function.
         */
        handleFullEvaluationResponse: function(response, contextMessage, resolve, reject) {
            if (response.status !== 200) {
                console.error('[LiSeSca] AI full evaluation API error:', response.status, response.responseText);
                resolve({ accept: true, reason: 'API error ' + response.status }); // Fail-open
                return;
            }

            try {
                var data = JSON.parse(response.responseText);

                var toolUse = null;
                if (data.content && Array.isArray(data.content)) {
                    for (var i = 0; i < data.content.length; i++) {
                        if (data.content[i].type === 'tool_use') {
                            toolUse = data.content[i];
                            break;
                        }
                    }
                }

                if (!toolUse || toolUse.name !== 'full_evaluation') {
                    console.warn('[LiSeSca] Unexpected full evaluation response, accepting job.');
                    resolve({ accept: true, reason: 'Unexpected response format' });
                    return;
                }

                var accept = toolUse.input.accept === true;
                var reason = toolUse.input.reason || '(no reason provided)';

                // Update conversation history
                this.conversationHistory.push({ role: 'user', content: contextMessage });
                this.conversationHistory.push({
                    role: 'assistant',
                    content: [toolUse]
                });
                this.conversationHistory.push({
                    role: 'user',
                    content: [
                        {
                            type: 'tool_result',
                            tool_use_id: toolUse.id,
                            content: accept ? 'Job accepted and saved.' : 'Job rejected after full review.'
                        }
                    ]
                });

                resolve({ accept: accept, reason: reason });

            } catch (error) {
                console.error('[LiSeSca] Failed to parse full evaluation response:', error);
                resolve({ accept: true, reason: 'Parse error: ' + error.message }); // Fail-open
            }
        },

        // ===== PEOPLE AI MODE =====

        /**
         * Triage a person card using three-tier evaluation (reject/keep/maybe).
         * @param {string} cardMarkdown - The person card formatted as Markdown.
         * @returns {Promise<{decision: string, reason: string}>}
         */
        triagePeopleCard: function(cardMarkdown) {
            var self = this;

            if (!this.isPeopleConfigured()) {
                console.warn('[LiSeSca] People AI not configured, returning "keep".');
                return Promise.resolve({ decision: 'keep', reason: 'AI not configured' });
            }

            return this.initPeopleConversation(true).then(function() {
                return self.sendPeopleCardForTriage(cardMarkdown);
            }).catch(function(error) {
                console.error('[LiSeSca] People AI triage error, returning "keep":', error);
                return { decision: 'keep', reason: 'Error: ' + error.message };
            });
        },

        /**
         * Send a person card to Claude for triage.
         * @param {string} cardMarkdown - The person card formatted as Markdown.
         * @returns {Promise<{decision: string, reason: string}>}
         */
        sendPeopleCardForTriage: function(cardMarkdown) {
            var self = this;

            // Criteria is in the system prompt, conversation history has prior cards
            var messagesWithCard = this.peopleConversationHistory.concat([
                { role: 'user', content: cardMarkdown }
            ]);

            var requestBody = {
                model: 'claude-sonnet-4-5-20250929',
                max_tokens: 200,
                system: PEOPLE_TRIAGE_SYSTEM_PROMPT + CONFIG.PEOPLE_CRITERIA,
                tools: [PEOPLE_CARD_TRIAGE_TOOL],
                tool_choice: { type: 'tool', name: 'people_card_triage' },
                messages: messagesWithCard
            };

            return new Promise(function(resolve, reject) {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: 'https://api.anthropic.com/v1/messages',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': CONFIG.ANTHROPIC_API_KEY,
                        'anthropic-version': '2023-06-01'
                    },
                    data: JSON.stringify(requestBody),
                    onload: function(response) {
                        self.handlePeopleTriageResponse(response, cardMarkdown, resolve, reject);
                    },
                    onerror: function(error) {
                        console.error('[LiSeSca] People AI triage request failed:', error);
                        reject(new Error('Network error'));
                    },
                    ontimeout: function() {
                        console.error('[LiSeSca] People AI triage request timed out');
                        reject(new Error('Request timeout'));
                    },
                    timeout: 30000
                });
            });
        },

        /**
         * Handle the people triage API response and extract the decision.
         * @param {Object} response - The GM_xmlhttpRequest response object.
         * @param {string} cardMarkdown - The original person card.
         * @param {Function} resolve - Promise resolve function.
         * @param {Function} reject - Promise reject function.
         */
        handlePeopleTriageResponse: function(response, cardMarkdown, resolve, reject) {
            if (response.status !== 200) {
                console.error('[LiSeSca] People AI triage API error:', response.status, response.responseText);
                resolve({ decision: 'keep', reason: 'API error ' + response.status });
                return;
            }

            try {
                var data = JSON.parse(response.responseText);
                var toolUse = null;
                if (data.content && Array.isArray(data.content)) {
                    for (var i = 0; i < data.content.length; i++) {
                        if (data.content[i].type === 'tool_use') {
                            toolUse = data.content[i];
                            break;
                        }
                    }
                }

                if (!toolUse || toolUse.name !== 'people_card_triage') {
                    console.warn('[LiSeSca] Unexpected people triage response format, returning "keep".');
                    resolve({ decision: 'keep', reason: 'Unexpected response format' });
                    return;
                }

                var decision = toolUse.input.decision;
                var reason = toolUse.input.reason || '(no reason provided)';

                if (decision !== 'reject' && decision !== 'keep' && decision !== 'maybe') {
                    console.warn('[LiSeSca] Invalid people triage decision "' + decision + '", returning "keep".');
                    decision = 'keep';
                    reason = 'Invalid decision value: ' + decision;
                }

                // Update conversation history
                this.peopleConversationHistory.push({ role: 'user', content: cardMarkdown });
                this.peopleConversationHistory.push({
                    role: 'assistant',
                    content: [toolUse]
                });

                var resultMessage = '';
                if (decision === 'reject') {
                    resultMessage = 'Person rejected and skipped.';
                } else if (decision === 'keep') {
                    resultMessage = 'Person accepted. Fetching full profile for output.';
                } else {
                    resultMessage = 'Need more information. Full profile will follow.';
                }

                this.peopleConversationHistory.push({
                    role: 'user',
                    content: [
                        {
                            type: 'tool_result',
                            tool_use_id: toolUse.id,
                            content: resultMessage
                        }
                    ]
                });

                resolve({ decision: decision, reason: reason });
            } catch (error) {
                console.error('[LiSeSca] Failed to parse people triage response:', error);
                resolve({ decision: 'keep', reason: 'Parse error: ' + error.message });
            }
        },

        /**
         * Evaluate a full profile after a "maybe" triage decision.
         * @param {string} fullProfileMarkdown - The complete profile formatted as Markdown.
         * @returns {Promise<{accept: boolean, reason: string}>}
         */
        evaluateFullProfile: function(fullProfileMarkdown) {

            if (!this.isPeopleConfigured()) {
                console.warn('[LiSeSca] People AI not configured, accepting profile.');
                return Promise.resolve({ accept: true, reason: 'AI not configured' });
            }

            // Full profile evaluation is self-contained (criteria + profile in one call)
            return this.sendFullProfileForEvaluation(fullProfileMarkdown).catch(function(error) {
                console.error('[LiSeSca] People AI full evaluation error, accepting profile:', error);
                return { accept: true, reason: 'Error: ' + error.message };
            });
        },

        /**
         * Send full profile details to Claude for final evaluation.
         * @param {string} fullProfileMarkdown - The complete profile formatted as Markdown.
         * @returns {Promise<{accept: boolean, reason: string}>}
         */
        sendFullProfileForEvaluation: function(fullProfileMarkdown) {
            var self = this;

            // Criteria is in the system prompt, just send the profile data
            var messages = [
                { role: 'user', content: fullProfileMarkdown }
            ];

            var requestBody = {
                model: 'claude-sonnet-4-5-20250929',
                max_tokens: 300,
                system: PEOPLE_PROFILE_SYSTEM_PROMPT + CONFIG.PEOPLE_CRITERIA,
                tools: [PEOPLE_FULL_EVALUATION_TOOL],
                tool_choice: { type: 'tool', name: 'people_full_evaluation' },
                messages: messages
            };

            return new Promise(function(resolve, reject) {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: 'https://api.anthropic.com/v1/messages',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': CONFIG.ANTHROPIC_API_KEY,
                        'anthropic-version': '2023-06-01'
                    },
                    data: JSON.stringify(requestBody),
                    onload: function(response) {
                        self.handlePeopleFullEvaluationResponse(response, fullProfileMarkdown, resolve, reject);
                    },
                    onerror: function(error) {
                        console.error('[LiSeSca] People AI full evaluation request failed:', error);
                        reject(new Error('Network error'));
                    },
                    ontimeout: function() {
                        console.error('[LiSeSca] People AI full evaluation request timed out');
                        reject(new Error('Request timeout'));
                    },
                    timeout: 60000
                });
            });
        },

        /**
         * Handle the full profile evaluation response.
         * @param {Object} response - The GM_xmlhttpRequest response object.
         * @param {string} profileMarkdown - The profile markdown sent for evaluation.
         * @param {Function} resolve - Promise resolve function.
         * @param {Function} reject - Promise reject function.
         */
        handlePeopleFullEvaluationResponse: function(response, profileMarkdown, resolve, reject) {
            if (response.status !== 200) {
                console.error('[LiSeSca] People AI full evaluation API error:', response.status, response.responseText);
                resolve({ accept: true, reason: 'API error ' + response.status });
                return;
            }

            try {
                var data = JSON.parse(response.responseText);
                var toolUse = null;
                if (data.content && Array.isArray(data.content)) {
                    for (var i = 0; i < data.content.length; i++) {
                        if (data.content[i].type === 'tool_use') {
                            toolUse = data.content[i];
                            break;
                        }
                    }
                }

                if (!toolUse || toolUse.name !== 'people_full_evaluation') {
                    console.warn('[LiSeSca] Unexpected people full evaluation response, accepting profile.');
                    resolve({ accept: true, reason: 'Unexpected response format' });
                    return;
                }

                var accept = toolUse.input.accept === true;
                var reason = toolUse.input.reason || '(no reason provided)';

                // Update conversation history (not really used for full profile, but keeping for consistency)
                this.peopleConversationHistory.push({ role: 'user', content: profileMarkdown });
                this.peopleConversationHistory.push({
                    role: 'assistant',
                    content: [toolUse]
                });
                this.peopleConversationHistory.push({
                    role: 'user',
                    content: [
                        {
                            type: 'tool_result',
                            tool_use_id: toolUse.id,
                            content: accept ? 'Person accepted and saved.' : 'Person rejected after full review.'
                        }
                    ]
                });

                resolve({ accept: accept, reason: reason });

            } catch (error) {
                console.error('[LiSeSca] Failed to parse people full evaluation response:', error);
                resolve({ accept: true, reason: 'Parse error: ' + error.message });
            }
        }
    };

    // ===== CSS SELECTORS (JOBS) =====
    // Selectors for LinkedIn's job search DOM.
    // The jobs UI uses a two-panel layout: left panel = job list, right panel = detail view.
    // Job cards use data-job-id attributes for identification.
    const JobSelectors = {
        // Left panel — job list
        JOB_CARD: 'div[data-job-id]',
        JOB_LIST_ITEM: '[data-occludable-job-id]',  // Outer <li> shell — always present for all jobs
        CARD_TITLE_LINK: 'a.job-card-container__link',
        CARD_COMPANY: '.artdeco-entity-lockup__subtitle span',
        CARD_METADATA: '.job-card-container__metadata-wrapper li span',
        CARD_INSIGHT: '.job-card-container__job-insight-text',
        CARD_FOOTER_JOB_STATE: '.job-card-container__footer-job-state',

        DETAIL_TITLE: '.job-details-jobs-unified-top-card__job-title h1',
        DETAIL_COMPANY_NAME: '.job-details-jobs-unified-top-card__company-name a',
        DETAIL_TERTIARY_DESC: '.job-details-jobs-unified-top-card__tertiary-description-container',
        DETAIL_FIT_PREFS: '.job-details-fit-level-preferences button',
        DETAIL_APPLY_BUTTON: '.jobs-apply-button',
        DETAIL_JOB_DESCRIPTION: '#job-details',
        DETAIL_SHOW_MORE: '.inline-show-more-text__button',

        // Premium sections
        DETAIL_PREMIUM_INSIGHTS: '.jobs-premium-applicant-insights',
        // About the company
        DETAIL_ABOUT_COMPANY: '.jobs-company',
        DETAIL_COMPANY_INFO: '.jobs-company__inline-information',
        DETAIL_COMPANY_DESC: '.jobs-company__company-description',

        // People connections
        DETAIL_CONNECTIONS: '.job-details-people-who-can-help__connections-card-summary',

        // Pagination (jobs uses different classes than people search)
        PAGINATION: '.jobs-search-pagination__pages'};

    // ===== PAGINATION (JOBS) =====
    // Handles navigation between job search result pages.
    // Jobs use the "start=" parameter (increments by 25 per page).

    const JobPaginator = {
        /** Number of jobs per page on LinkedIn */
        JOBS_PER_PAGE: 25,

        /**
         * Get the current "start" parameter value from the URL.
         * @returns {number} The start offset (0-based), default 0.
         */
        getCurrentStartParam: function() {
            var url = new URL(window.location.href);
            var startParam = url.searchParams.get('start');
            return startParam ? parseInt(startParam, 10) : 0;
        },

        /**
         * Get the current logical page number (1-based) from the start parameter.
         * @returns {number} Page number (1, 2, 3, ...).
         */
        getCurrentPage: function() {
            return Math.floor(this.getCurrentStartParam() / this.JOBS_PER_PAGE) + 1;
        },

        /**
         * Get the base search URL without the start parameter.
         * @returns {string} The clean base URL.
         */
        getBaseSearchUrl: function() {
            var url = new URL(window.location.href);
            url.searchParams.delete('start');
            return url.toString();
        },

        /**
         * Check if pagination exists on the page.
         * Collections/recommended pages may not have pagination.
         * @returns {boolean}
         */
        hasPagination: function() {
            return document.querySelector(JobSelectors.PAGINATION) !== null;
        },

        /**
         * Get the total number of pages from the "Page X of Y" text.
         * @returns {number} Total pages, or 0 if not found.
         */
        getTotalPages: function() {
            var pageState = document.querySelector('.jobs-search-pagination__page-state');
            if (pageState) {
                var text = (pageState.textContent || '').trim();
                var match = text.match(/Page\s+\d+\s+of\s+(\d+)/i);
                if (match) {
                    return parseInt(match[1], 10);
                }
            }
            return 0;
        },

        /**
         * Check if there is a next page available.
         * Uses the "Page X of Y" indicator, falling back to checking
         * if the current page is less than the detected total.
         * @returns {boolean}
         */
        hasNextPage: function() {
            var totalPages = this.getTotalPages();
            if (totalPages > 0) {
                return this.getCurrentPage() < totalPages;
            }
            // Fallback: check if a "Next" button exists and is not disabled
            var nextBtn = document.querySelector('.jobs-search-pagination__button--next');
            return nextBtn !== null && !nextBtn.disabled;
        },

        /**
         * Navigate to a specific page by setting the start parameter.
         * @param {number} pageNum - The page number (1-based) to navigate to.
         */
        navigateToPage: function(pageNum) {
            var baseUrl = State.get(State.KEYS.SEARCH_URL, this.getBaseSearchUrl());
            var url = new URL(baseUrl);
            var startValue = (pageNum - 1) * this.JOBS_PER_PAGE;
            if (startValue > 0) {
                url.searchParams.set('start', startValue.toString());
            }
            var targetUrl = url.toString();

            console.log('[LiSeSca] Navigating to jobs page ' + pageNum
                + ' (start=' + startValue + '): ' + targetUrl);
            window.location.href = targetUrl;
        }
    };

    // ===== USER INTERFACE =====
    // Creates and manages the floating overlay panel with scrape controls.
    // Adapts to the current page type: green SCRAPE button for people search,
    // blue SCRAPE button for jobs search, with different page count options.

    // Controller and JobController are used in event handlers (runtime calls, not import-time)
    // They will be available in the bundled IIFE scope when Rollup bundles the code.
    // We import them here to satisfy the ES module system.
    // Note: This creates a circular dependency which Rollup handles correctly for IIFE output.
    let Controller$1, JobController$1;

    function setControllers(ctrl, jobCtrl) {
        Controller$1 = ctrl;
        JobController$1 = jobCtrl;
    }

    const UI = {
        /** References to key DOM elements */
        panel: null,
        menu: null,
        statusArea: null,
        noResultsArea: null,
        isMenuOpen: false,

        /** Flag to prevent duplicate style injection (styles persist across SPA navigation) */
        stylesInjected: false,

        /**
         * Inject all LiSeSca styles into the page.
         * Skips if already injected (styles persist across SPA navigation).
         */
        injectStyles: function() {
            if (this.stylesInjected) {
                console.log('[LiSeSca] Styles already injected, skipping.');
                return;
            }
            this.stylesInjected = true;
            GM_addStyle(`
            /* ---- LiSeSca floating panel ---- */
            .lisesca-panel {
                position: fixed;
                top: 10px;
                right: 10px;
                z-index: 10000;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 13px;
                background: #1b1f23;
                color: #e1e4e8;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
                padding: 0;
                min-width: 180px;
                user-select: none;
            }

            /* Top bar with SCRAPE button and gear icon */
            .lisesca-topbar {
                display: flex;
                align-items: center;
                padding: 8px 10px;
                gap: 8px;
            }

            /* The main SCRAPE button — green for people, blue for jobs */
            .lisesca-scrape-btn {
                flex: 1;
                background: #2ea44f;
                color: #ffffff;
                border: none;
                border-radius: 5px;
                padding: 6px 14px;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                letter-spacing: 0.5px;
                transition: background 0.15s;
            }
            .lisesca-scrape-btn:hover {
                background: #3fb950;
            }

            /* Blue variant for jobs pages */
            .lisesca-scrape-btn--jobs {
                background: #1f6feb;
            }
            .lisesca-scrape-btn--jobs:hover {
                background: #388bfd;
            }

            /* Gear (config) icon button */
            .lisesca-gear-btn {
                background: none;
                border: none;
                color: #8b949e;
                cursor: pointer;
                font-size: 16px;
                padding: 4px;
                line-height: 1;
                transition: color 0.15s;
            }
            .lisesca-gear-btn:hover {
                color: #e1e4e8;
            }

            /* Dropdown menu (hidden by default) */
            .lisesca-menu {
                display: none;
                padding: 8px 10px 10px;
                border-top: 1px solid #30363d;
            }
            .lisesca-menu.lisesca-open {
                display: block;
            }

            /* Label text above the dropdown */
            .lisesca-menu-label {
                font-size: 11px;
                color: #8b949e;
                margin-bottom: 5px;
            }

            /* Page count selector dropdown */
            .lisesca-select {
                width: 100%;
                background: #0d1117;
                color: #e1e4e8;
                border: 1px solid #30363d;
                border-radius: 4px;
                padding: 5px 8px;
                font-size: 13px;
                margin-bottom: 8px;
                cursor: pointer;
            }
            .lisesca-select:focus {
                outline: none;
                border-color: #58a6ff;
            }

            /* Format selection checkboxes */
            .lisesca-fmt-label {
                font-size: 11px;
                color: #8b949e;
                margin-bottom: 5px;
                margin-top: 4px;
            }

            .lisesca-fmt-row {
                display: flex;
                gap: 10px;
                margin-bottom: 8px;
            }

            .lisesca-toggle-row {
                display: flex;
                align-items: center;
                gap: 6px;
                margin-bottom: 8px;
            }

            .lisesca-checkbox-label {
                display: flex;
                align-items: center;
                gap: 4px;
                font-size: 12px;
                color: #c9d1d9;
                cursor: pointer;
            }

            .lisesca-checkbox-label input[type="checkbox"] {
                -webkit-appearance: checkbox !important;
                appearance: checkbox !important;
                position: static !important;
                width: 14px !important;
                height: 14px !important;
                min-width: 14px !important;
                min-height: 14px !important;
                flex-shrink: 0 !important;
                accent-color: #58a6ff;
                cursor: pointer;
                margin: 0 2px 0 0 !important;
                padding: 0 !important;
                opacity: 1 !important;
            }

            /* GO button inside the dropdown */
            .lisesca-go-btn {
                width: 100%;
                background: #1f6feb;
                color: #ffffff;
                border: none;
                border-radius: 5px;
                padding: 6px 14px;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                transition: background 0.15s;
            }
            .lisesca-go-btn:hover {
                background: #388bfd;
            }

            /* Status display area (shown during scraping) */
            .lisesca-status {
                display: none;
                padding: 8px 10px 10px;
                border-top: 1px solid #30363d;
                font-size: 12px;
                color: #8b949e;
            }
            .lisesca-status.lisesca-visible {
                display: block;
            }

            .lisesca-status-progress {
                display: none;
                margin-bottom: 4px;
            }
            .lisesca-status-progress.lisesca-visible {
                display: block;
            }

            /* Stop button (shown during scraping) */
            .lisesca-stop-btn {
                width: 100%;
                background: #da3633;
                color: #ffffff;
                border: none;
                border-radius: 5px;
                padding: 5px 12px;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
                margin-top: 6px;
                transition: background 0.15s;
            }
            .lisesca-stop-btn:hover {
                background: #f85149;
            }

            /* AI stats display in progress area */
            .lisesca-ai-stats {
                display: none;
                font-size: 11px;
                color: #58a6ff;
                margin-bottom: 4px;
            }
            .lisesca-ai-stats.lisesca-visible {
                display: block;
            }

            /* No-results notification */
            .lisesca-no-results {
                display: none;
                padding: 12px 10px;
                border-top: 1px solid #30363d;
                text-align: center;
            }
            .lisesca-no-results.lisesca-visible {
                display: block;
            }
            .lisesca-no-results-icon {
                font-size: 24px;
                margin-bottom: 8px;
                color: #8b949e;
            }
            .lisesca-no-results-title {
                font-size: 13px;
                font-weight: 600;
                color: #e1e4e8;
                margin-bottom: 6px;
            }
            .lisesca-no-results-stats {
                font-size: 11px;
                color: #8b949e;
                margin-bottom: 10px;
            }
            .lisesca-no-results-btn {
                width: 100%;
                background: #21262d;
                color: #c9d1d9;
                border: 1px solid #30363d;
                border-radius: 5px;
                padding: 6px 12px;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
                transition: background 0.15s;
            }
            .lisesca-no-results-btn:hover {
                background: #30363d;
            }

            /* ---- Configuration overlay ---- */
            .lisesca-config-overlay {
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.5);
                z-index: 10001;
                justify-content: center;
                align-items: center;
            }
            .lisesca-config-overlay.lisesca-visible {
                display: flex;
            }

            .lisesca-config-panel {
                background: #1b1f23;
                color: #e1e4e8;
                border-radius: 10px;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
                padding: 20px 24px;
                min-width: 280px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 13px;
            }

            .lisesca-config-title {
                font-size: 15px;
                font-weight: 600;
                margin-bottom: 16px;
                color: #f0f6fc;
            }

            .lisesca-config-version {
                font-size: 11px;
                color: #8b949e;
                margin-top: -12px;
                margin-bottom: 16px;
            }

            .lisesca-config-section {
                font-size: 12px;
                font-weight: 600;
                color: #8b949e;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                margin-top: 14px;
                margin-bottom: 10px;
                padding-bottom: 4px;
                border-bottom: 1px solid #30363d;
            }

            .lisesca-config-row {
                margin-bottom: 12px;
            }

            .lisesca-config-row label {
                display: block;
                font-size: 11px;
                color: #8b949e;
                margin-bottom: 4px;
            }

            .lisesca-config-row input {
                width: 100%;
                background: #0d1117;
                color: #e1e4e8;
                border: 1px solid #30363d;
                border-radius: 4px;
                padding: 5px 8px;
                font-size: 13px;
                box-sizing: border-box;
            }
            .lisesca-config-row input:focus {
                outline: none;
                border-color: #58a6ff;
            }

            .lisesca-config-error {
                color: #f85149;
                font-size: 11px;
                margin-top: 4px;
                min-height: 16px;
            }

            .lisesca-config-buttons {
                display: flex;
                gap: 8px;
                margin-top: 16px;
            }

            .lisesca-config-save {
                flex: 1;
                background: #1f6feb;
                color: #ffffff;
                border: none;
                border-radius: 5px;
                padding: 7px 14px;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                transition: background 0.15s;
            }
            .lisesca-config-save:hover {
                background: #388bfd;
            }

            .lisesca-config-cancel {
                flex: 1;
                background: #21262d;
                color: #c9d1d9;
                border: 1px solid #30363d;
                border-radius: 5px;
                padding: 7px 14px;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                transition: background 0.15s;
            }
            .lisesca-config-cancel:hover {
                background: #30363d;
            }

            /* ---- AI Configuration overlay ---- */
            .lisesca-ai-config-overlay {
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.5);
                z-index: 10002;
                justify-content: center;
                align-items: center;
            }
            .lisesca-ai-config-overlay.lisesca-visible {
                display: flex;
            }

            .lisesca-ai-config-panel {
                background: #1b1f23;
                color: #e1e4e8;
                border-radius: 10px;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
                padding: 20px 24px;
                width: 400px;
                max-width: 90vw;
                max-height: 90vh;
                overflow-y: auto;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 13px;
            }

            .lisesca-ai-config-title {
                font-size: 15px;
                font-weight: 600;
                margin-bottom: 16px;
                color: #f0f6fc;
            }

            .lisesca-ai-config-row {
                margin-bottom: 14px;
            }

            .lisesca-ai-config-row label {
                display: block;
                font-size: 11px;
                color: #8b949e;
                margin-bottom: 4px;
            }

            .lisesca-ai-config-row input[type="password"],
            .lisesca-ai-config-row input[type="text"] {
                width: 100%;
                background: #0d1117;
                color: #e1e4e8;
                border: 1px solid #30363d;
                border-radius: 4px;
                padding: 8px 10px;
                font-size: 13px;
                box-sizing: border-box;
            }
            .lisesca-ai-config-row input:focus {
                outline: none;
                border-color: #58a6ff;
            }

            .lisesca-ai-config-row textarea {
                width: 100%;
                background: #0d1117;
                color: #e1e4e8;
                border: 1px solid #30363d;
                border-radius: 4px;
                padding: 8px 10px;
                font-size: 13px;
                font-family: inherit;
                box-sizing: border-box;
                resize: vertical;
                min-height: 200px;
            }
            .lisesca-ai-config-row textarea:focus {
                outline: none;
                border-color: #58a6ff;
            }

            .lisesca-ai-config-row .lisesca-hint {
                font-size: 10px;
                color: #6e7681;
                margin-top: 4px;
            }

            .lisesca-ai-config-error {
                color: #f85149;
                font-size: 11px;
                margin-top: 4px;
                min-height: 16px;
            }

            .lisesca-ai-config-buttons {
                display: flex;
                gap: 8px;
                margin-top: 16px;
            }

            .lisesca-ai-config-save {
                flex: 1;
                background: #1f6feb;
                color: #ffffff;
                border: none;
                border-radius: 5px;
                padding: 7px 14px;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                transition: background 0.15s;
            }
            .lisesca-ai-config-save:hover {
                background: #388bfd;
            }

            .lisesca-ai-config-cancel {
                flex: 1;
                background: #21262d;
                color: #c9d1d9;
                border: 1px solid #30363d;
                border-radius: 5px;
                padding: 7px 14px;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                transition: background 0.15s;
            }
            .lisesca-ai-config-cancel:hover {
                background: #30363d;
            }

            /* Button to open AI config from main config panel */
            .lisesca-ai-config-btn {
                width: 100%;
                background: #21262d;
                color: #c9d1d9;
                border: 1px solid #30363d;
                border-radius: 5px;
                padding: 7px 14px;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                transition: background 0.15s;
            }
            .lisesca-ai-config-btn:hover {
                background: #30363d;
            }

            /* AI toggle in scrape menu - disabled state */
            .lisesca-checkbox-label.lisesca-disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
            .lisesca-checkbox-label.lisesca-disabled input[type="checkbox"] {
                cursor: not-allowed;
            }
        `);
        },

        /**
         * Build and inject the floating panel, adapting to the current page type.
         * People search: green SCRAPE button, page options 1/10/50/All.
         * Jobs search: blue SCRAPE button, page options 1/3/5/10.
         */
        createPanel: function() {
            var pageType = PageDetector.getPageType();
            var isJobs = (pageType === 'jobs');

            // Create the main container
            this.panel = document.createElement('div');
            this.panel.className = 'lisesca-panel';

            // --- Top bar ---
            var topbar = document.createElement('div');
            topbar.className = 'lisesca-topbar';

            // SCRAPE button — color depends on page type
            var scrapeBtn = document.createElement('button');
            scrapeBtn.className = 'lisesca-scrape-btn' + (isJobs ? ' lisesca-scrape-btn--jobs' : '');
            scrapeBtn.textContent = 'SCRAPE';
            scrapeBtn.addEventListener('click', function() {
                UI.toggleMenu();
            });

            // Gear icon — opens configuration
            var gearBtn = document.createElement('button');
            gearBtn.className = 'lisesca-gear-btn';
            gearBtn.innerHTML = '&#9881;';
            gearBtn.title = 'Configuration';
            gearBtn.addEventListener('click', function() {
                UI.showConfig();
            });

            topbar.appendChild(scrapeBtn);
            topbar.appendChild(gearBtn);

            // --- Dropdown menu ---
            this.menu = document.createElement('div');
            this.menu.className = 'lisesca-menu';

            // "Pages to scrape" label
            var label = document.createElement('div');
            label.className = 'lisesca-menu-label';
            label.textContent = 'Pages to scrape:';

            // Page count selector — different options for people vs jobs
            var select = document.createElement('select');
            select.className = 'lisesca-select';
            select.id = 'lisesca-page-select';

            var options;
            if (isJobs) {
                // Try to read total results count from the page subtitle
                var totalJobsText = '';
                var subtitleEl = document.querySelector('.jobs-search-results-list__subtitle span');
                var totalJobs = 0;
                if (subtitleEl) {
                    totalJobsText = (subtitleEl.textContent || '').trim();
                    var match = totalJobsText.match(/^([\d,]+)\s+result/);
                    if (match) {
                        totalJobs = parseInt(match[1].replace(/,/g, ''), 10);
                    }
                }
                var totalPages = totalJobs > 0
                    ? Math.ceil(totalJobs / JobPaginator.JOBS_PER_PAGE)
                    : 0;

                // Build the "All" label with page count if available
                var allLabel = 'All';
                if (totalJobs > 0) {
                    allLabel = 'All (' + totalPages + 'p)';
                }

                options = [
                    { value: '1', text: '1' },
                    { value: '3', text: '3' },
                    { value: '5', text: '5' },
                    { value: '10', text: '10' },
                    { value: 'all', text: allLabel }
                ];
            } else {
                options = [
                    { value: '1', text: '1' },
                    { value: '10', text: '10' },
                    { value: '50', text: '50' },
                    { value: 'all', text: 'All' }
                ];
            }
            options.forEach(function(opt) {
                var option = document.createElement('option');
                option.value = opt.value;
                option.textContent = opt.text;
                select.appendChild(option);
            });

            // --- Format selection checkboxes ---
            var fmtLabel = document.createElement('div');
            fmtLabel.className = 'lisesca-fmt-label';
            fmtLabel.textContent = 'Save as:';

            var fmtRow = document.createElement('div');
            fmtRow.className = 'lisesca-fmt-row';

            // XLSX checkbox (checked by default)
            var xlsxLabel = document.createElement('label');
            xlsxLabel.className = 'lisesca-checkbox-label';
            var xlsxCheck = document.createElement('input');
            xlsxCheck.type = 'checkbox';
            xlsxCheck.id = 'lisesca-fmt-xlsx';
            xlsxCheck.checked = true;
            xlsxLabel.appendChild(xlsxCheck);
            xlsxLabel.appendChild(document.createTextNode('XLSX'));
            fmtRow.appendChild(xlsxLabel);

            // CSV checkbox — only for people search (not useful for jobs)
            if (!isJobs) {
                var csvLabel = document.createElement('label');
                csvLabel.className = 'lisesca-checkbox-label';
                var csvCheck = document.createElement('input');
                csvCheck.type = 'checkbox';
                csvCheck.id = 'lisesca-fmt-csv';
                csvCheck.checked = false;
                csvLabel.appendChild(csvCheck);
                csvLabel.appendChild(document.createTextNode('CSV'));
                fmtRow.appendChild(csvLabel);
            }

            // Markdown checkbox (unchecked by default)
            var mdLabel = document.createElement('label');
            mdLabel.className = 'lisesca-checkbox-label';
            var mdCheck = document.createElement('input');
            mdCheck.type = 'checkbox';
            mdCheck.id = 'lisesca-fmt-md';
            mdCheck.checked = false;
            mdLabel.appendChild(mdCheck);
            mdLabel.appendChild(document.createTextNode('Markdown'));
            fmtRow.appendChild(mdLabel);

            var includeViewedRow = null;
            var includeViewedCheck = null;
            var aiEnabledRow = null;
            var aiEnabledCheck = null;
            var fullAIRow = null;
            var fullAICheck = null;
            var peopleAIEnabledRow = null;
            var peopleAIEnabledCheck = null;
            var peopleFullAIRow = null;
            var peopleFullAICheck = null;
            if (isJobs) {
                includeViewedRow = document.createElement('div');
                includeViewedRow.className = 'lisesca-toggle-row';

                var includeViewedLabel = document.createElement('label');
                includeViewedLabel.className = 'lisesca-checkbox-label';
                includeViewedCheck = document.createElement('input');
                includeViewedCheck.type = 'checkbox';
                includeViewedCheck.id = 'lisesca-include-viewed';
                includeViewedCheck.checked = State.getIncludeViewed();
                includeViewedCheck.addEventListener('change', function() {
                    State.saveIncludeViewed(includeViewedCheck.checked);
                });
                includeViewedLabel.appendChild(includeViewedCheck);
                includeViewedLabel.appendChild(document.createTextNode('Include viewed'));
                includeViewedRow.appendChild(includeViewedLabel);

                // AI job selection toggle
                aiEnabledRow = document.createElement('div');
                aiEnabledRow.className = 'lisesca-toggle-row';

                var aiEnabledLabel = document.createElement('label');
                aiEnabledLabel.className = 'lisesca-checkbox-label';

                // Disable if AI is not configured
                var aiConfigured = CONFIG.isAIConfigured();
                if (!aiConfigured) {
                    aiEnabledLabel.classList.add('lisesca-disabled');
                }

                aiEnabledCheck = document.createElement('input');
                aiEnabledCheck.type = 'checkbox';
                aiEnabledCheck.id = 'lisesca-ai-enabled';
                aiEnabledCheck.checked = aiConfigured && State.getAIEnabled();
                aiEnabledCheck.disabled = !aiConfigured;

                aiEnabledLabel.appendChild(aiEnabledCheck);
                aiEnabledLabel.appendChild(document.createTextNode('AI job selection'));
                aiEnabledRow.appendChild(aiEnabledLabel);

                // Full AI evaluation toggle (indented, only visible when AI enabled)
                fullAIRow = document.createElement('div');
                fullAIRow.className = 'lisesca-toggle-row';
                fullAIRow.id = 'lisesca-full-ai-row';
                fullAIRow.style.marginLeft = '16px';  // Visual hierarchy (indented)
                fullAIRow.style.display = (aiConfigured && aiEnabledCheck.checked) ? 'flex' : 'none';

                var fullAILabel = document.createElement('label');
                fullAILabel.className = 'lisesca-checkbox-label';

                fullAICheck = document.createElement('input');
                fullAICheck.type = 'checkbox';
                fullAICheck.id = 'lisesca-full-ai-enabled';
                fullAICheck.checked = aiConfigured && State.getFullAIEnabled();
                fullAICheck.disabled = !aiConfigured;

                // Auto-uncheck "Include viewed" when Full AI is enabled
                fullAICheck.addEventListener('change', function() {
                    State.saveFullAIEnabled(fullAICheck.checked);
                    if (fullAICheck.checked && includeViewedCheck) {
                        includeViewedCheck.checked = false;
                        State.saveIncludeViewed(false);
                    }
                });

                fullAILabel.appendChild(fullAICheck);
                fullAILabel.appendChild(document.createTextNode('Full AI evaluation'));
                fullAIRow.appendChild(fullAILabel);

                // AI enabled toggle controls Full AI row visibility
                aiEnabledCheck.addEventListener('change', function() {
                    State.saveAIEnabled(aiEnabledCheck.checked);
                    // Show/hide Full AI row based on AI enabled state
                    if (aiEnabledCheck.checked) {
                        fullAIRow.style.display = 'flex';
                    } else {
                        fullAIRow.style.display = 'none';
                        // Also disable Full AI when AI is disabled
                        fullAICheck.checked = false;
                        State.saveFullAIEnabled(false);
                    }
                });
            } else {
                // AI people selection toggle
                peopleAIEnabledRow = document.createElement('div');
                peopleAIEnabledRow.className = 'lisesca-toggle-row';

                var peopleAIEnabledLabel = document.createElement('label');
                peopleAIEnabledLabel.className = 'lisesca-checkbox-label';

                var peopleAIConfigured = CONFIG.isPeopleAIConfigured();
                if (!peopleAIConfigured) {
                    peopleAIEnabledLabel.classList.add('lisesca-disabled');
                }

                peopleAIEnabledCheck = document.createElement('input');
                peopleAIEnabledCheck.type = 'checkbox';
                peopleAIEnabledCheck.id = 'lisesca-people-ai-enabled';
                peopleAIEnabledCheck.checked = peopleAIConfigured && State.getPeopleAIEnabled();
                peopleAIEnabledCheck.disabled = !peopleAIConfigured;

                peopleAIEnabledLabel.appendChild(peopleAIEnabledCheck);
                peopleAIEnabledLabel.appendChild(document.createTextNode('AI Deep Scrape'));
                peopleAIEnabledRow.appendChild(peopleAIEnabledLabel);

                // Full AI evaluation toggle (indented, only visible when AI enabled)
                peopleFullAIRow = document.createElement('div');
                peopleFullAIRow.className = 'lisesca-toggle-row';
                peopleFullAIRow.id = 'lisesca-people-full-ai-row';
                peopleFullAIRow.style.marginLeft = '16px';
                peopleFullAIRow.style.display = (peopleAIConfigured && peopleAIEnabledCheck.checked) ? 'flex' : 'none';

                var peopleFullAILabel = document.createElement('label');
                peopleFullAILabel.className = 'lisesca-checkbox-label';

                peopleFullAICheck = document.createElement('input');
                peopleFullAICheck.type = 'checkbox';
                peopleFullAICheck.id = 'lisesca-people-full-ai-enabled';
                peopleFullAICheck.checked = peopleAIConfigured && State.getPeopleFullAIEnabled();
                peopleFullAICheck.disabled = !peopleAIConfigured;

                peopleFullAICheck.addEventListener('change', function() {
                    State.savePeopleFullAIEnabled(peopleFullAICheck.checked);
                });

                peopleFullAILabel.appendChild(peopleFullAICheck);
                peopleFullAILabel.appendChild(document.createTextNode('Full AI evaluation'));
                peopleFullAIRow.appendChild(peopleFullAILabel);

                // AI enabled toggle controls Full AI row visibility
                peopleAIEnabledCheck.addEventListener('change', function() {
                    State.savePeopleAIEnabled(peopleAIEnabledCheck.checked);
                    UI.updatePeopleAIToggleState();
                });
            }

            // GO button — dispatches to the correct controller
            var goBtn = document.createElement('button');
            goBtn.className = 'lisesca-go-btn';
            goBtn.textContent = 'GO';
            goBtn.addEventListener('click', function() {
                var pageSelect = document.getElementById('lisesca-page-select');
                var selectedValue = pageSelect.value;
                console.log('[LiSeSca] GO pressed, pages=' + selectedValue + ', pageType=' + pageType);

                if (isJobs) {
                    State.saveIncludeViewed(State.readIncludeViewedFromUI());
                    JobController$1.startScraping(selectedValue);
                } else {
                    Controller$1.startScraping(selectedValue);
                }
            });

            this.menu.appendChild(label);
            this.menu.appendChild(select);
            this.menu.appendChild(fmtLabel);
            this.menu.appendChild(fmtRow);
            if (includeViewedRow) {
                this.menu.appendChild(includeViewedRow);
            }
            if (aiEnabledRow) {
                this.menu.appendChild(aiEnabledRow);
            }
            if (fullAIRow) {
                this.menu.appendChild(fullAIRow);
            }
            if (peopleAIEnabledRow) {
                this.menu.appendChild(peopleAIEnabledRow);
            }
            if (peopleFullAIRow) {
                this.menu.appendChild(peopleFullAIRow);
            }
            this.menu.appendChild(goBtn);

            // --- Status area ---
            this.statusArea = document.createElement('div');
            this.statusArea.className = 'lisesca-status';

            var progressText = document.createElement('div');
            progressText.id = 'lisesca-status-progress';
            progressText.className = 'lisesca-status-progress';
            progressText.textContent = '';

            // AI stats display (shown when AI filtering is active)
            var aiStatsText = document.createElement('div');
            aiStatsText.id = 'lisesca-ai-stats';
            aiStatsText.className = 'lisesca-ai-stats';
            aiStatsText.textContent = '';

            var statusText = document.createElement('div');
            statusText.id = 'lisesca-status-text';
            statusText.textContent = 'Initializing...';

            var stopBtn = document.createElement('button');
            stopBtn.className = 'lisesca-stop-btn';
            stopBtn.textContent = 'STOP';
            stopBtn.addEventListener('click', function() {
                // Dispatch to the correct controller based on active scrape mode
                var mode = State.getScrapeMode();
                if (mode === 'jobs') {
                    JobController$1.stopScraping();
                } else {
                    Controller$1.stopScraping();
                }
            });

            this.statusArea.appendChild(progressText);
            this.statusArea.appendChild(aiStatsText);
            this.statusArea.appendChild(statusText);
            this.statusArea.appendChild(stopBtn);

            // --- No-results notification area ---
            this.noResultsArea = document.createElement('div');
            this.noResultsArea.className = 'lisesca-no-results';
            this.noResultsArea.id = 'lisesca-no-results';

            var noResultsIcon = document.createElement('div');
            noResultsIcon.className = 'lisesca-no-results-icon';
            noResultsIcon.textContent = '\u2205'; // Empty set symbol

            var noResultsTitle = document.createElement('div');
            noResultsTitle.className = 'lisesca-no-results-title';
            noResultsTitle.id = 'lisesca-no-results-title';
            noResultsTitle.textContent = 'No matching jobs found';

            var noResultsStats = document.createElement('div');
            noResultsStats.className = 'lisesca-no-results-stats';
            noResultsStats.id = 'lisesca-no-results-stats';
            noResultsStats.textContent = '';

            var noResultsBtn = document.createElement('button');
            noResultsBtn.className = 'lisesca-no-results-btn';
            noResultsBtn.textContent = 'OK';
            noResultsBtn.addEventListener('click', function() {
                UI.hideNoResults();
            });

            this.noResultsArea.appendChild(noResultsIcon);
            this.noResultsArea.appendChild(noResultsTitle);
            this.noResultsArea.appendChild(noResultsStats);
            this.noResultsArea.appendChild(noResultsBtn);

            // --- Assemble panel ---
            this.panel.appendChild(topbar);
            this.panel.appendChild(this.menu);
            this.panel.appendChild(this.statusArea);
            this.panel.appendChild(this.noResultsArea);

            document.body.appendChild(this.panel);
            console.log('[LiSeSca] UI panel injected (' + pageType + ' mode).');
        },

        /**
         * Toggle the dropdown menu open/closed.
         */
        toggleMenu: function() {
            this.isMenuOpen = !this.isMenuOpen;
            if (this.isMenuOpen) {
                this.updateJobsAllLabel();
                this.updateAIToggleState();
                this.updatePeopleAIToggleState();
                this.menu.classList.add('lisesca-open');
            } else {
                this.menu.classList.remove('lisesca-open');
            }
        },

        /**
         * Refresh the "All (Np)" label for jobs if total is known.
         */
        updateJobsAllLabel: function() {
            if (!PageDetector.isOnJobsPage()) {
                return;
            }
            var select = document.getElementById('lisesca-page-select');
            if (!select) {
                return;
            }
            var subtitleEl = document.querySelector('.jobs-search-results-list__subtitle span');
            var totalJobs = 0;
            if (subtitleEl) {
                var totalJobsText = (subtitleEl.textContent || '').trim();
                var match = totalJobsText.match(/^([\d,]+)\s+result/);
                if (match) {
                    totalJobs = parseInt(match[1].replace(/,/g, ''), 10);
                }
            }
            var totalPages = totalJobs > 0
                ? Math.ceil(totalJobs / JobPaginator.JOBS_PER_PAGE)
                : 0;
            var allLabel = (totalPages > 0) ? ('All (' + totalPages + 'p)') : 'All';
            for (var i = 0; i < select.options.length; i += 1) {
                if (select.options[i].value === 'all') {
                    select.options[i].textContent = allLabel;
                    break;
                }
            }
        },

        /**
         * Show a status message in the status area.
         * @param {string} message - The status text to display.
         */
        showStatus: function(message) {
            this.menu.classList.remove('lisesca-open');
            this.isMenuOpen = false;
            this.statusArea.classList.add('lisesca-visible');
            document.getElementById('lisesca-status-text').textContent = message;
        },

        /**
         * Update the job progress line in the status area.
         * @param {string} message - Progress text to display (empty to hide).
         */
        showProgress: function(message) {
            var progressEl = document.getElementById('lisesca-status-progress');
            if (!progressEl) {
                return;
            }
            if (message) {
                progressEl.textContent = message;
                progressEl.classList.add('lisesca-visible');
            } else {
                progressEl.textContent = '';
                progressEl.classList.remove('lisesca-visible');
            }
        },

        /**
         * Hide the status area.
         */
        hideStatus: function() {
            this.statusArea.classList.remove('lisesca-visible');
        },

        /**
         * Switch the panel into "idle" mode.
         */
        showIdleState: function() {
            this.hideStatus();
            this.showProgress('');
            this.hideAIStats();
            this.hideNoResults();
            this.menu.classList.remove('lisesca-open');
            this.isMenuOpen = false;
        },

        /**
         * Show AI evaluation statistics in the status area.
         * @param {number} evaluated - Number of jobs evaluated by AI.
         * @param {number} accepted - Number of jobs accepted by AI.
         */
        showAIStats: function(evaluated, accepted, labelSuffix) {
            var statsEl = document.getElementById('lisesca-ai-stats');
            if (!statsEl) {
                return;
            }
            if (evaluated > 0) {
                if (labelSuffix === '') {
                    statsEl.textContent = 'AI ' + accepted + '/' + evaluated;
                } else {
                    var suffix = (labelSuffix === undefined) ? ' accepted' : labelSuffix;
                    statsEl.textContent = 'AI: ' + accepted + '/' + evaluated + suffix;
                }
                statsEl.classList.add('lisesca-visible');
            } else {
                statsEl.textContent = '';
                statsEl.classList.remove('lisesca-visible');
            }
        },

        /**
         * Hide the AI stats display.
         */
        hideAIStats: function() {
            var statsEl = document.getElementById('lisesca-ai-stats');
            if (statsEl) {
                statsEl.textContent = '';
                statsEl.classList.remove('lisesca-visible');
            }
        },

        /**
         * Show the no-results notification with statistics.
         * @param {number} evaluated - Number of jobs evaluated by AI.
         * @param {number} pagesScraped - Number of pages scanned.
         */
        showNoResults: function(evaluated, pagesScraped) {
            // Hide status area first
            this.hideStatus();
            this.hideAIStats();

            // Update the stats text
            var statsEl = document.getElementById('lisesca-no-results-stats');
            if (statsEl) {
                var statsText = evaluated + ' job' + (evaluated !== 1 ? 's' : '') + ' scanned';
                if (pagesScraped > 1) {
                    statsText += ' across ' + pagesScraped + ' pages';
                }
                statsText += ', none matched your criteria';
                statsEl.textContent = statsText;
            }

            // Show the no-results area
            var noResultsEl = document.getElementById('lisesca-no-results');
            if (noResultsEl) {
                noResultsEl.classList.add('lisesca-visible');
            }
        },

        /**
         * Hide the no-results notification.
         */
        hideNoResults: function() {
            var noResultsEl = document.getElementById('lisesca-no-results');
            if (noResultsEl) {
                noResultsEl.classList.remove('lisesca-visible');
            }
        },

        // --- Configuration panel ---
        configOverlay: null,

        // --- AI Configuration panel ---
        aiConfigOverlay: null,

        /**
         * Create the configuration panel overlay.
         */
        createConfigPanel: function() {
            this.configOverlay = document.createElement('div');
            this.configOverlay.className = 'lisesca-config-overlay';

            var panel = document.createElement('div');
            panel.className = 'lisesca-config-panel';

            var title = document.createElement('div');
            title.className = 'lisesca-config-title';
            title.textContent = 'LiSeSca Configuration';

            var version = document.createElement('div');
            version.className = 'lisesca-config-version';
            version.textContent = 'v' + CONFIG.VERSION;

            var minRow = document.createElement('div');
            minRow.className = 'lisesca-config-row';

            var minLabel = document.createElement('label');
            minLabel.textContent = 'Minimum page time (seconds):';
            minLabel.htmlFor = 'lisesca-config-min';

            var minInput = document.createElement('input');
            minInput.type = 'number';
            minInput.id = 'lisesca-config-min';
            minInput.min = '5';
            minInput.max = '30';
            minInput.value = CONFIG.MIN_PAGE_TIME.toString();

            minRow.appendChild(minLabel);
            minRow.appendChild(minInput);

            var maxRow = document.createElement('div');
            maxRow.className = 'lisesca-config-row';

            var maxLabel = document.createElement('label');
            maxLabel.textContent = 'Maximum page time (seconds):';
            maxLabel.htmlFor = 'lisesca-config-max';

            var maxInput = document.createElement('input');
            maxInput.type = 'number';
            maxInput.id = 'lisesca-config-max';
            maxInput.min = '15';
            maxInput.max = '120';
            maxInput.value = CONFIG.MAX_PAGE_TIME.toString();

            maxRow.appendChild(maxLabel);
            maxRow.appendChild(maxInput);

            // --- Job timing section ---
            var jobSectionLabel = document.createElement('div');
            jobSectionLabel.className = 'lisesca-config-section';
            jobSectionLabel.textContent = 'Job scraping timing';

            var jobReviewMinRow = document.createElement('div');
            jobReviewMinRow.className = 'lisesca-config-row';

            var jobReviewMinLabel = document.createElement('label');
            jobReviewMinLabel.textContent = 'Min job review time (seconds):';
            jobReviewMinLabel.htmlFor = 'lisesca-config-job-review-min';

            var jobReviewMinInput = document.createElement('input');
            jobReviewMinInput.type = 'number';
            jobReviewMinInput.id = 'lisesca-config-job-review-min';
            jobReviewMinInput.min = '1';
            jobReviewMinInput.max = '30';
            jobReviewMinInput.value = CONFIG.MIN_JOB_REVIEW_TIME.toString();

            jobReviewMinRow.appendChild(jobReviewMinLabel);
            jobReviewMinRow.appendChild(jobReviewMinInput);

            var jobReviewMaxRow = document.createElement('div');
            jobReviewMaxRow.className = 'lisesca-config-row';

            var jobReviewMaxLabel = document.createElement('label');
            jobReviewMaxLabel.textContent = 'Max job review time (seconds):';
            jobReviewMaxLabel.htmlFor = 'lisesca-config-job-review-max';

            var jobReviewMaxInput = document.createElement('input');
            jobReviewMaxInput.type = 'number';
            jobReviewMaxInput.id = 'lisesca-config-job-review-max';
            jobReviewMaxInput.min = '2';
            jobReviewMaxInput.max = '60';
            jobReviewMaxInput.value = CONFIG.MAX_JOB_REVIEW_TIME.toString();

            jobReviewMaxRow.appendChild(jobReviewMaxLabel);
            jobReviewMaxRow.appendChild(jobReviewMaxInput);

            var jobPauseMinRow = document.createElement('div');
            jobPauseMinRow.className = 'lisesca-config-row';

            var jobPauseMinLabel = document.createElement('label');
            jobPauseMinLabel.textContent = 'Min pause between jobs (seconds):';
            jobPauseMinLabel.htmlFor = 'lisesca-config-job-pause-min';

            var jobPauseMinInput = document.createElement('input');
            jobPauseMinInput.type = 'number';
            jobPauseMinInput.id = 'lisesca-config-job-pause-min';
            jobPauseMinInput.min = '0';
            jobPauseMinInput.max = '15';
            jobPauseMinInput.value = CONFIG.MIN_JOB_PAUSE.toString();

            jobPauseMinRow.appendChild(jobPauseMinLabel);
            jobPauseMinRow.appendChild(jobPauseMinInput);

            var jobPauseMaxRow = document.createElement('div');
            jobPauseMaxRow.className = 'lisesca-config-row';

            var jobPauseMaxLabel = document.createElement('label');
            jobPauseMaxLabel.textContent = 'Max pause between jobs (seconds):';
            jobPauseMaxLabel.htmlFor = 'lisesca-config-job-pause-max';

            var jobPauseMaxInput = document.createElement('input');
            jobPauseMaxInput.type = 'number';
            jobPauseMaxInput.id = 'lisesca-config-job-pause-max';
            jobPauseMaxInput.min = '1';
            jobPauseMaxInput.max = '30';
            jobPauseMaxInput.value = CONFIG.MAX_JOB_PAUSE.toString();

            jobPauseMaxRow.appendChild(jobPauseMaxLabel);
            jobPauseMaxRow.appendChild(jobPauseMaxInput);

            // --- AI Filtering section ---
            var aiSectionLabel = document.createElement('div');
            aiSectionLabel.className = 'lisesca-config-section';
            aiSectionLabel.textContent = 'AI Job Filtering';

            var aiConfigBtnRow = document.createElement('div');
            aiConfigBtnRow.className = 'lisesca-config-row';

            var aiConfigBtn = document.createElement('button');
            aiConfigBtn.className = 'lisesca-ai-config-btn';
            aiConfigBtn.textContent = 'AI Filtering...';
            aiConfigBtn.addEventListener('click', function() {
                UI.hideConfig();
                UI.showAIConfig();
            });

            aiConfigBtnRow.appendChild(aiConfigBtn);

            var errorDiv = document.createElement('div');
            errorDiv.className = 'lisesca-config-error';
            errorDiv.id = 'lisesca-config-error';

            var buttonsRow = document.createElement('div');
            buttonsRow.className = 'lisesca-config-buttons';

            var saveBtn = document.createElement('button');
            saveBtn.className = 'lisesca-config-save';
            saveBtn.textContent = 'Save';
            saveBtn.addEventListener('click', function() {
                UI.saveConfig();
            });

            var cancelBtn = document.createElement('button');
            cancelBtn.className = 'lisesca-config-cancel';
            cancelBtn.textContent = 'Cancel';
            cancelBtn.addEventListener('click', function() {
                UI.hideConfig();
            });

            buttonsRow.appendChild(saveBtn);
            buttonsRow.appendChild(cancelBtn);

            // --- Page timing section label ---
            var pageSectionLabel = document.createElement('div');
            pageSectionLabel.className = 'lisesca-config-section';
            pageSectionLabel.textContent = 'Page scanning timing';

            panel.appendChild(title);
            panel.appendChild(version);
            panel.appendChild(pageSectionLabel);
            panel.appendChild(minRow);
            panel.appendChild(maxRow);
            panel.appendChild(jobSectionLabel);
            panel.appendChild(jobReviewMinRow);
            panel.appendChild(jobReviewMaxRow);
            panel.appendChild(jobPauseMinRow);
            panel.appendChild(jobPauseMaxRow);
            panel.appendChild(aiSectionLabel);
            panel.appendChild(aiConfigBtnRow);
            panel.appendChild(errorDiv);
            panel.appendChild(buttonsRow);

            this.configOverlay.appendChild(panel);

            this.configOverlay.addEventListener('click', function(event) {
                if (event.target === UI.configOverlay) {
                    UI.hideConfig();
                }
            });

            document.body.appendChild(this.configOverlay);
        },

        /**
         * Show the configuration panel.
         */
        showConfig: function() {
            document.getElementById('lisesca-config-min').value = CONFIG.MIN_PAGE_TIME.toString();
            document.getElementById('lisesca-config-max').value = CONFIG.MAX_PAGE_TIME.toString();
            document.getElementById('lisesca-config-job-review-min').value = CONFIG.MIN_JOB_REVIEW_TIME.toString();
            document.getElementById('lisesca-config-job-review-max').value = CONFIG.MAX_JOB_REVIEW_TIME.toString();
            document.getElementById('lisesca-config-job-pause-min').value = CONFIG.MIN_JOB_PAUSE.toString();
            document.getElementById('lisesca-config-job-pause-max').value = CONFIG.MAX_JOB_PAUSE.toString();
            document.getElementById('lisesca-config-error').textContent = '';
            this.configOverlay.classList.add('lisesca-visible');
        },

        /**
         * Hide the configuration panel.
         */
        hideConfig: function() {
            this.configOverlay.classList.remove('lisesca-visible');
        },

        /**
         * Validate and save configuration.
         */
        saveConfig: function() {
            var errorDiv = document.getElementById('lisesca-config-error');

            // --- Read all inputs ---
            var minVal = parseInt(document.getElementById('lisesca-config-min').value, 10);
            var maxVal = parseInt(document.getElementById('lisesca-config-max').value, 10);
            var jobReviewMin = parseInt(document.getElementById('lisesca-config-job-review-min').value, 10);
            var jobReviewMax = parseInt(document.getElementById('lisesca-config-job-review-max').value, 10);
            var jobPauseMin = parseInt(document.getElementById('lisesca-config-job-pause-min').value, 10);
            var jobPauseMax = parseInt(document.getElementById('lisesca-config-job-pause-max').value, 10);

            // --- Validate all values ---
            if (isNaN(minVal) || isNaN(maxVal) || isNaN(jobReviewMin)
                || isNaN(jobReviewMax) || isNaN(jobPauseMin) || isNaN(jobPauseMax)) {
                errorDiv.textContent = 'Please enter valid numbers in all fields.';
                return;
            }

            // Page timing validation
            if (minVal < 5 || minVal > 30) {
                errorDiv.textContent = 'Min page time must be between 5 and 30 seconds.';
                return;
            }
            if (maxVal < 15 || maxVal > 120) {
                errorDiv.textContent = 'Max page time must be between 15 and 120 seconds.';
                return;
            }
            if (maxVal <= minVal) {
                errorDiv.textContent = 'Max page time must be greater than minimum.';
                return;
            }

            // Job review timing validation
            if (jobReviewMin < 1 || jobReviewMin > 30) {
                errorDiv.textContent = 'Min job review time must be between 1 and 30 seconds.';
                return;
            }
            if (jobReviewMax < 2 || jobReviewMax > 60) {
                errorDiv.textContent = 'Max job review time must be between 2 and 60 seconds.';
                return;
            }
            if (jobReviewMax <= jobReviewMin) {
                errorDiv.textContent = 'Max job review time must be greater than minimum.';
                return;
            }

            // Job pause validation
            if (jobPauseMin < 0 || jobPauseMin > 15) {
                errorDiv.textContent = 'Min job pause must be between 0 and 15 seconds.';
                return;
            }
            if (jobPauseMax < 1 || jobPauseMax > 30) {
                errorDiv.textContent = 'Max job pause must be between 1 and 30 seconds.';
                return;
            }
            if (jobPauseMax <= jobPauseMin) {
                errorDiv.textContent = 'Max job pause must be greater than minimum.';
                return;
            }

            // --- Apply all values ---
            CONFIG.MIN_PAGE_TIME = minVal;
            CONFIG.MAX_PAGE_TIME = maxVal;
            CONFIG.MIN_JOB_REVIEW_TIME = jobReviewMin;
            CONFIG.MAX_JOB_REVIEW_TIME = jobReviewMax;
            CONFIG.MIN_JOB_PAUSE = jobPauseMin;
            CONFIG.MAX_JOB_PAUSE = jobPauseMax;
            CONFIG.save();

            console.log('[LiSeSca] Config updated:', {
                pageTime: minVal + '-' + maxVal + 's',
                jobReview: jobReviewMin + '-' + jobReviewMax + 's',
                jobPause: jobPauseMin + '-' + jobPauseMax + 's'
            });
            this.hideConfig();
        },

        // --- AI Configuration panel methods ---

        /**
         * Create the AI configuration panel overlay.
         */
        createAIConfigPanel: function() {
            this.aiConfigOverlay = document.createElement('div');
            this.aiConfigOverlay.className = 'lisesca-ai-config-overlay';

            var panel = document.createElement('div');
            panel.className = 'lisesca-ai-config-panel';

            var title = document.createElement('div');
            title.className = 'lisesca-ai-config-title';
            title.textContent = 'AI Filtering Configuration';

            // API Key row
            var apiKeyRow = document.createElement('div');
            apiKeyRow.className = 'lisesca-ai-config-row';

            var apiKeyLabel = document.createElement('label');
            apiKeyLabel.textContent = 'Anthropic API Key:';
            apiKeyLabel.htmlFor = 'lisesca-ai-api-key';

            var apiKeyInput = document.createElement('input');
            apiKeyInput.type = 'password';
            apiKeyInput.id = 'lisesca-ai-api-key';
            apiKeyInput.placeholder = 'sk-ant-...';
            apiKeyInput.value = CONFIG.ANTHROPIC_API_KEY || '';

            var apiKeyHint = document.createElement('div');
            apiKeyHint.className = 'lisesca-hint';
            apiKeyHint.textContent = 'Get your API key from console.anthropic.com';

            apiKeyRow.appendChild(apiKeyLabel);
            apiKeyRow.appendChild(apiKeyInput);
            apiKeyRow.appendChild(apiKeyHint);

            // Job Criteria row
            var criteriaRow = document.createElement('div');
            criteriaRow.className = 'lisesca-ai-config-row';

            var criteriaLabel = document.createElement('label');
            criteriaLabel.textContent = 'Job Search Criteria:';
            criteriaLabel.htmlFor = 'lisesca-ai-criteria';

            var criteriaTextarea = document.createElement('textarea');
            criteriaTextarea.id = 'lisesca-ai-criteria';
            criteriaTextarea.rows = 10;
            criteriaTextarea.placeholder = 'Describe the job you are looking for...\n\nExample:\nI am looking for Senior Software Engineering Manager roles.\nI have 15 years of experience in software development.\nI prefer remote or hybrid positions.\nI am NOT interested in:\n- Manufacturing or industrial positions\n- Roles requiring specific domain expertise I don\'t have';
            criteriaTextarea.value = CONFIG.JOB_CRITERIA || '';

            var criteriaHint = document.createElement('div');
            criteriaHint.className = 'lisesca-hint';
            criteriaHint.textContent = 'Describe your ideal job. Be specific about what you want and don\'t want.';

            criteriaRow.appendChild(criteriaLabel);
            criteriaRow.appendChild(criteriaTextarea);
            criteriaRow.appendChild(criteriaHint);

            // People Criteria row
            var peopleCriteriaRow = document.createElement('div');
            peopleCriteriaRow.className = 'lisesca-ai-config-row';

            var peopleCriteriaLabel = document.createElement('label');
            peopleCriteriaLabel.textContent = 'People Search Criteria:';
            peopleCriteriaLabel.htmlFor = 'lisesca-ai-people-criteria';

            var peopleCriteriaTextarea = document.createElement('textarea');
            peopleCriteriaTextarea.id = 'lisesca-ai-people-criteria';
            peopleCriteriaTextarea.rows = 10;
            peopleCriteriaTextarea.placeholder = 'Describe the kind of people you want to connect with...\n\nExample:\nI am looking for senior engineers and engineering managers in Berlin.\nI want people who work in B2B SaaS or AI startups.\nI am NOT interested in:\n- Sales or HR roles\n- People outside the DACH region';
            peopleCriteriaTextarea.value = CONFIG.PEOPLE_CRITERIA || '';

            var peopleCriteriaHint = document.createElement('div');
            peopleCriteriaHint.className = 'lisesca-hint';
            peopleCriteriaHint.textContent = 'Describe your target contacts (roles, industries, locations, etc.).';

            peopleCriteriaRow.appendChild(peopleCriteriaLabel);
            peopleCriteriaRow.appendChild(peopleCriteriaTextarea);
            peopleCriteriaRow.appendChild(peopleCriteriaHint);

            // Error display
            var errorDiv = document.createElement('div');
            errorDiv.className = 'lisesca-ai-config-error';
            errorDiv.id = 'lisesca-ai-config-error';

            // Buttons
            var buttonsRow = document.createElement('div');
            buttonsRow.className = 'lisesca-ai-config-buttons';

            var saveBtn = document.createElement('button');
            saveBtn.className = 'lisesca-ai-config-save';
            saveBtn.textContent = 'Save';
            saveBtn.addEventListener('click', function() {
                UI.saveAIConfig();
            });

            var cancelBtn = document.createElement('button');
            cancelBtn.className = 'lisesca-ai-config-cancel';
            cancelBtn.textContent = 'Cancel';
            cancelBtn.addEventListener('click', function() {
                UI.hideAIConfig();
            });

            buttonsRow.appendChild(saveBtn);
            buttonsRow.appendChild(cancelBtn);

            // Assemble panel
            panel.appendChild(title);
            panel.appendChild(apiKeyRow);
            panel.appendChild(criteriaRow);
            panel.appendChild(peopleCriteriaRow);
            panel.appendChild(errorDiv);
            panel.appendChild(buttonsRow);

            this.aiConfigOverlay.appendChild(panel);

            // Close on overlay click
            this.aiConfigOverlay.addEventListener('click', function(event) {
                if (event.target === UI.aiConfigOverlay) {
                    UI.hideAIConfig();
                }
            });

            document.body.appendChild(this.aiConfigOverlay);
        },

        /**
         * Show the AI configuration panel.
         */
        showAIConfig: function() {
            document.getElementById('lisesca-ai-api-key').value = CONFIG.ANTHROPIC_API_KEY || '';
            document.getElementById('lisesca-ai-criteria').value = CONFIG.JOB_CRITERIA || '';
            document.getElementById('lisesca-ai-people-criteria').value = CONFIG.PEOPLE_CRITERIA || '';
            document.getElementById('lisesca-ai-config-error').textContent = '';
            this.aiConfigOverlay.classList.add('lisesca-visible');
        },

        /**
         * Hide the AI configuration panel.
         */
        hideAIConfig: function() {
            this.aiConfigOverlay.classList.remove('lisesca-visible');
        },

        /**
         * Validate and save AI configuration.
         */
        saveAIConfig: function() {
            var errorDiv = document.getElementById('lisesca-ai-config-error');
            var apiKey = document.getElementById('lisesca-ai-api-key').value.trim();
            var criteria = document.getElementById('lisesca-ai-criteria').value.trim();
            var peopleCriteria = document.getElementById('lisesca-ai-people-criteria').value.trim();

            // API key is required if any criteria is set
            if (!apiKey && (criteria || peopleCriteria)) {
                errorDiv.textContent = 'Please enter your API key to enable AI filtering.';
                return;
            }

            // Basic API key format validation
            if (apiKey && !apiKey.startsWith('sk-ant-')) {
                errorDiv.textContent = 'API key should start with "sk-ant-"';
                return;
            }

            // Save to CONFIG
            CONFIG.ANTHROPIC_API_KEY = apiKey;
            CONFIG.JOB_CRITERIA = criteria;
            CONFIG.PEOPLE_CRITERIA = peopleCriteria;
            CONFIG.saveAIConfig();

            // Update the AI toggle state in the menu if it exists
            this.updateAIToggleState();
            this.updatePeopleAIToggleState();

            console.log('[LiSeSca] AI config saved. Job configured: '
                + CONFIG.isAIConfigured() + ', People configured: ' + CONFIG.isPeopleAIConfigured());
            this.hideAIConfig();
        },

        /**
         * Update the AI toggle checkbox state based on configuration.
         * Disables the checkbox if AI is not configured.
         * Also updates the Full AI toggle visibility and state.
         */
        updateAIToggleState: function() {
            var aiCheck = document.getElementById('lisesca-ai-enabled');
            var aiLabel = aiCheck ? aiCheck.closest('.lisesca-checkbox-label') : null;
            var fullAIRow = document.getElementById('lisesca-full-ai-row');
            var fullAICheck = document.getElementById('lisesca-full-ai-enabled');

            if (!aiCheck || !aiLabel) {
                return;
            }

            var isConfigured = CONFIG.isAIConfigured();
            aiCheck.disabled = !isConfigured;

            if (isConfigured) {
                aiLabel.classList.remove('lisesca-disabled');
            } else {
                aiLabel.classList.add('lisesca-disabled');
                aiCheck.checked = false;
                State.saveAIEnabled(false);
            }

            // Update Full AI toggle state
            if (fullAIRow && fullAICheck) {
                if (isConfigured && aiCheck.checked) {
                    fullAIRow.style.display = 'flex';
                    fullAICheck.disabled = false;
                } else {
                    fullAIRow.style.display = 'none';
                    fullAICheck.checked = false;
                    fullAICheck.disabled = true;
                    State.saveFullAIEnabled(false);
                }
            }
        },

        /**
         * Update the People AI toggle checkbox state based on configuration.
         * Disables the checkbox if AI is not configured.
         * Also updates the Full AI toggle visibility and state.
         */
        updatePeopleAIToggleState: function() {
            var aiCheck = document.getElementById('lisesca-people-ai-enabled');
            var aiLabel = aiCheck ? aiCheck.closest('.lisesca-checkbox-label') : null;
            var fullAIRow = document.getElementById('lisesca-people-full-ai-row');
            var fullAICheck = document.getElementById('lisesca-people-full-ai-enabled');

            if (!aiCheck || !aiLabel) {
                return;
            }

            var isConfigured = CONFIG.isPeopleAIConfigured();
            aiCheck.disabled = !isConfigured;

            if (isConfigured) {
                aiLabel.classList.remove('lisesca-disabled');
            } else {
                aiLabel.classList.add('lisesca-disabled');
                aiCheck.checked = false;
                State.savePeopleAIEnabled(false);
            }

            if (fullAIRow && fullAICheck) {
                if (isConfigured && aiCheck.checked) {
                    fullAIRow.style.display = 'flex';
                    fullAICheck.disabled = false;
                } else {
                    fullAIRow.style.display = 'none';
                    fullAICheck.checked = false;
                    fullAICheck.disabled = true;
                    State.savePeopleFullAIEnabled(false);
                }
            }
        },

        // --- SPA Navigation Support ---

        /**
         * Check if the main panel currently exists in the DOM.
         * @returns {boolean}
         */
        isPanelActive: function() {
            return this.panel !== null && document.body.contains(this.panel);
        },

        /**
         * Remove the main floating panel from the DOM.
         */
        removePanel: function() {
            if (this.panel && this.panel.parentNode) {
                this.panel.parentNode.removeChild(this.panel);
                console.log('[LiSeSca] UI panel removed.');
            }
            this.panel = null;
            this.menu = null;
            this.statusArea = null;
            this.noResultsArea = null;
            this.isMenuOpen = false;
        },

        /**
         * Remove the configuration overlay from the DOM.
         */
        removeConfigPanel: function() {
            if (this.configOverlay && this.configOverlay.parentNode) {
                this.configOverlay.parentNode.removeChild(this.configOverlay);
                console.log('[LiSeSca] Config panel removed.');
            }
            this.configOverlay = null;
        },

        /**
         * Remove the AI configuration overlay from the DOM.
         */
        removeAIConfigPanel: function() {
            if (this.aiConfigOverlay && this.aiConfigOverlay.parentNode) {
                this.aiConfigOverlay.parentNode.removeChild(this.aiConfigOverlay);
                console.log('[LiSeSca] AI config panel removed.');
            }
            this.aiConfigOverlay = null;
        },

        /**
         * Remove existing panels and create fresh ones for the current page type.
         * Used when SPA navigation changes the page type.
         */
        rebuildPanel: function() {
            this.removePanel();
            this.removeConfigPanel();
            this.removeAIConfigPanel();
            this.createPanel();
            this.createConfigPanel();
            this.createAIConfigPanel();
            console.log('[LiSeSca] UI panels rebuilt for new page.');
        }
    };

    // ===== HUMAN EMULATION =====
    // Simulates human browsing behavior (scrolling, mouse movement, pauses)
    // to avoid triggering LinkedIn's bot detection.

    const Emulator = {
        /** Flag to allow cancellation of the emulation sequence */
        cancelled: false,

        /**
         * Generate a random integer between min and max (inclusive).
         * @param {number} min - Minimum value.
         * @param {number} max - Maximum value.
         * @returns {number} Random integer in [min, max].
         */
        getRandomInt: function(min, max) {
            return Math.floor(Math.random() * (max - min + 1)) + min;
        },

        /**
         * Return a Promise that resolves after a random delay.
         * @param {number} minMs - Minimum milliseconds.
         * @param {number} maxMs - Maximum milliseconds.
         * @returns {Promise<void>}
         */
        randomDelay: function(minMs, maxMs) {
            const delay = this.getRandomInt(minMs, maxMs);
            return new Promise(function(resolve) {
                setTimeout(resolve, delay);
            });
        },

        /**
         * Dispatch a synthetic mousemove event at randomized coordinates.
         * @param {number} approximateY - Approximate vertical position to center the movement around.
         */
        dispatchMouseMove: function(approximateY) {
            const eventInit = {
                bubbles: true,
                cancelable: true,
                clientX: this.getRandomInt(200, 800),
                clientY: approximateY + this.getRandomInt(-30, 30),
                screenX: this.getRandomInt(200, 800),
                screenY: approximateY + this.getRandomInt(-30, 30)
            };
            const event = new MouseEvent('mousemove', eventInit);

            document.dispatchEvent(event);

            if (document.body) {
                document.body.dispatchEvent(new MouseEvent('mousemove', eventInit));
            }
            const mainEl = document.querySelector('main') || document.querySelector('[role="main"]');
            if (mainEl) {
                mainEl.dispatchEvent(new MouseEvent('mousemove', eventInit));
            }
        },

        /**
         * Dispatch a synthetic scroll event on all relevant scroll containers.
         */
        dispatchScrollEvent: function() {
            window.dispatchEvent(new Event('scroll', { bubbles: true }));
            document.dispatchEvent(new Event('scroll', { bubbles: true }));

            const scrollTargets = [
                document.querySelector('main'),
                document.querySelector('[role="main"]'),
                document.querySelector('[role="list"]')
            ];
            scrollTargets.forEach(function(target) {
                if (target) {
                    target.dispatchEvent(new Event('scroll', { bubbles: true }));
                }
            });
        },

        /**
         * Run the full human emulation sequence for page scanning.
         * @param {string} statusPrefix - Text to show before the countdown.
         * @returns {Promise<void>} Resolves when emulation is complete.
         */
        emulateHumanScan: function(statusPrefix) {
            this.cancelled = false;
            const self = this;

            const totalTimeMs = this.getRandomInt(
                CONFIG.MIN_PAGE_TIME * 1000,
                CONFIG.MAX_PAGE_TIME * 1000
            );
            const totalTimeSec = Math.round(totalTimeMs / 1000);

            const pageHeight = document.documentElement.scrollHeight;
            const viewportHeight = window.innerHeight;
            const scrollableDistance = Math.max(pageHeight - viewportHeight, 0);

            const averageStepMs = 450;
            const numberOfSteps = Math.max(Math.floor(totalTimeMs / averageStepMs), 10);
            const baseScrollPerStep = scrollableDistance / numberOfSteps;

            const numberOfPauses = self.getRandomInt(2, 3);
            const pauseSteps = new Set();
            while (pauseSteps.size < numberOfPauses) {
                pauseSteps.add(self.getRandomInt(2, numberOfSteps - 2));
            }

            console.log('[LiSeSca] Emulation: ' + numberOfSteps + ' steps over ~'
                + totalTimeSec + 's, '
                + numberOfPauses + ' reading pauses.');

            const startTimeMs = Date.now();
            const prefix = statusPrefix || 'Scanning';
            UI.showStatus(prefix + ' — ' + totalTimeSec + 's remaining');

            let currentScroll = 0;

            /**
             * Execute one scroll step, then schedule the next.
             * @param {number} step - Current step index (0-based).
             * @returns {Promise<void>}
             */
            function executeStep(step) {
                if (self.cancelled) {
                    console.log('[LiSeSca] Emulation cancelled.');
                    return Promise.resolve();
                }
                if (step >= numberOfSteps) {
                    window.scrollTo({ top: scrollableDistance, behavior: 'smooth' });
                    self.dispatchScrollEvent();
                    return Promise.resolve();
                }

                const elapsedMs = Date.now() - startTimeMs;
                const remainingSec = Math.max(0, Math.round((totalTimeMs - elapsedMs) / 1000));
                UI.showStatus(prefix + ' — ' + remainingSec + 's remaining');

                const scrollAmount = baseScrollPerStep * (0.6 + Math.random() * 0.8);
                currentScroll = Math.min(currentScroll + scrollAmount, scrollableDistance);
                window.scrollTo({ top: currentScroll, behavior: 'smooth' });

                self.dispatchScrollEvent();

                const mouseY = self.getRandomInt(100, viewportHeight - 100);
                self.dispatchMouseMove(mouseY);

                let delayMin = 200;
                let delayMax = 600;

                if (pauseSteps.has(step)) {
                    delayMin = 1000;
                    delayMax = 3000;
                }

                return self.randomDelay(delayMin, delayMax).then(function() {
                    return executeStep(step + 1);
                });
            }

            return executeStep(0).then(function() {
                console.log('[LiSeSca] Emulation complete.');
            });
        },

        /**
         * Cancel the ongoing emulation sequence.
         */
        cancel: function() {
            this.cancelled = true;
        }
    };

    // ===== CSS SELECTORS (PEOPLE SEARCH) =====
    // Resilient selectors based on data attributes and ARIA roles,
    // avoiding LinkedIn's generated CSS class names which change frequently.
    const Selectors = {
        RESULT_CARD: 'div[role="listitem"]',
        TITLE_LINK: 'a[data-view-name="search-result-lockup-title"]'
    };

    // ===== DATA EXTRACTION (PEOPLE) =====
    // Reads the current page's DOM and returns an array of profile objects.
    // Each profile is represented as:
    //   { fullName, connectionDegree, description, location, profileUrl }

    const Extractor = {

        /**
         * Wait for search result cards to appear in the DOM.
         * LinkedIn is an SPA and may load results asynchronously,
         * so we poll for up to 10 seconds before giving up.
         * @returns {Promise<NodeList>} The list of result card elements.
         */
        waitForResults: function() {
            return new Promise(function(resolve, reject) {
                const maxWaitMs = 10000;
                const pollIntervalMs = 500;
                let elapsed = 0;

                const poll = setInterval(function() {
                    const cards = document.querySelectorAll(Selectors.RESULT_CARD);
                    if (cards.length > 0) {
                        clearInterval(poll);
                        console.log('[LiSeSca] Found ' + cards.length + ' result cards.');
                        resolve(cards);
                        return;
                    }
                    elapsed += pollIntervalMs;
                    if (elapsed >= maxWaitMs) {
                        clearInterval(poll);
                        console.warn('[LiSeSca] No result cards found after ' + maxWaitMs + 'ms.');
                        reject(new Error('No search result cards found on this page.'));
                    }
                }, pollIntervalMs);
            });
        },

        /**
         * Extract profile data from all result cards on the current page.
         * Skips cards that fail to parse (logs a warning for each).
         * @returns {Promise<Array>} Array of profile data objects.
         */
        extractCurrentPage: function() {
            return this.waitForResults().then(function(cards) {
                const profiles = [];
                cards.forEach(function(card, index) {
                    try {
                        const profile = Extractor.extractCard(card);
                        if (profile) {
                            profiles.push(profile);
                        }
                    } catch (error) {
                        console.warn('[LiSeSca] Failed to extract card #' + index + ':', error);
                    }
                });
                console.log('[LiSeSca] Extracted ' + profiles.length + ' profiles from this page.');
                return profiles;
            });
        },

        /**
         * Extract profile data from a single result card element.
         * @param {HTMLElement} card - The listitem div element.
         * @returns {Object|null} Profile data object, or null if no title link found.
         */
        extractCard: function(card) {
            const titleLink = card.querySelector(Selectors.TITLE_LINK);
            if (!titleLink) {
                console.warn('[LiSeSca] Card has no title link, skipping.');
                return null;
            }

            const fullName = this.extractName(titleLink);
            const profileUrl = this.extractProfileUrl(titleLink);
            const connectionDegree = this.extractDegree(titleLink);
            const description = this.extractDescription(titleLink);
            const location = this.extractLocation(titleLink);

            return {
                fullName: fullName,
                connectionDegree: connectionDegree,
                description: description,
                location: location,
                profileUrl: profileUrl
            };
        },

        /**
         * Format a people card as Markdown for AI evaluation.
         * @param {Object} profile - The card data from extractCard.
         * @returns {string} Markdown-formatted card summary.
         */
        formatCardForAI: function(profile) {
            var lines = [];
            lines.push('## ' + (profile.fullName || 'Unknown Name'));

            if (profile.description) {
                lines.push('**Headline:** ' + profile.description);
            }
            if (profile.location) {
                lines.push('**Location:** ' + profile.location);
            }
            if (profile.connectionDegree) {
                lines.push('**Connection degree:** ' + profile.connectionDegree);
            }
            if (profile.profileUrl) {
                lines.push('**Profile:** ' + profile.profileUrl);
            }

            return lines.join('\n');
        },

        /**
         * Extract the person's full name from the title link.
         * @param {HTMLElement} titleLink - The <a> element with data-view-name.
         * @returns {string} The full name, trimmed.
         */
        extractName: function(titleLink) {
            return (titleLink.textContent || '').trim();
        },

        /**
         * Extract and clean the profile URL from the title link's href.
         * @param {HTMLElement} titleLink - The <a> element.
         * @returns {string} The cleaned profile URL.
         */
        extractProfileUrl: function(titleLink) {
            const rawUrl = titleLink.href || '';
            return this.cleanProfileUrl(rawUrl);
        },

        /**
         * Remove query parameters and hash fragments from a LinkedIn profile URL.
         * @param {string} rawUrl - The full URL with potential tracking parameters.
         * @returns {string} The clean URL (origin + pathname only).
         */
        cleanProfileUrl: function(rawUrl) {
            if (!rawUrl) {
                return '';
            }
            try {
                const url = new URL(rawUrl);
                return url.origin + url.pathname;
            } catch (error) {
                return rawUrl;
            }
        },

        /**
         * Extract the connection degree from the span sibling of the title link.
         * @param {HTMLElement} titleLink - The <a> element.
         * @returns {number} The connection degree (1, 2, 3, etc.) or 0 if not found.
         */
        extractDegree: function(titleLink) {
            const titleParagraph = titleLink.parentElement;
            if (!titleParagraph) {
                return 0;
            }

            const spans = titleParagraph.querySelectorAll('span span');
            for (let i = 0; i < spans.length; i++) {
                const text = spans[i].textContent || '';
                const match = text.match(/(\d+)(st|nd|rd|th)/);
                if (match) {
                    return parseInt(match[1], 10);
                }
            }
            return 0;
        },

        /**
         * Extract the description (headline) text from the first sibling <div>.
         * @param {HTMLElement} titleLink - The <a> element.
         * @returns {string} The description text, or empty string if not found.
         */
        extractDescription: function(titleLink) {
            const titleParagraph = titleLink.parentElement;
            if (!titleParagraph) {
                return '';
            }

            const descriptionDiv = titleParagraph.nextElementSibling;
            if (!descriptionDiv) {
                return '';
            }

            const descParagraph = descriptionDiv.querySelector('p');
            if (!descParagraph) {
                return '';
            }

            return (descParagraph.textContent || '').trim();
        },

        /**
         * Extract the location text from the second sibling <div>.
         * @param {HTMLElement} titleLink - The <a> element.
         * @returns {string} The location text, or empty string if not found.
         */
        extractLocation: function(titleLink) {
            const titleParagraph = titleLink.parentElement;
            if (!titleParagraph) {
                return '';
            }

            const descriptionDiv = titleParagraph.nextElementSibling;
            if (!descriptionDiv) {
                return '';
            }

            const locationDiv = descriptionDiv.nextElementSibling;
            if (!locationDiv) {
                return '';
            }

            const locParagraph = locationDiv.querySelector('p');
            if (!locParagraph) {
                return '';
            }

            return (locParagraph.textContent || '').trim();
        }
    };

    // ===== CSS SELECTORS (PROFILE PAGE) =====
    // Resilient selectors for LinkedIn profile pages.
    // Uses multiple fallbacks to handle DOM changes and variants.
    const ProfileSelectors = {
        NAME: [
            'main h1',
            'h1.text-heading-xlarge',
            'h1.inline.t-24.v-align-middle.break-words'
        ],
        HEADLINE: [
            'main .text-body-medium.break-words',
            'main .text-body-medium'
        ],
        LOCATION: [
            'main .text-body-small.inline.t-black--light.break-words',
            'main span.text-body-small'
        ],
        // About section - may or may not have id="about"
        ABOUT_SECTION: [
            'section#about',
            'section[id*="about"]',
            'div[data-generated-suggestion-target*="profileActionDelegate"]'
        ],
        // About text is inside inline-show-more-text div, within a span[aria-hidden="true"]
        ABOUT_TEXT: [
            '.inline-show-more-text--is-collapsed span[aria-hidden="true"]',
            '[class*="inline-show-more-text"] span[aria-hidden="true"]',
            '.inline-show-more-text span[aria-hidden="true"]',
            '.pv-about__summary-text'
        ],
        EXPERIENCE_SECTION: [
            'section#experience',
            'section[id*="experience"]',
            'section[data-section="experience"]'
        ],
        SHOW_MORE_BUTTON: [
            'button[aria-expanded="false"]',
            'button[aria-label*="more"]',
            'button[aria-label="See more"]',
            'button[aria-label="Show more"]'
        ]
    };

    // ===== TURNDOWN SERVICE =====
    // Shared HTML-to-Markdown converter instance for job descriptions.
    // Turndown is loaded via @require from CDN.
    //
    // IMPORTANT: LinkedIn enforces Trusted Types, a browser security policy
    // that blocks direct innerHTML assignment. Turndown internally uses
    // innerHTML when given an HTML string, which triggers a Trusted Types
    // violation and crashes with "Cannot read properties of null ('firstChild')".
    //
    // To work around this, we use two strategies:
    // 1. Pass live DOM nodes to Turndown (preferred — no innerHTML needed)
    // 2. For HTML strings, use DOMParser to create a separate Document context
    //    that is NOT subject to the page's Trusted Types policy, then pass
    //    the parsed DOM node to Turndown.
    var turndownService = null;

    /**
     * Get or create the shared TurndownService instance.
     * Lazy initialization in case Turndown is loaded after our IIFE runs.
     * @returns {TurndownService|null} The Turndown instance, or null if not available.
     */
    function getTurndownService() {
        if (turndownService) {
            return turndownService;
        }
        if (typeof TurndownService !== 'undefined') {
            turndownService = new TurndownService({
                headingStyle: 'atx',
                bulletListMarker: '-'
            });
            return turndownService;
        }
        console.warn('[LiSeSca] TurndownService not available.');
        return null;
    }

    /**
     * Safely convert HTML to Markdown, bypassing LinkedIn's Trusted Types policy.
     * Accepts either a DOM node or an HTML string.
     *
     * When given a DOM node: passes it directly to Turndown (no innerHTML involved).
     * When given a string: uses DOMParser to build a DOM tree in a separate document
     * context that is not subject to the page's Trusted Types restrictions, then
     * passes the resulting node to Turndown.
     *
     * @param {HTMLElement|string} input - A live DOM element or an HTML string.
     * @returns {string} The Markdown text, or plain text fallback, or empty string.
     */
    function htmlToMarkdown(input) {
        if (!input) {
            return '';
        }

        var td = getTurndownService();
        if (!td) {
            // Fallback: extract plain text if Turndown is not available
            if (typeof input === 'string') {
                var tempParser = new DOMParser();
                var tempDoc = tempParser.parseFromString(input, 'text/html');
                return (tempDoc.body.textContent || '').trim();
            }
            return (input.textContent || '').trim();
        }

        // If input is already a DOM node, pass it directly to Turndown
        if (typeof input !== 'string') {
            return td.turndown(input);
        }

        // For HTML strings, parse via DOMParser to avoid Trusted Types violations.
        // DOMParser creates an entirely separate Document that does not inherit
        // the page's Content Security Policy or Trusted Types restrictions.
        var parser = new DOMParser();
        var doc = parser.parseFromString(input, 'text/html');
        return td.turndown(doc.body);
    }

    // ===== PROFILE EXTRACTION (PEOPLE) =====
    // Extracts full profile data from a LinkedIn profile page.

    const ProfileExtractor = {

        /**
         * Check if the current page looks like a LinkedIn profile page.
         * @returns {boolean}
         */
        isOnProfilePage: function() {
            var href = window.location.href;
            return href.indexOf('linkedin.com/in/') !== -1 || href.indexOf('linkedin.com/pub/') !== -1;
        },

        /**
         * Wait for the profile page to load key content.
         * @returns {Promise<void>}
         */
        waitForProfileLoad: function() {
            var self = this;
            return new Promise(function(resolve, reject) {
                var maxWaitMs = 12000;
                var pollIntervalMs = 400;
                var elapsed = 0;

                var poll = setInterval(function() {
                    var nameEl = self.getFirstMatch(ProfileSelectors.NAME, document);
                    var expSection = self.getFirstMatch(ProfileSelectors.EXPERIENCE_SECTION, document);
                    if (nameEl || expSection) {
                        clearInterval(poll);
                        resolve();
                        return;
                    }
                    elapsed += pollIntervalMs;
                    if (elapsed >= maxWaitMs) {
                        clearInterval(poll);
                        reject(new Error('Profile content did not load in time.'));
                    }
                }, pollIntervalMs);
            });
        },

        /**
         * Determine if this profile is restricted/private.
         * @returns {boolean}
         */
        isRestrictedProfile: function() {
            var name = this.extractName();
            if (name && name.toLowerCase() === 'linkedin member') {
                return true;
            }

            var bodyText = document.body ? (document.body.textContent || '') : '';
            var restrictedPhrases = [
                'This profile is not available',
                'Profile is private',
                'LinkedIn Member',
                'You do not have access'
            ];

            for (var i = 0; i < restrictedPhrases.length; i++) {
                if (bodyText.indexOf(restrictedPhrases[i]) !== -1) {
                    return true;
                }
            }

            return false;
        },

        /**
         * Click all "Show more" / "See more" buttons to expand collapsed text.
         */
        clickShowMore: function() {
            var buttons = this.getAllMatches(ProfileSelectors.SHOW_MORE_BUTTON, document);
            buttons.forEach(function(btn) {
                try {
                    btn.click();
                } catch (error) {
                    // Ignore individual failures
                }
            });
        },

        /**
         * Extract the full profile data object.
         * @returns {Object} Profile data.
         */
        extractFullProfile: function() {
            var fullName = this.extractName();
            var headline = this.extractHeadline();
            var profileAbout = this.extractAbout();
            var location = this.extractLocation();
            var profileUrl = this.extractProfileUrl();

            var roles = this.extractExperienceEntries();
            var currentRole = roles.length > 0 ? roles[0] : null;
            var pastRoles = roles.length > 1 ? roles.slice(1, 4) : [];

            return {
                fullName: fullName,
                headline: headline,
                profileAbout: profileAbout,
                location: location,
                profileUrl: profileUrl,
                currentRole: currentRole,
                pastRoles: pastRoles
            };
        },

        /**
         * Format a full profile for AI evaluation.
         * @param {Object} profile - Full profile data.
         * @returns {string} Markdown summary for AI.
         */
        formatProfileForAI: function(profile) {
            var lines = [];
            lines.push('## ' + (profile.fullName || 'Unknown Name'));

            if (profile.headline) {
                lines.push('**Headline:** ' + profile.headline);
            }
            if (profile.location) {
                lines.push('**Location:** ' + profile.location);
            }
            if (profile.connectionDegree) {
                lines.push('**Connection degree:** ' + profile.connectionDegree);
            }
            if (profile.profileUrl) {
                lines.push('**Profile:** ' + profile.profileUrl);
            }

            if (profile.profileAbout) {
                lines.push('');
                lines.push('**About:**');
                lines.push(profile.profileAbout);
            }

            if (profile.currentRole) {
                lines.push('');
                lines.push('**Current Role:** ' + this.formatRoleLine(profile.currentRole));
            }

            if (profile.pastRoles && profile.pastRoles.length > 0) {
                lines.push('');
                lines.push('**Past Roles:**');
                profile.pastRoles.forEach(function(role) {
                    lines.push('- ' + ProfileExtractor.formatRoleLine(role));
                });
            }

            return lines.join('\n');
        },

        /**
         * Extract the profile name.
         * @returns {string}
         */
        extractName: function() {
            return this.extractText(ProfileSelectors.NAME, document);
        },

        /**
         * Extract the headline text.
         * @returns {string}
         */
        extractHeadline: function() {
            return this.extractText(ProfileSelectors.HEADLINE, document);
        },

        /**
         * Extract the location text.
         * @returns {string}
         */
        extractLocation: function() {
            return this.extractText(ProfileSelectors.LOCATION, document);
        },

        /**
         * Extract the "About" section text.
         * @returns {string}
         */
        extractAbout: function() {
            // Try to find the About section first
            var section = this.getFirstMatch(ProfileSelectors.ABOUT_SECTION, document);

            // If we have an about section, look for the text within it
            if (section) {
                var aboutEl = this.getFirstMatch(ProfileSelectors.ABOUT_TEXT, section);
                if (aboutEl) {
                    return (aboutEl.textContent || '').trim();
                }
            }

            // Fallback: search the entire page for About-style text containers
            var aboutTextEl = this.getFirstMatch(ProfileSelectors.ABOUT_TEXT, document);
            if (aboutTextEl) {
                // Make sure it's not inside Experience section
                var expSection = this.getFirstMatch(ProfileSelectors.EXPERIENCE_SECTION, document);
                if (expSection && expSection.contains(aboutTextEl)) {
                    return '';
                }
                return (aboutTextEl.textContent || '').trim();
            }

            return '';
        },

        /**
         * Extract the profile URL without query params.
         * @returns {string}
         */
        extractProfileUrl: function() {
            var href = window.location.href;
            try {
                var url = new URL(href);
                return url.origin + url.pathname;
            } catch (error) {
                return href;
            }
        },

        /**
         * Extract experience entries (current + past roles).
         * LinkedIn has two structures:
         * 1. Simple: one role per entry (role title, company, dates, location)
         * 2. Grouped: company header with nested sub-roles
         * @returns {Array<Object>} Roles in descending order (most recent first).
         */
        extractExperienceEntries: function() {
            var section = this.getFirstMatch(ProfileSelectors.EXPERIENCE_SECTION, document);
            if (!section) {
                console.log('[LiSeSca] No experience section found.');
                return [];
            }

            var roles = [];

            // Get top-level experience items (either companies or single roles)
            var topItems = section.querySelectorAll('li.artdeco-list__item');

            for (var i = 0; i < topItems.length; i++) {
                var item = topItems[i];

                // Check if this is a grouped entry (has sub-roles)
                var subRolesContainer = item.querySelector('.pvs-entity__sub-components ul');

                if (subRolesContainer) {
                    // Grouped entry: extract company name from header, then each sub-role
                    var companyName = this.extractCompanyFromHeader(item);
                    var subItems = subRolesContainer.querySelectorAll(':scope > li');

                    for (var j = 0; j < subItems.length; j++) {
                        var role = this.extractRoleFromSubEntry(subItems[j], companyName);
                        if (role && role.title) {
                            roles.push(role);
                        }
                    }
                } else {
                    // Simple entry: single role
                    var role = this.extractSimpleRole(item);
                    if (role && role.title) {
                        roles.push(role);
                    }
                }

                // Limit to first 4 entries for efficiency (current + 3 past)
                if (roles.length >= 4) {
                    break;
                }
            }

            console.log('[LiSeSca] Extracted ' + roles.length + ' experience entries.');
            return roles;
        },

        /**
         * Extract company name from a grouped experience header.
         * @param {HTMLElement} item - The top-level experience item.
         * @returns {string} Company name.
         */
        extractCompanyFromHeader: function(item) {
            // The company name is in the header's bold text
            var boldSpan = item.querySelector('.mr1.hoverable-link-text.t-bold span[aria-hidden="true"]');
            if (boldSpan) {
                return (boldSpan.textContent || '').trim();
            }
            // Fallback to any t-bold span
            boldSpan = item.querySelector('.t-bold span[aria-hidden="true"]');
            return boldSpan ? (boldSpan.textContent || '').trim() : '';
        },

        /**
         * Extract a role from a sub-entry within a grouped company.
         * @param {HTMLElement} subEntry - The nested role list item.
         * @param {string} companyName - The company name from parent.
         * @returns {Object|null} Role data.
         */
        extractRoleFromSubEntry: function(subEntry, companyName) {
            if (!subEntry) {
                return null;
            }

            // Title is in bold span
            var titleEl = subEntry.querySelector('.mr1.hoverable-link-text.t-bold span[aria-hidden="true"]');
            if (!titleEl) {
                titleEl = subEntry.querySelector('.t-bold span[aria-hidden="true"]');
            }
            var title = titleEl ? (titleEl.textContent || '').trim() : '';

            // Dates from caption wrapper or t-black--light
            var dates = this.extractDatesFromEntry(subEntry);

            // Location from t-black--light (second occurrence typically)
            var location = this.extractLocationFromEntry(subEntry);

            return {
                title: title,
                company: companyName,
                description: '',
                location: location,
                duration: dates
            };
        },

        /**
         * Extract a simple role (single entry, not grouped).
         * @param {HTMLElement} item - The experience list item.
         * @returns {Object|null} Role data.
         */
        extractSimpleRole: function(item) {
            if (!item) {
                return null;
            }

            // Title is in bold span within the main content area
            var titleEl = item.querySelector('.mr1.hoverable-link-text.t-bold span[aria-hidden="true"]');
            if (!titleEl) {
                titleEl = item.querySelector('.t-bold span[aria-hidden="true"]');
            }
            var title = titleEl ? (titleEl.textContent || '').trim() : '';

            // Company is in t-14 t-normal (not t-black--light)
            var companyEl = item.querySelector('span.t-14.t-normal:not(.t-black--light) span[aria-hidden="true"]');
            var company = companyEl ? (companyEl.textContent || '').trim() : '';

            // Dates
            var dates = this.extractDatesFromEntry(item);

            // Location
            var location = this.extractLocationFromEntry(item);

            return {
                title: title,
                company: company,
                description: '',
                location: location,
                duration: dates
            };
        },

        /**
         * Extract dates/duration from an entry.
         * @param {HTMLElement} entry - The entry element.
         * @returns {string} Duration string.
         */
        extractDatesFromEntry: function(entry) {
            // Try caption wrapper first (e.g., "Dec 2013 - Present · 12 yrs 3 mos")
            var captionEl = entry.querySelector('.pvs-entity__caption-wrapper[aria-hidden="true"]');
            if (captionEl) {
                return (captionEl.textContent || '').trim();
            }

            // Fallback: t-black--light spans, first one is usually dates
            var lightSpans = entry.querySelectorAll('span.t-14.t-normal.t-black--light span[aria-hidden="true"]');
            if (lightSpans.length > 0) {
                return (lightSpans[0].textContent || '').trim();
            }

            return '';
        },

        /**
         * Extract location from an entry.
         * @param {HTMLElement} entry - The entry element.
         * @returns {string} Location string.
         */
        extractLocationFromEntry: function(entry) {
            // Location is usually the second t-black--light span (after dates)
            var lightSpans = entry.querySelectorAll('span.t-14.t-normal.t-black--light span[aria-hidden="true"]');

            // Skip the caption wrapper content, look for standalone location
            for (var i = 0; i < lightSpans.length; i++) {
                var text = (lightSpans[i].textContent || '').trim();
                // If it looks like a location (no dates pattern)
                if (text && !text.match(/\d{4}/) && !text.match(/\d+\s*(yr|mo|year|month)/i)) {
                    return text;
                }
            }

            return '';
        },

        /**
         * Extract a single role entry from an experience list item (legacy fallback).
         * @param {HTMLElement} entry - The experience list item.
         * @returns {Object|null} Role data.
         */
        extractRoleFromEntry: function(entry) {
            return this.extractSimpleRole(entry);
        },

        /**
         * Clean company name string by removing extra qualifiers.
         * @param {string} raw - Raw company text.
         * @returns {string}
         */
        cleanCompanyName: function(raw) {
            if (!raw) {
                return '';
            }
            var parts = raw.split('·');
            return parts[0].trim();
        },

        /**
         * Format a role into a single line summary.
         * @param {Object} role - Role data.
         * @returns {string}
         */
        formatRoleLine: function(role) {
            var parts = [];
            if (role.title) {
                parts.push(role.title);
            }
            if (role.company) {
                parts.push('at ' + role.company);
            }
            var suffix = [];
            if (role.duration) {
                suffix.push(role.duration);
            }
            if (role.location) {
                suffix.push(role.location);
            }
            var line = parts.join(' ');
            if (suffix.length > 0) {
                line += ' (' + suffix.join(', ') + ')';
            }
            if (role.description) {
                line += ' — ' + role.description;
            }
            return line || '(unknown role)';
        },

        /**
         * Extract text content using a selector list.
         * @param {Array<string>} selectors - Selector list.
         * @param {HTMLElement|Document} root - Root to search within.
         * @returns {string}
         */
        extractText: function(selectors, root) {
            var el = this.getFirstMatch(selectors, root);
            return el ? (el.textContent || '').trim() : '';
        },

        /**
         * Get the first element that matches any selector.
         * @param {Array<string>} selectors - Selector list.
         * @param {HTMLElement|Document} root - Root to search within.
         * @returns {HTMLElement|null}
         */
        getFirstMatch: function(selectors, root) {
            if (!selectors || selectors.length === 0) {
                return null;
            }
            var scope = root || document;
            for (var i = 0; i < selectors.length; i++) {
                var el = scope.querySelector(selectors[i]);
                if (el) {
                    return el;
                }
            }
            return null;
        },

        /**
         * Get all matching elements for a selector list.
         * @param {Array<string>} selectors - Selector list.
         * @param {HTMLElement|Document} root - Root to search within.
         * @returns {Array<HTMLElement>}
         */
        getAllMatches: function(selectors, root) {
            var scope = root || document;
            var results = [];
            if (!selectors || selectors.length === 0) {
                return results;
            }
            for (var i = 0; i < selectors.length; i++) {
                var nodes = scope.querySelectorAll(selectors[i]);
                for (var j = 0; j < nodes.length; j++) {
                    if (results.indexOf(nodes[j]) === -1) {
                        results.push(nodes[j]);
                    }
                }
            }
            return results;
        }
    };

    // ===== PAGINATION (PEOPLE) =====
    // Handles navigation between search result pages.
    // LinkedIn uses the "page=" URL parameter for pagination.

    const Paginator = {

        /**
         * Get the current page number from the URL's "page=" parameter.
         * @returns {number} Page number (1 if not specified).
         */
        getCurrentPage: function() {
            const url = new URL(window.location.href);
            const pageParam = url.searchParams.get('page');
            return pageParam ? parseInt(pageParam, 10) : 1;
        },

        /**
         * Get the base search URL (without the "page" parameter).
         * @returns {string} The cleaned base URL.
         */
        getBaseSearchUrl: function() {
            const url = new URL(window.location.href);
            url.searchParams.delete('page');
            return url.toString();
        },

        /**
         * Navigate to a specific page by updating the URL.
         * @param {number} pageNum - The page number to navigate to.
         */
        navigateToPage: function(pageNum) {
            const baseUrl = State.get(State.KEYS.SEARCH_URL, this.getBaseSearchUrl());
            const url = new URL(baseUrl);
            url.searchParams.set('page', pageNum.toString());
            const targetUrl = url.toString();

            console.log('[LiSeSca] Navigating to page ' + pageNum + ': ' + targetUrl);
            window.location.href = targetUrl;
        }
    };

    // ===== OUTPUT GENERATION (PEOPLE) =====
    // Formats scraped profile data into XLSX, CSV, and Markdown.

    const Output = {

        /**
         * Format a single profile into Markdown.
         * @param {Object} profile - A profile data object.
         * @returns {string} The formatted Markdown block.
         */
        formatProfile: function(profile) {
            const lines = [];
            lines.push('# ' + profile.fullName);
            lines.push('');

            if (profile.connectionDegree === 0) {
                lines.push('No connection.');
            } else if (profile.connectionDegree) {
                const ordinal = this.toOrdinal(profile.connectionDegree);
                lines.push('Connection: ' + ordinal);
            }

            var headline = profile.headline || profile.description || '';
            if (headline) {
                lines.push('Headline: ' + headline);
            }
            lines.push('Location: ' + (profile.location || '(none)'));
            lines.push('Full profile URL: ' + (profile.profileUrl || '(none)'));

            if (profile.profileAbout) {
                lines.push('');
                lines.push('## About');
                lines.push('');
                lines.push(profile.profileAbout);
            }

            if (profile.currentRole) {
                lines.push('');
                lines.push('## Current Role');
                lines.push('');
                lines.push(this.formatRoleDetails(profile.currentRole));
            }

            if (profile.pastRoles && profile.pastRoles.length > 0) {
                lines.push('');
                lines.push('## Past Roles');
                lines.push('');
                profile.pastRoles.forEach(function(role, index) {
                    lines.push((index + 1) + '. ' + Output.formatRoleDetails(role));
                });
            }

            return lines.join('\n');
        },

        /**
         * Convert a number to its ordinal string.
         * @param {number} n - The number.
         * @returns {string} The ordinal string.
         */
        toOrdinal: function(n) {
            const suffixes = { 1: 'st', 2: 'nd', 3: 'rd' };
            const lastTwo = n % 100;
            if (lastTwo >= 11 && lastTwo <= 13) {
                return n + 'th';
            }
            const lastDigit = n % 10;
            return n + (suffixes[lastDigit] || 'th');
        },

        /**
         * Generate a complete Markdown document from an array of profiles.
         * @param {Array} profiles - Array of profile data objects.
         * @returns {string} The complete Markdown content.
         */
        generateMarkdown: function(profiles) {
            const blocks = profiles.map(function(profile) {
                return Output.formatProfile(profile);
            });
            return blocks.join('\n\n---\n\n') + '\n';
        },

        COLUMN_HEADERS_BASIC: ['Name', 'Title/Description', 'Location', 'LinkedIn URL', 'Connection degree'],
        COLUMN_HEADERS_DEEP: [
            'Name', 'Headline', 'Location', 'LinkedIn URL', 'Connection degree',
            'About',
            'Current Title', 'Current Company', 'Current Description', 'Current Location', 'Current Duration',
            'Past Role 1', 'Past Role 2', 'Past Role 3'
        ],

        /**
         * Convert a profile object into a row array.
         * @param {Object} profile - A profile data object.
         * @returns {Array<string|number>} Array of cell values.
         */
        profileToRow: function(profile, useDeep) {
            if (!useDeep) {
                return [
                    profile.fullName || '',
                    profile.description || '',
                    profile.location || '',
                    profile.profileUrl || '',
                    profile.connectionDegree || 0
                ];
            }

            var currentRole = profile.currentRole || {};
            var pastRoles = profile.pastRoles || [];

            return [
                profile.fullName || '',
                profile.headline || profile.description || '',
                profile.location || '',
                profile.profileUrl || '',
                profile.connectionDegree || 0,
                profile.profileAbout || '',
                currentRole.title || '',
                currentRole.company || '',
                currentRole.description || '',
                currentRole.location || '',
                currentRole.duration || '',
                this.formatRoleSummary(pastRoles[0]),
                this.formatRoleSummary(pastRoles[1]),
                this.formatRoleSummary(pastRoles[2])
            ];
        },

        /**
         * Check if any profiles include deep data.
         * @param {Array} profiles - Array of profile data objects.
         * @returns {boolean}
         */
        hasDeepData: function(profiles) {
            if (!profiles || profiles.length === 0) {
                return false;
            }
            return profiles.some(function(profile) {
                return !!(profile && (profile.currentRole || (profile.pastRoles && profile.pastRoles.length > 0)));
            });
        },

        /**
         * Format a role into a single-line summary.
         * @param {Object} role - Role data.
         * @returns {string}
         */
        formatRoleSummary: function(role) {
            if (!role) {
                return '';
            }
            var parts = [];
            if (role.title) {
                parts.push(role.title);
            }
            if (role.company) {
                parts.push('@ ' + role.company);
            }
            var suffix = [];
            if (role.duration) {
                suffix.push(role.duration);
            }
            if (role.location) {
                suffix.push(role.location);
            }
            var line = parts.join(' ');
            if (suffix.length > 0) {
                line += ' (' + suffix.join(', ') + ')';
            }
            return line;
        },

        /**
         * Format a role with full details for Markdown.
         * @param {Object} role - Role data.
         * @returns {string}
         */
        formatRoleDetails: function(role) {
            if (!role) {
                return '(no details)';
            }
            var lines = [];
            if (role.title) {
                lines.push('Title: ' + role.title);
            }
            if (role.company) {
                lines.push('Company: ' + role.company);
            }
            if (role.duration) {
                lines.push('Duration: ' + role.duration);
            }
            if (role.location) {
                lines.push('Location: ' + role.location);
            }
            if (role.description) {
                lines.push('Description: ' + role.description);
            }
            return lines.join('\n');
        },

        /**
         * Escape a value for CSV output (RFC 4180).
         * @param {*} value - The cell value to escape.
         * @returns {string} The CSV-safe string.
         */
        escapeCSVField: function(value) {
            var str = String(value);
            return '"' + str.replace(/"/g, '""') + '"';
        },

        /**
         * Generate a CSV string from an array of profiles.
         * @param {Array} profiles - Array of profile data objects.
         * @returns {string} The complete CSV content.
         */
        generateCSV: function(profiles) {
            var self = this;
            var lines = [];

            var useDeep = this.hasDeepData(profiles);
            var headers = useDeep ? this.COLUMN_HEADERS_DEEP : this.COLUMN_HEADERS_BASIC;
            var headerLine = headers.map(function(header) {
                return self.escapeCSVField(header);
            }).join(',');
            lines.push(headerLine);

            profiles.forEach(function(profile) {
                var row = self.profileToRow(profile, useDeep);
                var csvLine = row.map(function(cell) {
                    return self.escapeCSVField(cell);
                }).join(',');
                lines.push(csvLine);
            });

            return lines.join('\r\n') + '\r\n';
        },

        /**
         * Generate an XLSX file as a Uint8Array.
         * @param {Array} profiles - Array of profile data objects.
         * @returns {Uint8Array} The binary XLSX file content.
         */
        generateXLSX: function(profiles) {
            var self = this;
            var useDeep = this.hasDeepData(profiles);
            var headers = useDeep ? this.COLUMN_HEADERS_DEEP : this.COLUMN_HEADERS_BASIC;
            var data = [headers];
            profiles.forEach(function(profile) {
                data.push(self.profileToRow(profile, useDeep));
            });

            var worksheet = XLSX.utils.aoa_to_sheet(data);
            var workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'LinkedIn Search');

            var xlsxData = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
            return new Uint8Array(xlsxData);
        },

        /**
         * Generate a filename based on the current date and time.
         * @param {string} extension - File extension (default: 'md').
         * @returns {string} The generated filename.
         */
        buildFilename: function(extension) {
            var ext = extension || 'md';
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const hours = String(now.getHours()).padStart(2, '0');
            const minutes = String(now.getMinutes()).padStart(2, '0');
            return 'linkedin-search-' + year + '-' + month + '-' + day
                + '-' + hours + 'h' + minutes + '.' + ext;
        },

        /**
         * Trigger a file download in the browser.
         * @param {string|Uint8Array} content - The file content.
         * @param {string} filename - The desired filename.
         * @param {string} mimeType - The MIME type for the Blob.
         */
        downloadFile: function(content, filename, mimeType) {
            var type = mimeType || 'text/markdown;charset=utf-8';
            const blob = new Blob([content], { type: type });
            const url = URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            link.style.display = 'none';

            document.body.appendChild(link);
            link.click();

            setTimeout(function() {
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
            }, 1000);

            console.log('[LiSeSca] File download triggered: ' + filename);
        },

        /**
         * Generate output files in the selected formats and trigger downloads.
         * @param {Array} profiles - Array of profile data objects.
         */
        downloadResults: function(profiles) {
            if (!profiles || profiles.length === 0) {
                console.warn('[LiSeSca] No profiles to download.');
                return;
            }

            var formats = State.getFormats();
            console.log('[LiSeSca] Downloading in formats: ' + formats.join(', '));

            var self = this;
            var delayMs = 0;

            if (formats.indexOf('xlsx') !== -1) {
                setTimeout(function() {
                    var xlsxData = self.generateXLSX(profiles);
                    var xlsxFilename = self.buildFilename('xlsx');
                    self.downloadFile(
                        xlsxData,
                        xlsxFilename,
                        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                    );
                }, delayMs);
                delayMs += 200;
            }

            if (formats.indexOf('csv') !== -1) {
                setTimeout(function() {
                    var csvContent = self.generateCSV(profiles);
                    var csvFilename = self.buildFilename('csv');
                    self.downloadFile(csvContent, csvFilename, 'text/csv;charset=utf-8');
                }, delayMs);
                delayMs += 200;
            }

            if (formats.indexOf('md') !== -1) {
                setTimeout(function() {
                    var markdown = self.generateMarkdown(profiles);
                    var mdFilename = self.buildFilename('md');
                    self.downloadFile(markdown, mdFilename, 'text/markdown;charset=utf-8');
                }, delayMs);
            }
        }
    };

    // ===== JOB DATA EXTRACTION =====
    // Extracts job data from the left-panel cards and right-panel detail view.
    // The flow is: click a card → wait for detail panel → extract all fields.

    const JobExtractor = {
        /**
         * Ensure a job card is rendered and return it along with its shell.
         * @param {string} jobId - The job ID to locate.
         * @returns {Promise<Object>} { card: HTMLElement|null, shell: HTMLElement|null }
         */
        getRenderedCard: function(jobId) {
            var card = document.querySelector('div[data-job-id="' + jobId + '"]');
            if (card) {
                return Promise.resolve({ card: card, shell: null });
            }

            var shell = document.querySelector('li[data-occludable-job-id="' + jobId + '"]');
            if (!shell) {
                return Promise.resolve({ card: null, shell: null });
            }

            shell.scrollIntoView({ behavior: 'smooth', block: 'center' });

            var maxAttempts = 20;  // 20 * 200ms = 4 seconds max wait
            var attempt = 0;

            function waitForRender() {
                attempt++;
                return Emulator.randomDelay(150, 250).then(function() {
                    var rendered = document.querySelector('div[data-job-id="' + jobId + '"]');
                    if (rendered) {
                        return rendered;
                    }
                    if (attempt >= maxAttempts) {
                        console.warn('[LiSeSca] Card ' + jobId + ' did not render after ' + attempt + ' attempts.');
                        return null;
                    }
                    return waitForRender();
                });
            }

            return waitForRender().then(function(renderedCard) {
                return { card: renderedCard, shell: shell };
            });
        },

        /**
         * Check if a job card is marked as "Viewed" or "Applied".
         * @param {string} jobId - The job ID to check.
         * @returns {Promise<boolean>} True if the card shows "Viewed" or "Applied".
         */
        isJobViewed: function(jobId) {
            var self = this;
            return self.getRenderedCard(jobId).then(function(result) {
                if (!result.card) {
                    return false;
                }
                var stateEl = result.card.querySelector(JobSelectors.CARD_FOOTER_JOB_STATE);
                if (!stateEl) {
                    return false;
                }
                var stateText = (stateEl.textContent || '').trim();
                return stateText.match(/viewed|applied/i) ? true : false;
            });
        },

        /**
         * Wait for job cards to appear in the DOM.
         * Polls for up to 10 seconds.
         * @returns {Promise<NodeList>} The list of job card elements.
         */
        waitForJobCards: function() {
            return new Promise(function(resolve, reject) {
                var maxWaitMs = 10000;
                var pollIntervalMs = 500;
                var elapsed = 0;

                var poll = setInterval(function() {
                    var cards = document.querySelectorAll(JobSelectors.JOB_CARD);
                    if (cards.length > 0) {
                        clearInterval(poll);
                        console.log('[LiSeSca] Found ' + cards.length + ' job cards.');
                        resolve(cards);
                        return;
                    }
                    elapsed += pollIntervalMs;
                    if (elapsed >= maxWaitMs) {
                        clearInterval(poll);
                        console.warn('[LiSeSca] No job cards found after ' + maxWaitMs + 'ms.');
                        reject(new Error('No job cards found on this page.'));
                    }
                }, pollIntervalMs);
            });
        },

        /**
         * Get job IDs from fully-rendered cards in the DOM (snapshot).
         * LinkedIn virtualizes the job list — only ~7-8 cards have inner content
         * at a time. This method only finds those rendered cards.
         * Use discoverAllJobIds() to get ALL job IDs from the shell <li> elements.
         * @returns {Array<string>} Array of job ID strings from rendered cards only.
         */
        getJobIds: function() {
            var cards = document.querySelectorAll(JobSelectors.JOB_CARD);
            var ids = [];
            cards.forEach(function(card) {
                var jobId = card.getAttribute('data-job-id');
                if (jobId) {
                    ids.push(jobId);
                }
            });
            return ids;
        },

        /**
         * Discover all job IDs on the page using the outer <li> shell elements.
         * LinkedIn virtualizes the job list — only ~7 cards have fully rendered
         * inner content at a time, but ALL jobs have lightweight <li> shells
         * with data-occludable-job-id attributes present in the DOM from the start.
         *
         * After a page navigation, Ember may not have inserted all shells yet
         * when the first rendered cards appear. So we poll until the shell count
         * stabilizes (same count for 3 consecutive checks).
         * @returns {Promise<Array<string>>} Array of all discovered job ID strings.
         */
        discoverAllJobIds: function() {
            var self = this;
            var previousCount = 0;
            var stableChecks = 0;
            var requiredStable = 3;  // Must see same count 3 times in a row
            var maxAttempts = 20;    // 20 * 300ms = 6 seconds max
            var attempt = 0;

            /**
             * Collect IDs from shell elements and check if count has stabilized.
             * @returns {Promise<Array<string>>} Resolved when stable.
             */
            function pollUntilStable() {
                attempt++;
                var listItems = document.querySelectorAll(JobSelectors.JOB_LIST_ITEM);
                var currentCount = listItems.length;

                if (currentCount === previousCount && currentCount > 0) {
                    stableChecks++;
                } else {
                    stableChecks = 0;
                    previousCount = currentCount;
                }

                if (stableChecks >= requiredStable || attempt >= maxAttempts) {
                    // Collect the final set of IDs
                    var allIds = [];
                    listItems.forEach(function(li) {
                        var jobId = li.getAttribute('data-occludable-job-id');
                        if (jobId && allIds.indexOf(jobId) === -1) {
                            allIds.push(jobId);
                        }
                    });

                    console.log('[LiSeSca] Discovered ' + allIds.length + ' job IDs from list item shells'
                        + ' (stabilized after ' + attempt + ' checks).');

                    // Fallback: if no occludable shells found, try rendered cards directly
                    if (allIds.length === 0) {
                        allIds = self.getJobIds();
                        console.log('[LiSeSca] Fallback: found ' + allIds.length + ' job IDs from rendered cards.');
                    }

                    return Promise.resolve(allIds);
                }

                return Emulator.randomDelay(250, 350).then(function() {
                    return pollUntilStable();
                });
            }

            return pollUntilStable();
        },

        /**
         * Extract basic data from a job card element (left panel only).
         * @param {HTMLElement} card - The job card div with data-job-id.
         * @returns {Object} Basic job data: jobId, jobTitle, company, location, directLink.
         */
        extractCardBasics: function(card) {
            var jobId = card.getAttribute('data-job-id') || '';

            // Job title from the card's title link
            var titleLink = card.querySelector(JobSelectors.CARD_TITLE_LINK);
            var jobTitle = '';
            var directLink = '';
            if (titleLink) {
                // The aria-label often has the cleanest title text
                jobTitle = (titleLink.getAttribute('aria-label') || '').trim();
                // Remove " with verification" suffix that LinkedIn adds
                jobTitle = jobTitle.replace(/\s+with verification\s*$/i, '').trim();
                // Fall back to text content if aria-label is empty
                if (!jobTitle) {
                    // Get just the strong/text content, avoiding SVG text
                    var strongEl = titleLink.querySelector('strong');
                    jobTitle = strongEl ? (strongEl.textContent || '').trim() : (titleLink.textContent || '').trim();
                }
                // Build clean job link
                directLink = 'https://www.linkedin.com/jobs/view/' + jobId + '/';
            }

            // Company name from the subtitle span
            var companyEl = card.querySelector(JobSelectors.CARD_COMPANY);
            var company = companyEl ? (companyEl.textContent || '').trim() : '';

            // Location from the metadata list
            var metadataEl = card.querySelector(JobSelectors.CARD_METADATA);
            var location = metadataEl ? (metadataEl.textContent || '').trim() : '';

            // Insight text (e.g. "3 connections work here", "You'd be a top applicant")
            var insightEl = card.querySelector(JobSelectors.CARD_INSIGHT);
            var insight = insightEl ? (insightEl.textContent || '').trim() : '';

            // Viewed state from the card footer (if present)
            var viewedEl = card.querySelector(JobSelectors.CARD_FOOTER_JOB_STATE);
            var stateText = viewedEl ? (viewedEl.textContent || '').trim() : '';
            var viewed = stateText.match(/viewed|applied/i) ? true : false;

            return {
                jobId: jobId,
                jobTitle: jobTitle,
                company: company,
                location: location,
                directLink: directLink,
                cardInsight: insight,
                viewed: viewed,
                jobState: stateText
            };
        },

        /**
         * Format job card basics as Markdown for AI evaluation.
         * Produces a concise summary for the AI to evaluate relevance.
         * @param {Object} cardData - The card data from extractCardBasics.
         * @returns {string} Markdown-formatted job card summary.
         */
        formatCardForAI: function(cardData) {
            var lines = [
                '## ' + (cardData.jobTitle || 'Unknown Title'),
                '**Company:** ' + (cardData.company || 'Unknown'),
                '**Location:** ' + (cardData.location || 'Not specified')
            ];

            if (cardData.cardInsight) {
                lines.push('**Insight:** ' + cardData.cardInsight);
            }

            return lines.join('\n');
        },

        /**
         * Click a job card to load its detail panel on the right.
         * LinkedIn virtualizes the job list — only ~7-8 cards have rendered
         * inner content at a time. The rest are empty <li> shells with
         * data-occludable-job-id. To click a non-rendered card, we first
         * scroll its <li> shell into view to trigger Ember.js rendering,
         * then wait for the inner div[data-job-id] to appear, then click.
         * @param {string} jobId - The job ID to click.
         * @returns {Promise<void>}
         */
        clickJobCard: function(jobId) {
            return this.getRenderedCard(jobId).then(function(result) {
                if (!result.card && result.shell) {
                    console.log('[LiSeSca] Clicking shell <li> as fallback for ' + jobId);
                    result.shell.click();
                    return;
                }

                if (!result.card) {
                    console.warn('[LiSeSca] No card rendered for job ' + jobId);
                    return;
                }

                var titleLink = result.card.querySelector(JobSelectors.CARD_TITLE_LINK);
                if (titleLink) {
                    titleLink.click();
                } else {
                    result.card.click();
                }

                console.log('[LiSeSca] Clicked job card: ' + jobId);
            });
        },

        /**
         * Wait for the detail panel to load content for a specific job.
         * Polls until the detail panel title matches the expected job, or times out.
         * @param {string} jobId - The job ID we expect to see in the detail panel.
         * @returns {Promise<boolean>} True if detail loaded, false if timed out.
         */
        waitForDetailPanel: function(jobId) {
            return new Promise(function(resolve) {
                var maxWaitMs = 8000;
                var pollIntervalMs = 400;
                var elapsed = 0;

                var poll = setInterval(function() {
                    // Check if the detail container has content referencing this job.
                    // The detail container's parent element has a data-job-details-events-trigger
                    // attribute, and the URL in the detail title link contains the job ID.
                    var detailTitle = document.querySelector(JobSelectors.DETAIL_TITLE);
                    if (detailTitle) {
                        // Check if there's a link inside the title that contains our job ID
                        var titleLink = detailTitle.querySelector('a');
                        if (titleLink) {
                            var href = titleLink.getAttribute('href') || '';
                            if (href.indexOf(jobId) !== -1) {
                                clearInterval(poll);
                                console.log('[LiSeSca] Detail panel loaded for job: ' + jobId);
                                resolve(true);
                                return;
                            }
                        }
                        // If we can see any title and enough time has passed, accept it
                        // (some job cards may not have matching links)
                        if (elapsed >= 2000) {
                            clearInterval(poll);
                            console.log('[LiSeSca] Detail panel has content (accepting after delay).');
                            resolve(true);
                            return;
                        }
                    }

                    elapsed += pollIntervalMs;
                    if (elapsed >= maxWaitMs) {
                        clearInterval(poll);
                        console.warn('[LiSeSca] Detail panel did not load for job ' + jobId + ' after ' + maxWaitMs + 'ms.');
                        resolve(false);
                    }
                }, pollIntervalMs);
            });
        },

        /**
         * Click "Show more" or "show more" buttons in the detail panel
         * to expand collapsed content sections.
         * @returns {Promise<void>}
         */
        clickShowMore: function() {
            var buttons = document.querySelectorAll(JobSelectors.DETAIL_SHOW_MORE);
            var clicked = false;
            buttons.forEach(function(btn) {
                var text = (btn.textContent || '').trim().toLowerCase();
                if (text.indexOf('show more') !== -1 || text.indexOf('see more') !== -1) {
                    btn.click();
                    clicked = true;
                }
            });
            if (clicked) {
                // Wait briefly for content to expand
                return new Promise(function(resolve) {
                    setTimeout(resolve, 600);
                });
            }
            return Promise.resolve();
        },

        /**
         * Extract the job title from the detail panel.
         * @returns {string} The job title text.
         */
        extractDetailTitle: function() {
            var el = document.querySelector(JobSelectors.DETAIL_TITLE);
            if (!el) {
                return '';
            }
            // Get the text from the link inside h1, or fall back to h1 text
            var link = el.querySelector('a');
            if (link) {
                return (link.textContent || '').trim();
            }
            return (el.textContent || '').trim();
        },

        /**
         * Extract the company name from the detail panel.
         * @returns {string} The company name.
         */
        extractDetailCompany: function() {
            var el = document.querySelector(JobSelectors.DETAIL_COMPANY_NAME);
            return el ? (el.textContent || '').trim() : '';
        },

        /**
         * Extract location, posted date, and applicant count from the tertiary description.
         * The tertiary description container has spans with tvm__text class containing
         * location, posted date, and applicant info separated by " · ".
         * @returns {Object} { location, postedDate, applicants }
         */
        extractDetailTertiaryInfo: function() {
            var result = { location: '', postedDate: '', applicants: '' };
            var container = document.querySelector(JobSelectors.DETAIL_TERTIARY_DESC);
            if (!container) {
                return result;
            }

            // Get all the tvm__text spans
            var spans = container.querySelectorAll('.tvm__text');
            var textParts = [];
            spans.forEach(function(span) {
                var text = (span.textContent || '').trim();
                // Skip separator dots and whitespace-only spans
                if (text && text !== '·' && text.length > 1) {
                    textParts.push(text);
                }
            });

            // Parse the parts — LinkedIn typically arranges as:
            // Location · Posted date · Applicant count
            // (and sometimes additional lines like "Promoted by hirer")
            textParts.forEach(function(part) {
                if (part.match(/\d+\s*(people|applicant)/i) || part.match(/clicked apply/i)) {
                    result.applicants = part;
                } else if (part.match(/ago|Reposted|week|day|hour|month/i)) {
                    result.postedDate = part;
                } else if (part.match(/,/) && !part.match(/Promoted|managed|Responses/i)) {
                    // Location usually has a comma (e.g. "City, Country")
                    if (!result.location) {
                        result.location = part;
                    }
                }
            });

            return result;
        },

        /**
         * Extract workplace type and employment type from the fit preferences buttons.
         * These are buttons like "✓ Hybrid" and "✓ Full-time".
         * @returns {Object} { workplaceType, employmentType }
         */
        extractDetailJobTypes: function() {
            var result = { workplaceType: '', employmentType: '' };
            var buttons = document.querySelectorAll(JobSelectors.DETAIL_FIT_PREFS);

            buttons.forEach(function(btn) {
                var text = (btn.textContent || '').trim();
                // Extract just the type keywords
                if (text.match(/Hybrid|Remote|On-site|Onsite/i)) {
                    var match = text.match(/(Hybrid|Remote|On-site|Onsite)/i);
                    if (match) {
                        result.workplaceType = match[1];
                    }
                }
                if (text.match(/Full-time|Part-time|Contract|Temporary|Internship|Volunteer/i)) {
                    var match2 = text.match(/(Full-time|Part-time|Contract|Temporary|Internship|Volunteer)/i);
                    if (match2) {
                        result.employmentType = match2[1];
                    }
                }
            });

            return result;
        },

        /**
         * Extract the apply link or determine if it's Easy Apply.
         * @returns {string} The apply URL or "Easy Apply" indication.
         */
        extractDetailApplyLink: function() {
            var applyBtn = document.querySelector(JobSelectors.DETAIL_APPLY_BUTTON);
            if (!applyBtn) {
                return '';
            }

            // Check if it's an external apply (has link-external icon)
            var externalIcon = applyBtn.querySelector('[data-test-icon="link-external-small"]');
            if (externalIcon) {
                // External apply — the actual URL is not directly visible,
                // so we note it as "External Apply"
                return 'External Apply';
            }

            // Check the button text for "Easy Apply"
            var btnText = (applyBtn.textContent || '').trim();
            if (btnText.match(/Easy Apply/i)) {
                return 'Easy Apply';
            }

            return 'Apply';
        },

        /**
         * Extract network connection information.
         * @returns {string} e.g. "3 connections work here" or empty.
         */
        extractDetailNetworkInfo: function() {
            var el = document.querySelector(JobSelectors.DETAIL_CONNECTIONS);
            return el ? (el.textContent || '').trim() : '';
        },

        /**
         * Extract the full job description and convert HTML to Markdown.
         * @returns {string} The job description in Markdown format.
         */
        extractDetailJobDescription: function() {
            var el = document.querySelector(JobSelectors.DETAIL_JOB_DESCRIPTION);
            if (!el) {
                return '';
            }

            // Get the content div inside #job-details (skip the "About the job" heading)
            var contentDiv = el.querySelector('.mt4');
            return htmlToMarkdown(contentDiv || el);
        },

        /**
         * Extract premium applicant insights section as Markdown.
         * @returns {string} Premium insights in Markdown, or empty.
         */
        extractDetailPremiumInsights: function() {
            var el = document.querySelector(JobSelectors.DETAIL_PREMIUM_INSIGHTS);
            if (!el) {
                return '';
            }

            return htmlToMarkdown(el);
        },

        /**
         * Extract the "About the company" section as Markdown.
         * @returns {Object} { description, industry, employeeCount }
         */
        extractDetailAboutCompany: function() {
            var result = { description: '', industry: '', employeeCount: '' };

            var companySection = document.querySelector(JobSelectors.DETAIL_ABOUT_COMPANY);
            if (!companySection) {
                return result;
            }

            // Industry and employee count from inline information spans
            var infoSpans = companySection.querySelectorAll(JobSelectors.DETAIL_COMPANY_INFO);
            infoSpans.forEach(function(span) {
                var text = (span.textContent || '').trim();
                if (text.match(/employees/i)) {
                    result.employeeCount = text;
                }
            });

            // The industry is the first text node in the t-14 mt5 div,
            // before the inline-information spans
            var infoDiv = companySection.querySelector('.t-14.mt5');
            if (infoDiv) {
                // Get the first text content before any child elements
                var firstText = '';
                for (var i = 0; i < infoDiv.childNodes.length; i++) {
                    var node = infoDiv.childNodes[i];
                    if (node.nodeType === Node.TEXT_NODE) {
                        var trimmed = node.textContent.trim();
                        if (trimmed) {
                            firstText = trimmed;
                            break;
                        }
                    }
                }
                result.industry = firstText;
            }

            // Company description
            var descEl = companySection.querySelector(JobSelectors.DETAIL_COMPANY_DESC);
            if (descEl) {
                result.description = htmlToMarkdown(descEl);
            }

            return result;
        },

        /**
         * Extract all data for a single job: click card → wait → expand → extract.
         * This is the main orchestration method for per-job extraction.
         * @param {string} jobId - The job ID to extract.
         * @returns {Promise<Object|null>} Complete job data object, or null on failure.
         */
        extractFullJob: function(jobId) {
            var self = this;

            return self.clickJobCard(jobId).then(function() {
                return self.waitForDetailPanel(jobId);
            }).then(function(loaded) {
                if (!loaded) {
                    console.warn('[LiSeSca] Skipping job ' + jobId + ' — detail panel did not load.');
                    return null;
                }

                // Click "Show more" buttons to expand collapsed sections
                return self.clickShowMore();
            }).then(function(result) {
                // If previous step returned null (from skipped job), propagate
                if (result === null) {
                    return null;
                }

                // Scroll the detail panel to the bottom to trigger lazy-loading
                // of sections like "Premium Insights" and "About the Company"
                // that only render when scrolled into view.
                var detailPanel = document.querySelector('.jobs-search__job-details--container')
                    || document.querySelector('.scaffold-layout__detail');
                if (detailPanel) {
                    var maxScroll = detailPanel.scrollHeight - detailPanel.clientHeight;
                    if (maxScroll > 0) {
                        detailPanel.scrollTo({ top: maxScroll, behavior: 'smooth' });
                    }
                }

                // Brief wait for lazy-loaded bottom sections to render,
                // then click any additional "Show more" buttons that appeared
                return Emulator.randomDelay(600, 1000).then(function() {
                    return self.clickShowMore();
                }).then(function() {
                    return 'ok';  // Signal that we should proceed with extraction
                });
            }).then(function(signal) {
                if (signal === null) {
                    return null;
                }

                // Extract card basics first (some data is only in the card)
                var card = document.querySelector('div[data-job-id="' + jobId + '"]');
                var cardData = card ? self.extractCardBasics(card) : { };

                // Extract detail panel data
                var detailTitle = self.extractDetailTitle();
                var detailCompany = self.extractDetailCompany();
                var tertiaryInfo = self.extractDetailTertiaryInfo();
                var jobTypes = self.extractDetailJobTypes();
                var applyLink = self.extractDetailApplyLink();
                var networkInfo = self.extractDetailNetworkInfo();
                var jobDescription = self.extractDetailJobDescription();
                var premiumInsights = self.extractDetailPremiumInsights();
                var aboutCompany = self.extractDetailAboutCompany();

                // Merge card data with detail data (detail takes precedence)
                var job = {
                    jobId: jobId,
                    jobTitle: detailTitle || cardData.jobTitle || '',
                    company: detailCompany || cardData.company || '',
                    location: tertiaryInfo.location || cardData.location || '',
                    postedDate: tertiaryInfo.postedDate || '',
                    applicants: tertiaryInfo.applicants || '',
                    workplaceType: jobTypes.workplaceType || '',
                    employmentType: jobTypes.employmentType || '',
                    applyLink: applyLink || '',
                    jobLink: cardData.directLink || ('https://www.linkedin.com/jobs/view/' + jobId + '/'),
                    networkConnections: networkInfo || cardData.cardInsight || '',
                    industry: aboutCompany.industry || '',
                    employeeCount: aboutCompany.employeeCount || '',
                    viewed: cardData.viewed === true,
                    jobState: cardData.jobState || '',
                    jobDescription: jobDescription || '',
                    premiumInsights: premiumInsights || '',
                    aboutCompany: aboutCompany.description || ''
                };

                console.log('[LiSeSca] Extracted job: ' + job.jobTitle + ' at ' + job.company);
                return job;
            });
        }
    };

    // ===== JOB EMULATION =====
    // Simulates human browsing behavior specific to job detail panels.
    // When reviewing a job, a human would scroll the detail panel, move the mouse
    // over the description, and spend several seconds reading before moving on.

    const JobEmulator = {
        /** Flag to allow cancellation */
        cancelled: false,

        /**
         * Simulate a human reviewing a job detail panel.
         * Scrolls the right-side detail panel, dispatches mouse events,
         * and pauses for a random duration.
         * @param {string} statusPrefix - Text to show in the UI status.
         * @returns {Promise<void>}
         */
        emulateJobReview: function(statusPrefix) {
            this.cancelled = false;
            var self = this;

            // Spend configurable time "reading" each job detail
            var totalTimeMs = Emulator.getRandomInt(
                CONFIG.MIN_JOB_REVIEW_TIME * 1000,
                CONFIG.MAX_JOB_REVIEW_TIME * 1000
            );
            var totalTimeSec = Math.round(totalTimeMs / 1000);
            var startTimeMs = Date.now();

            var prefix = statusPrefix || 'Reviewing job';
            UI.showStatus(prefix + ' — ' + totalTimeSec + 's');

            // Find the detail panel's scrollable container
            var detailContainer = document.querySelector('.jobs-search__job-details--container')
                || document.querySelector('.scaffold-layout__detail');

            var scrollTarget = 0;
            var maxScroll = 0;
            if (detailContainer) {
                maxScroll = detailContainer.scrollHeight - detailContainer.clientHeight;
            }

            // Number of scroll steps
            var numberOfSteps = Emulator.getRandomInt(4, 8);
            var scrollPerStep = maxScroll > 0 ? maxScroll / numberOfSteps : 0;

            /**
             * Execute one review step.
             * @param {number} step - Current step index.
             * @returns {Promise<void>}
             */
            function executeStep(step) {
                if (self.cancelled) {
                    return Promise.resolve();
                }
                if (step >= numberOfSteps) {
                    return Promise.resolve();
                }

                // Update countdown
                var elapsedMs = Date.now() - startTimeMs;
                var remainingSec = Math.max(0, Math.round((totalTimeMs - elapsedMs) / 1000));
                UI.showStatus(prefix + ' — ' + remainingSec + 's');

                // Scroll the detail panel
                if (detailContainer && maxScroll > 0) {
                    scrollTarget = Math.min(scrollTarget + scrollPerStep * (0.6 + Math.random() * 0.8), maxScroll);
                    detailContainer.scrollTo({ top: scrollTarget, behavior: 'smooth' });
                }

                // Dispatch mouse move over the detail area
                var mouseY = Emulator.getRandomInt(200, 600);
                Emulator.dispatchMouseMove(mouseY);

                var delayMs = Math.floor(totalTimeMs / numberOfSteps);
                var delayMin = Math.max(delayMs - 200, 200);
                var delayMax = delayMs + 300;

                return Emulator.randomDelay(delayMin, delayMax).then(function() {
                    return executeStep(step + 1);
                });
            }

            return executeStep(0).then(function() {
                console.log('[LiSeSca] Job review emulation complete.');
            });
        },

        /**
         * Simulate scrolling the left job list panel.
         * Used before starting to process jobs to make the page load look natural.
         * @returns {Promise<void>}
         */
        scrollJobList: function() {
            var listContainer = document.querySelector('.scaffold-layout__list');
            if (!listContainer) {
                return Promise.resolve();
            }

            var maxScroll = listContainer.scrollHeight - listContainer.clientHeight;
            if (maxScroll <= 0) {
                return Promise.resolve();
            }

            // Scroll down slowly, then back up a bit
            listContainer.scrollTo({ top: maxScroll * 0.4, behavior: 'smooth' });

            return Emulator.randomDelay(500, 1000).then(function() {
                listContainer.scrollTo({ top: maxScroll * 0.2, behavior: 'smooth' });
                return Emulator.randomDelay(300, 600);
            });
        },

        /**
         * Cancel the ongoing emulation.
         */
        cancel: function() {
            this.cancelled = true;
        }
    };

    // ===== OUTPUT GENERATION (JOBS) =====
    // Formats scraped job data into XLSX and Markdown.
    // CSV is not offered for jobs because job data contains long text fields
    // (descriptions, company info) that are poorly suited to CSV format.

    const JobOutput = {

        /** Column headers for XLSX export */
        COLUMN_HEADERS: [
            'Job Title', 'Company', 'Location', 'Posted', 'Applicants', 'Job State',
            'Workplace Type', 'Employment Type', 'Apply Link', 'Job Link',
            'Network Connections', 'Industry', 'Employee Count',
            'About the Job', 'Premium Insights', 'About the Company'
        ],

        /**
         * Convert a job object into a row array for XLSX.
         * @param {Object} job - A job data object.
         * @returns {Array<string>} Array of cell values.
         */
        jobToRow: function(job) {
            return [
                job.jobTitle || '',
                job.company || '',
                job.location || '',
                job.postedDate || '',
                job.applicants || '',
                job.jobState || '',
                job.workplaceType || '',
                job.employmentType || '',
                job.applyLink || '',
                job.jobLink || '',
                job.networkConnections || '',
                job.industry || '',
                job.employeeCount || '',
                job.jobDescription || '',
                job.premiumInsights || '',
                job.aboutCompany || ''
            ];
        },

        /**
         * Format a single job into Markdown.
         * @param {Object} job - A job data object.
         * @returns {string} The formatted Markdown block for this job.
         */
        formatJobMarkdown: function(job) {
            var lines = [];

            lines.push('# ' + (job.jobTitle || '(untitled)'));
            lines.push('');
            lines.push('**Company:** ' + (job.company || '(unknown)'));
            lines.push('**Location:** ' + (job.location || '(unknown)'));

            // Posted + Applicants on the same line
            var postedLine = '';
            if (job.postedDate) {
                postedLine += '**Posted:** ' + job.postedDate;
            }
            if (job.applicants) {
                if (postedLine) {
                    postedLine += ' | ';
                }
                postedLine += '**Applicants:** ' + job.applicants;
            }
            if (postedLine) {
                lines.push(postedLine);
            }

            if (job.jobState) {
                lines.push('**Job State:** ' + job.jobState);
            }

            // Type line (workplace + employment)
            var typeParts = [];
            if (job.employmentType) {
                typeParts.push(job.employmentType);
            }
            if (job.workplaceType) {
                typeParts.push(job.workplaceType);
            }
            if (typeParts.length > 0) {
                lines.push('**Type:** ' + typeParts.join(', '));
            }

            // Apply and Job links
            if (job.applyLink) {
                lines.push('**Apply:** ' + job.applyLink);
            }
            lines.push('**Job Link:** ' + (job.jobLink || ''));

            if (job.networkConnections) {
                lines.push('**Network:** ' + job.networkConnections);
            }

            // Industry + Employee count
            var industryLine = '';
            if (job.industry) {
                industryLine += '**Industry:** ' + job.industry;
            }
            if (job.employeeCount) {
                if (industryLine) {
                    industryLine += ' | ';
                }
                industryLine += '**Employees:** ' + job.employeeCount;
            }
            if (industryLine) {
                lines.push(industryLine);
            }

            // Job description
            if (job.jobDescription) {
                lines.push('');
                lines.push('## About the Job');
                lines.push('');
                lines.push(job.jobDescription);
            }

            // About the company
            if (job.aboutCompany) {
                lines.push('');
                lines.push('## About the Company');
                lines.push('');
                lines.push(job.aboutCompany);
            }

            // Premium insights
            if (job.premiumInsights) {
                lines.push('');
                lines.push('## Job Seeker Insights (Premium)');
                lines.push('');
                lines.push(job.premiumInsights);
            }

            return lines.join('\n');
        },

        /**
         * Generate a complete Markdown document from an array of jobs.
         * @param {Array} jobs - Array of job data objects.
         * @returns {string} The complete Markdown content.
         */
        generateMarkdown: function(jobs) {
            var blocks = jobs.map(function(job) {
                return JobOutput.formatJobMarkdown(job);
            });
            return blocks.join('\n\n---\n\n') + '\n';
        },

        /**
         * Generate an XLSX file from job data.
         * @param {Array} jobs - Array of job data objects.
         * @returns {Uint8Array} The binary XLSX file content.
         */
        generateXLSX: function(jobs) {
            var self = this;
            var data = [this.COLUMN_HEADERS];
            jobs.forEach(function(job) {
                data.push(self.jobToRow(job));
            });

            var worksheet = XLSX.utils.aoa_to_sheet(data);
            var workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'LinkedIn Jobs');

            var xlsxData = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
            return new Uint8Array(xlsxData);
        },

        /**
         * Generate a job-specific filename.
         * @param {string} extension - File extension.
         * @returns {string} The generated filename.
         */
        buildFilename: function(extension) {
            var ext = extension || 'md';
            var now = new Date();
            var year = now.getFullYear();
            var month = String(now.getMonth() + 1).padStart(2, '0');
            var day = String(now.getDate()).padStart(2, '0');
            var hours = String(now.getHours()).padStart(2, '0');
            var minutes = String(now.getMinutes()).padStart(2, '0');
            return 'linkedin-jobs-' + year + '-' + month + '-' + day
                + '-' + hours + 'h' + minutes + '.' + ext;
        },

        /**
         * Download job results in the selected formats.
         * Jobs support XLSX and Markdown only (no CSV due to long text fields).
         * @param {Array} jobs - Array of job data objects.
         */
        downloadResults: function(jobs) {
            if (!jobs || jobs.length === 0) {
                console.warn('[LiSeSca] No jobs to download.');
                return;
            }

            var formats = State.getFormats();
            console.log('[LiSeSca] Downloading jobs in formats: ' + formats.join(', '));

            var self = this;
            var delayMs = 0;

            // XLSX format
            if (formats.indexOf('xlsx') !== -1) {
                setTimeout(function() {
                    var xlsxData = self.generateXLSX(jobs);
                    var xlsxFilename = self.buildFilename('xlsx');
                    Output.downloadFile(
                        xlsxData,
                        xlsxFilename,
                        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                    );
                }, delayMs);
                delayMs += 200;
            }

            // Markdown format
            if (formats.indexOf('md') !== -1) {
                setTimeout(function() {
                    var markdown = self.generateMarkdown(jobs);
                    var mdFilename = self.buildFilename('md');
                    Output.downloadFile(markdown, mdFilename, 'text/markdown;charset=utf-8');
                }, delayMs);
            }
        }
    };

    // ===== JOB CONTROLLER =====
    // Orchestrates the job scraping lifecycle.
    // Unlike people search (which extracts all cards on a page at once),
    // job scraping must click each card individually, wait for the detail panel,
    // and extract data from both the card and the detail panel.
    //
    // State machine for jobs:
    //   Page Load → Check scrapeMode == 'jobs'?
    //     YES → Check jobIndex:
    //       If jobIndex < total jobs on page → resume scrapeNextJob()
    //       If all jobs done → decideNextAction() (next page or finish)
    //     NO → Check scrapeMode == 'people'? → existing Controller

    const JobController = {

        /**
         * Start a new job scraping session.
         * @param {string} pageCount - Number of pages ('1', '3', '5', '10').
         */
        startScraping: function(pageCount) {
            if (!PageDetector.isOnJobsPage()) {
                console.warn('[LiSeSca] Not on a jobs page. Scraping aborted.');
                UI.showStatus('Wrong page — navigate to Jobs search first.');
                setTimeout(function() {
                    UI.showIdleState();
                }, 3000);
                return;
            }

            var target = (pageCount === 'all') ? 25 : Math.min(parseInt(pageCount, 10), 25);
            var startPage = JobPaginator.getCurrentPage();
            var baseUrl = JobPaginator.getBaseSearchUrl();

            console.log('[LiSeSca] Starting job scrape: target=' + target
                + ' pages, starting at page ' + startPage);

            var selectedFormats = State.readFormatsFromUI();
            if (selectedFormats.length === 0) {
                selectedFormats = ['xlsx'];
            }

            // Save AI enabled state from UI
            var aiEnabled = State.readAIEnabledFromUI();
            State.saveAIEnabled(aiEnabled);

            // Save Full AI enabled state from UI
            var fullAIEnabled = State.readFullAIEnabledFromUI();
            State.saveFullAIEnabled(fullAIEnabled);

            State.startSession(target, startPage, baseUrl, 'jobs');
            State.saveFormats(selectedFormats);

            var totalJobs = 0;
            if (pageCount === 'all') {
                var subtitleEl = document.querySelector('.jobs-search-results-list__subtitle span');
                if (subtitleEl) {
                    var totalJobsText = (subtitleEl.textContent || '').trim();
                    var match = totalJobsText.match(/^([\d,]+)\s+result/);
                    if (match) {
                        totalJobs = parseInt(match[1].replace(/,/g, ''), 10);
                    }
                }
            }
            State.set(State.KEYS.JOB_TOTAL, totalJobs);

            this.scrapePage();
        },

        /**
         * Resume a job scraping session after a page reload.
         */
        resumeScraping: function() {
            if (!PageDetector.isOnJobsPage()) {
                console.warn('[LiSeSca] Resumed jobs on wrong page. Saving buffered data.');
                UI.showStatus('Wrong page detected. Saving collected data...');
                var buffer = State.getBuffer();
                if (buffer.length > 0) {
                    JobOutput.downloadResults(buffer);
                }
                State.clear();
                setTimeout(function() {
                    UI.showIdleState();
                }, 3000);
                return;
            }

            var state = State.getScrapingState();
            console.log('[LiSeSca] Resuming job scraping. Page ' + state.currentPage
                + ', jobIndex=' + state.jobIndex
                + ', ' + state.scrapedBuffer.length + ' jobs buffered.');

            this.scrapePage();
        },

        /**
         * Begin scraping the current page of job results.
         * First, wait for job cards to load, then start the per-job loop.
         */
        scrapePage: function() {
            var self = this;
            var state = State.getScrapingState();

            // Reset AI conversation for the new page (if AI filtering is enabled)
            if (State.getAIEnabled() && AIClient.isConfigured()) {
                AIClient.resetConversation();
            }

            var totalKnown = State.get(State.KEYS.JOB_TOTAL, 0);
            if (totalKnown > 0) {
                UI.showProgress('Progress: (' + state.scrapedBuffer.length + '/' + totalKnown + ')');
            } else {
                UI.showProgress('');
            }
            UI.showStatus('Page ' + state.currentPage + ' — Loading job cards...');

            // Wait for at least some job cards to appear in the DOM
            JobExtractor.waitForJobCards().then(function() {
                // If we're starting fresh on this page, discover all job IDs
                // by scrolling the left panel (LinkedIn virtualizes the list)
                var storedIds = State.getJobIdsOnPage();
                if (storedIds.length === 0 || state.jobIndex === 0) {
                    return JobExtractor.discoverAllJobIds().then(function(jobIds) {
                        State.set(State.KEYS.JOB_IDS_ON_PAGE, JSON.stringify(jobIds));
                        State.set(State.KEYS.JOB_INDEX, 0);
                        console.log('[LiSeSca] Found ' + jobIds.length + ' jobs on page ' + state.currentPage);

                        if (jobIds.length === 0) {
                            console.log('[LiSeSca] No jobs found on page. Finishing.');
                            self.finishScraping();
                        }
                    });
                }
                return Promise.resolve();
            }).then(function() {
                if (!State.isScraping()) {
                    return;
                }
                // Start the per-job scraping loop
                self.scrapeNextJob();
            }).catch(function(error) {
                console.error('[LiSeSca] Job page scrape error:', error);
                UI.showStatus('Error: ' + error.message);

                var buffer = State.getBuffer();
                if (buffer.length > 0) {
                    JobOutput.downloadResults(buffer);
                }
                State.clear();
                setTimeout(function() {
                    UI.showIdleState();
                }, 5000);
            });
        },

        /**
         * Process the next job in the per-job scraping loop.
         * Reads the current jobIndex and jobIdsOnPage from state,
         * extracts the job, then advances to the next index.
         */
        scrapeNextJob: function() {
            var self = this;

            if (!State.isScraping()) {
                console.log('[LiSeSca] Job scraping stopped.');
                self.finishScraping();
                return;
            }

            var jobIndex = State.get(State.KEYS.JOB_INDEX, 0);
            var jobIds = State.getJobIdsOnPage();
            var state = State.getScrapingState();
            var pagesScraped = state.currentPage - state.startPage;

            // Check if we've processed all jobs on this page
            if (jobIndex >= jobIds.length) {
                console.log('[LiSeSca] All ' + jobIds.length + ' jobs processed on page ' + state.currentPage);
                self.decideNextAction();
                return;
            }

            var jobId = jobIds[jobIndex];
            var totalOnPage = jobIds.length;

            // Update status display
            var statusMsg = 'Page ' + state.currentPage
                + ' (' + (pagesScraped + 1) + ' of ' + state.targetPageCount + ')'
                + ' — Job ' + (jobIndex + 1) + ' of ' + totalOnPage;
            var totalKnown = State.get(State.KEYS.JOB_TOTAL, 0);
            if (totalKnown > 0) {
                UI.showProgress('Progress: (' + state.scrapedBuffer.length + '/' + totalKnown + ')');
            } else {
                UI.showProgress('');
            }
            UI.showStatus(statusMsg);

            // Show AI stats if AI filtering is active
            var aiEnabled = State.getAIEnabled() && AIClient.isConfigured();
            if (aiEnabled) {
                UI.showAIStats(State.getAIJobsEvaluated(), State.getAIJobsAccepted());
            }

            var includeViewed = State.getIncludeViewed();
            var aiEnabled = State.getAIEnabled() && AIClient.isConfigured();
            var viewedCheck = includeViewed ? Promise.resolve(false) : JobExtractor.isJobViewed(jobId);

            viewedCheck.then(function(isViewed) {
                if (!State.isScraping()) {
                    return null;
                }
                if (isViewed) {
                    console.log('[LiSeSca] Skipping viewed job ' + jobId);
                    UI.showStatus(statusMsg + ' — Skipping viewed job');
                    State.set(State.KEYS.JOB_INDEX, jobIndex + 1);
                    return Emulator.randomDelay(300, 600).then(function() {
                        self.scrapeNextJob();
                    }).then(function() {
                        return 'skip';
                    });
                }

                // AI filtering: evaluate job card before downloading full details
                if (aiEnabled) {
                    var fullAIMode = State.getFullAIEnabled();

                    return JobExtractor.getRenderedCard(jobId).then(function(result) {
                        if (!result.card) {
                            // Can't get card data, proceed anyway
                            console.log('[LiSeSca] AI filter: no card data, proceeding with job ' + jobId);
                            return JobExtractor.extractFullJob(jobId);
                        }

                        var cardData = JobExtractor.extractCardBasics(result.card);
                        var cardMarkdown = JobExtractor.formatCardForAI(cardData);

                        if (fullAIMode) {
                            // THREE-TIER EVALUATION (reject/keep/maybe)
                            UI.showStatus(statusMsg + ' — AI triage...');
                            var jobLink = 'https://www.linkedin.com/jobs/view/' + jobId;

                            return AIClient.triageCard(cardMarkdown).then(function(result) {
                                if (!State.isScraping()) {
                                    return null;
                                }

                                var decision = result.decision;
                                var reason = result.reason;

                                // Count this job as evaluated
                                State.incrementAIJobsEvaluated();
                                UI.showAIStats(State.getAIJobsEvaluated(), State.getAIJobsAccepted());

                                if (decision === 'reject') {
                                    // Reject: skip job entirely, no full details fetched
                                    // Log rejection with job link and reason for debugging
                                    console.log('[LiSeSca] AI TRIAGE REJECT: ' + cardData.jobTitle);
                                    console.log('  Link: ' + jobLink);
                                    console.log('  Reason: ' + reason);
                                    UI.showStatus(statusMsg + ' — AI: Reject');
                                    State.set(State.KEYS.JOB_INDEX, jobIndex + 1);
                                    return Emulator.randomDelay(300, 600).then(function() {
                                        self.scrapeNextJob();
                                    }).then(function() {
                                        return 'skip';
                                    });
                                }

                                if (decision === 'keep') {
                                    // Keep: accept job, fetch full details for output
                                    console.log('[LiSeSca] AI kept job: ' + cardData.jobTitle + ' - ' + reason);
                                    State.incrementAIJobsAccepted();
                                    UI.showAIStats(State.getAIJobsEvaluated(), State.getAIJobsAccepted());
                                    UI.showStatus(statusMsg + ' — AI: Keep');
                                    return JobExtractor.extractFullJob(jobId);
                                }

                                // Maybe: fetch full details, then ask AI again
                                console.log('[LiSeSca] AI maybe on job: ' + cardData.jobTitle + ' - ' + reason);
                                UI.showStatus(statusMsg + ' — AI: Fetching details...');

                                return JobExtractor.extractFullJob(jobId).then(function(job) {
                                    if (!job) {
                                        console.warn('[LiSeSca] Could not extract job for full evaluation');
                                        return null;
                                    }

                                    if (!State.isScraping()) {
                                        return null;
                                    }

                                    // Format full job for second AI evaluation
                                    var fullJobMarkdown = JobOutput.formatJobMarkdown(job);
                                    UI.showStatus(statusMsg + ' — AI: Full evaluation...');

                                    return AIClient.evaluateFullJob(fullJobMarkdown).then(function(evalResult) {
                                        if (!State.isScraping()) {
                                            return null;
                                        }

                                        var accept = evalResult.accept;
                                        var evalReason = evalResult.reason;

                                        if (accept) {
                                            console.log('[LiSeSca] AI accepted job after full review: ' + job.jobTitle + ' - ' + evalReason);
                                            State.incrementAIJobsAccepted();
                                            UI.showAIStats(State.getAIJobsEvaluated(), State.getAIJobsAccepted());
                                            UI.showStatus(statusMsg + ' — AI: Accept');
                                            return job;
                                        }

                                        // Reject after full evaluation: skip
                                        // Log rejection with job link and reason for debugging
                                        console.log('[LiSeSca] AI FULL REJECT: ' + job.jobTitle);
                                        console.log('  Link: ' + jobLink);
                                        console.log('  Reason: ' + evalReason);
                                        UI.showStatus(statusMsg + ' — AI: Reject (full)');
                                        State.set(State.KEYS.JOB_INDEX, jobIndex + 1);
                                        return Emulator.randomDelay(300, 600).then(function() {
                                            self.scrapeNextJob();
                                        }).then(function() {
                                            return 'skip';
                                        });
                                    });
                                });
                            });
                        } else {
                            // BASIC BINARY EVALUATION (download/skip)
                            UI.showStatus(statusMsg + ' — AI evaluating...');

                            return AIClient.evaluateJob(cardMarkdown).then(function(shouldDownload) {
                                if (!State.isScraping()) {
                                    return null;
                                }

                                // Count this job as evaluated
                                State.incrementAIJobsEvaluated();
                                UI.showAIStats(State.getAIJobsEvaluated(), State.getAIJobsAccepted());

                                if (!shouldDownload) {
                                    console.log('[LiSeSca] AI skipped job: ' + cardData.jobTitle);
                                    UI.showStatus(statusMsg + ' — AI: Skip');
                                    State.set(State.KEYS.JOB_INDEX, jobIndex + 1);
                                    return Emulator.randomDelay(300, 600).then(function() {
                                        self.scrapeNextJob();
                                    }).then(function() {
                                        return 'skip';
                                    });
                                }

                                console.log('[LiSeSca] AI approved job: ' + cardData.jobTitle);
                                State.incrementAIJobsAccepted();
                                UI.showAIStats(State.getAIJobsEvaluated(), State.getAIJobsAccepted());
                                return JobExtractor.extractFullJob(jobId);
                            });
                        }
                    });
                }

                return JobExtractor.extractFullJob(jobId);
            }).then(function(job) {
                if (!State.isScraping()) {
                    return;
                }

                if (job === 'skip') {
                    return 'skip';
                }

                if (job) {
                    // Append this single job to the buffer immediately (data safety)
                    State.appendBuffer([job]);
                    console.log('[LiSeSca] Job ' + (jobIndex + 1) + '/' + totalOnPage
                        + ' extracted: ' + job.jobTitle);
                } else {
                    console.warn('[LiSeSca] Job ' + jobId + ' could not be extracted, skipping.');
                }

                // Emulate reviewing the job detail panel
                var reviewPrefix = 'Page ' + state.currentPage
                    + ' — Reviewing job ' + (jobIndex + 1) + ' of ' + totalOnPage;
                return JobEmulator.emulateJobReview(reviewPrefix);
            }).then(function(result) {
                if (!State.isScraping()) {
                    return;
                }

                if (result === 'skip') {
                    return 'skip';
                }

                // Advance to the next job
                State.set(State.KEYS.JOB_INDEX, jobIndex + 1);

                // Configurable pause between jobs
                return Emulator.randomDelay(
                    CONFIG.MIN_JOB_PAUSE * 1000,
                    CONFIG.MAX_JOB_PAUSE * 1000
                );
            }).then(function(result) {
                if (!State.isScraping()) {
                    self.finishScraping();
                    return;
                }
                if (result === 'skip') {
                    return;
                }
                // Recurse to process the next job
                self.scrapeNextJob();
            }).catch(function(error) {
                console.error('[LiSeSca] Error extracting job ' + jobId + ':', error);

                // Skip this job and continue to the next
                State.set(State.KEYS.JOB_INDEX, jobIndex + 1);
                Emulator.randomDelay(500, 1000).then(function() {
                    self.scrapeNextJob();
                });
            });
        },

        /**
         * Decide whether to continue to the next page or finish.
         */
        decideNextAction: function() {
            var state = State.getScrapingState();
            var pagesScraped = state.currentPage - state.startPage + 1;

            // Check if we've reached the target page count
            if (pagesScraped >= state.targetPageCount) {
                console.log('[LiSeSca] Reached target of ' + state.targetPageCount + ' pages.');
                this.finishScraping();
                return;
            }

            // Check if pagination exists (collections pages may not have it)
            if (!JobPaginator.hasPagination()) {
                console.log('[LiSeSca] No pagination found. Finishing with current results.');
                this.finishScraping();
                return;
            }

            // Check if there is actually a next page
            if (!JobPaginator.hasNextPage()) {
                console.log('[LiSeSca] No next page available (last page reached). Finishing.');
                this.finishScraping();
                return;
            }

            if (!State.isScraping()) {
                this.finishScraping();
                return;
            }

            // Advance to the next page
            State.advancePage();
            var nextPage = State.get(State.KEYS.CURRENT_PAGE, 1);
            // Reset job index for the new page
            State.set(State.KEYS.JOB_INDEX, 0);
            State.set(State.KEYS.JOB_IDS_ON_PAGE, JSON.stringify([]));

            UI.showStatus('Moving to page ' + nextPage + '...');

            setTimeout(function() {
                JobPaginator.navigateToPage(nextPage);
            }, Emulator.getRandomInt(1500, 3000));
        },

        /**
         * Complete the job scraping session.
         */
        finishScraping: function() {
            var buffer = State.getBuffer();
            var totalJobs = buffer.length;
            var state = State.getScrapingState();
            var pagesScraped = state.currentPage - state.startPage + 1;

            // Get AI stats before clearing state
            var aiEnabled = State.getAIEnabled();
            var aiEvaluated = State.getAIJobsEvaluated();
            var aiAccepted = State.getAIJobsAccepted();

            console.log('[LiSeSca] Job scraping finished! Total: ' + totalJobs + ' jobs across '
                + pagesScraped + ' page(s).');
            if (aiEnabled && aiEvaluated > 0) {
                console.log('[LiSeSca] AI stats: ' + aiAccepted + '/' + aiEvaluated + ' accepted.');
            }

            UI.showProgress('');
            UI.hideAIStats();

            if (totalJobs > 0) {
                UI.showStatus('Done! ' + totalJobs + ' jobs scraped across '
                    + pagesScraped + ' page(s). Downloading...');
                JobOutput.downloadResults(buffer);
                State.clear();
                setTimeout(function() {
                    UI.showIdleState();
                }, 5000);
            } else if (aiEnabled && aiEvaluated > 0) {
                // AI filtering was active but no jobs matched - show special notification
                State.clear();
                UI.showNoResults(aiEvaluated, pagesScraped);
            } else {
                UI.showStatus('No jobs found.');
                State.clear();
                setTimeout(function() {
                    UI.showIdleState();
                }, 5000);
            }
        },

        /**
         * Stop job scraping (STOP button handler).
         */
        stopScraping: function() {
            console.log('[LiSeSca] Job scraping stopped by user.');
            Emulator.cancel();
            JobEmulator.cancel();
            State.set(State.KEYS.IS_SCRAPING, false);
            this.finishScraping();
        }
    };

    // ===== MAIN CONTROLLER (PEOPLE SEARCH) =====
    // Orchestrates the people search scraping lifecycle.
    // Also handles SPA navigation detection and UI lifecycle.

    const Controller = {

        /**
         * Initialize the script. Called once on every page load.
         * Sets up SPA navigation handler and builds UI if on a supported page.
         */
        init: function() {
            console.log('[LiSeSca] v' + CONFIG.VERSION + ' initializing...');

            // Wire up the UI with controller references to avoid circular import issues
            setControllers(Controller, JobController);

            CONFIG.load();

            // Always inject styles (they persist across SPA navigation)
            UI.injectStyles();

            // Initialize SPA navigation handler
            var self = this;
            SpaHandler.init(function(newPageType, oldPageType) {
                self.handleNavigation(newPageType, oldPageType);
            });

            // Set up UI for the current page
            this.setupForCurrentPage();
        },

        /**
         * Set up the UI and resume any active scraping for the current page type.
         * Called on initial load and after SPA navigation to a supported page.
         */
        setupForCurrentPage: function() {
            var pageType = PageDetector.getPageType();
            var isDeepScrapeActive = State.isScraping()
                && State.getScrapeMode() === 'people'
                && State.get(State.KEYS.DEEP_SCRAPE_MODE, 'normal') === 'deep';

            if (pageType === 'unknown' && !(isDeepScrapeActive && ProfileExtractor.isOnProfilePage())) {
                console.log('[LiSeSca] Not on a supported page. UI hidden, waiting for navigation.');
                return;
            }

            // Create UI panels for the current page type
            UI.createPanel();
            UI.createConfigPanel();
            UI.createAIConfigPanel();

            // Check if we have an active scraping session to resume
            if (State.isScraping()) {
                var mode = State.getScrapeMode();
                if (mode === 'jobs') {
                    JobController.resumeScraping();
                } else {
                    this.resumeScraping();
                }
            } else {
                console.log('[LiSeSca] Ready. Click SCRAPE to begin.');
            }
        },

        /**
         * Handle SPA navigation events.
         * Shows/hides/rebuilds the UI based on the new page type.
         * @param {string} newPageType - The page type after navigation.
         * @param {string} oldPageType - The page type before navigation.
         */
        handleNavigation: function(newPageType, oldPageType) {
            // Ignore navigation events during active scraping
            // (actual scraping uses full page reloads for navigation)
            if (State.isScraping()) {
                console.log('[LiSeSca] Ignoring SPA navigation during active scrape.');
                return;
            }

            // If we're on an unsupported page now, remove the panel
            if (newPageType === 'unknown') {
                if (UI.isPanelActive()) {
                    UI.removePanel();
                    UI.removeConfigPanel();
                    console.log('[LiSeSca] Navigated away from supported page. UI hidden.');
                }
                return;
            }

            // We're on a supported page now
            // Wait a bit for LinkedIn to render the new page content
            setTimeout(function() {
                // Rebuild the panel (handles color change between people/jobs)
                UI.rebuildPanel();
                console.log('[LiSeSca] Ready on ' + newPageType + ' page.');

                // For jobs pages, update the "All (Np)" label after LinkedIn populates the results count
                if (newPageType === 'jobs') {
                    setTimeout(function() {
                        UI.updateJobsAllLabel();
                    }, 1000);
                }
            }, 500);
        },

        /**
         * Resume an active people scraping session after a page reload.
         */
        resumeScraping: function() {
            var deepMode = State.get(State.KEYS.DEEP_SCRAPE_MODE, 'normal') === 'deep';
            if (deepMode) {
                this.resumeDeepScraping();
                return;
            }

            if (!PageDetector.isOnPeopleSearchPage()) {
                console.warn('[LiSeSca] Resumed on wrong page. Finishing session with buffered data.');
                UI.showStatus('Wrong page detected. Saving collected data...');
                var buffer = State.getBuffer();
                if (buffer.length > 0) {
                    Output.downloadResults(buffer);
                }
                State.clear();
                setTimeout(function() {
                    UI.showIdleState();
                }, 3000);
                return;
            }

            var state = State.getScrapingState();
            var pagesScraped = state.currentPage - state.startPage;
            console.log('[LiSeSca] Resuming people scraping. Page '
                + state.currentPage + ', ' + pagesScraped + ' pages done, '
                + state.scrapedBuffer.length + ' profiles buffered.');

            this.scrapeCycle();
        },

        /**
         * Start a new people scraping session.
         * @param {string} pageCount - Number of pages ('1', '10', '50', 'all').
         */
        startScraping: function(pageCount) {
            if (!PageDetector.isOnPeopleSearchPage()) {
                console.warn('[LiSeSca] Not on a people search page. Scraping aborted.');
                UI.showStatus('Wrong page — navigate to People search first.');
                setTimeout(function() {
                    UI.showIdleState();
                }, 3000);
                return;
            }

            var target = (pageCount === 'all') ? 9999 : parseInt(pageCount, 10);
            var startPage = Paginator.getCurrentPage();
            var baseUrl = Paginator.getBaseSearchUrl();

            console.log('[LiSeSca] Starting people scrape: target=' + target
                + ' pages, starting at page ' + startPage);

            var selectedFormats = State.readFormatsFromUI();
            if (selectedFormats.length === 0) {
                selectedFormats = ['xlsx'];
            }

            var aiEnabled = State.readPeopleAIEnabledFromUI();
            var fullAIEnabled = State.readPeopleFullAIEnabledFromUI();

            if (!CONFIG.isPeopleAIConfigured()) {
                aiEnabled = false;
                fullAIEnabled = false;
            }

            State.savePeopleAIEnabled(aiEnabled);
            State.savePeopleFullAIEnabled(fullAIEnabled);

            State.startSession(target, startPage, baseUrl, 'people');
            State.saveFormats(selectedFormats);
            State.set(State.KEYS.DEEP_SCRAPE_MODE, aiEnabled ? 'deep' : 'normal');
            State.set(State.KEYS.PROFILE_INDEX, 0);
            State.set(State.KEYS.PROFILES_ON_PAGE, JSON.stringify([]));

            if (aiEnabled) {
                this.deepScrapeCycle();
            } else {
                this.scrapeCycle();
            }
        },

        /**
         * The core scraping cycle. Runs once per page.
         */
        scrapeCycle: function() {
            var state = State.getScrapingState();
            var pagesScraped = state.currentPage - state.startPage;
            var targetDisplay = (state.targetPageCount >= 9999)
                ? 'all' : state.targetPageCount.toString();

            var statusPrefix = 'Scanning page ' + state.currentPage
                + ' (' + (pagesScraped + 1) + ' of ' + targetDisplay + ')';

            var self = this;

            Emulator.emulateHumanScan(statusPrefix).then(function() {
                if (!State.isScraping()) {
                    console.log('[LiSeSca] Scraping was stopped during emulation.');
                    return;
                }

                UI.showStatus('Extracting page ' + state.currentPage + '...');
                return Extractor.extractCurrentPage();
            }).then(function(profiles) {
                if (!profiles) {
                    return;
                }

                console.log('[LiSeSca] Page ' + state.currentPage
                    + ': extracted ' + profiles.length + ' profiles.');

                if (profiles.length > 0) {
                    console.table(profiles.map(function(p) {
                        return {
                            name: p.fullName,
                            degree: p.connectionDegree,
                            description: p.description.substring(0, 50),
                            location: p.location
                        };
                    }));
                }

                State.appendBuffer(profiles);
                self.decideNextAction(profiles.length);

            }).catch(function(error) {
                console.error('[LiSeSca] Scrape cycle error:', error);
                UI.showStatus('Error: ' + error.message);

                var buffer = State.getBuffer();
                if (buffer.length > 0) {
                    Output.downloadResults(buffer);
                }
                State.clear();
                setTimeout(function() {
                    UI.showIdleState();
                }, 5000);
            });
        },

        /**
         * Resume a deep people scraping session (profile visit or search page).
         */
        resumeDeepScraping: function() {
            if (ProfileExtractor.isOnProfilePage()) {
                console.log('[LiSeSca] Resuming deep scrape on profile page.');
                this.handleProfileVisit();
                return;
            }

            if (!PageDetector.isOnPeopleSearchPage()) {
                console.warn('[LiSeSca] Deep scrape resumed on wrong page. Saving buffered data.');
                UI.showStatus('Wrong page detected. Saving collected data...');
                var buffer = State.getBuffer();
                if (buffer.length > 0) {
                    Output.downloadResults(buffer);
                }
                State.clear();
                setTimeout(function() {
                    UI.showIdleState();
                }, 3000);
                return;
            }

            this.deepScrapeCycle();
        },

        /**
         * Deep scrape cycle for people search pages.
         * Two-pass approach:
         * 1. Triage all cards on the page (fast, reuses conversation)
         * 2. Visit keep/maybe profiles one by one for extraction
         */
        deepScrapeCycle: function() {
            var self = this;
            var state = State.getScrapingState();
            var pagesScraped = state.currentPage - state.startPage;
            var targetDisplay = (state.targetPageCount >= 9999)
                ? 'all' : state.targetPageCount.toString();

            var statusPrefix = 'Scanning page ' + state.currentPage
                + ' (' + (pagesScraped + 1) + ' of ' + targetDisplay + ')';

            // Check if we already have triaged profiles (resuming after navigation)
            var storedProfiles = State.getProfilesOnPage();
            if (storedProfiles.length > 0) {
                // Profiles already triaged, continue with profile visits
                self.processNextProfile();
                return;
            }

            Emulator.emulateHumanScan(statusPrefix).then(function() {
                if (!State.isScraping()) {
                    return null;
                }
                UI.showStatus('Extracting page ' + state.currentPage + '...');
                return Extractor.extractCurrentPage();
            }).then(function(profiles) {
                if (!profiles) {
                    return;
                }

                console.log('[LiSeSca] Page ' + state.currentPage
                    + ': extracted ' + profiles.length + ' profiles.');

                if (profiles.length === 0) {
                    self.finishScraping();
                    return;
                }

                // Start triage pass
                var aiEnabled = State.getPeopleAIEnabled() && AIClient.isPeopleConfigured();
                if (aiEnabled) {
                    AIClient.resetPeopleConversation();
                    return self.triageAllProfiles(profiles);
                }

                // No AI: mark all as keep and proceed
                profiles.forEach(function(p) {
                    p.aiDecision = 'keep';
                    p.aiReason = 'AI disabled';
                });
                State.set(State.KEYS.PROFILES_ON_PAGE, JSON.stringify(profiles));
                State.set(State.KEYS.PROFILE_INDEX, 0);
                self.processNextProfile();
            }).catch(function(error) {
                console.error('[LiSeSca] Deep scrape cycle error:', error);
                UI.showStatus('Error: ' + error.message);

                var buffer = State.getBuffer();
                if (buffer.length > 0) {
                    Output.downloadResults(buffer);
                }
                State.clear();
                setTimeout(function() {
                    UI.showIdleState();
                }, 5000);
            });
        },

        /**
         * Pass 1: Triage all profiles on the page before visiting any.
         * Accumulates AI conversation for efficiency.
         * @param {Array} profiles - Array of profile card data.
         */
        triageAllProfiles: function(profiles) {
            var self = this;
            var state = State.getScrapingState();
            var pagesScraped = state.currentPage - state.startPage;
            var triageIndex = 0;

            function triageNext() {
                if (!State.isScraping()) {
                    self.finishScraping();
                    return;
                }

                if (triageIndex >= profiles.length) {
                    // Triage complete, filter to keep/maybe and start profile visits
                    var toVisit = profiles.filter(function(p) {
                        return p.aiDecision === 'keep' || p.aiDecision === 'maybe';
                    });

                    console.log('[LiSeSca] Triage complete: ' + toVisit.length + '/'
                        + profiles.length + ' profiles to visit.');

                    State.set(State.KEYS.PROFILES_ON_PAGE, JSON.stringify(profiles));
                    State.set(State.KEYS.PROFILE_INDEX, 0);

                    if (toVisit.length === 0) {
                        // No profiles passed triage, move to next page
                        self.decideNextActionDeep();
                        return;
                    }

                    self.processNextProfile();
                    return;
                }

                var profile = profiles[triageIndex];
                var statusMsg = 'Page ' + state.currentPage
                    + ' (' + (pagesScraped + 1) + ' of ' + state.targetPageCount + ')'
                    + ' — Triage ' + (triageIndex + 1) + ' of ' + profiles.length;

                UI.showStatus(statusMsg);
                UI.showAIStats(State.getAIPeopleEvaluated(), State.getAIPeopleAccepted(), '');

                if (!profile || !profile.profileUrl) {
                    console.warn('[LiSeSca] Profile missing URL, marking as reject.');
                    profile.aiDecision = 'reject';
                    profile.aiReason = 'No profile URL';
                    triageIndex++;
                    triageNext();
                    return;
                }

                var cardMarkdown = Extractor.formatCardForAI(profile);

                AIClient.triagePeopleCard(cardMarkdown).then(function(result) {
                    if (!State.isScraping()) {
                        return;
                    }

                    var decision = result.decision;
                    var reason = result.reason;

                    profile.aiDecision = decision;
                    profile.aiReason = reason;

                    State.incrementAIPeopleEvaluated();
                    UI.showAIStats(State.getAIPeopleEvaluated(), State.getAIPeopleAccepted(), '');

                    console.log('[LiSeSca] AI TRIAGE: ' + profile.fullName
                        + ' — ' + decision + ' — ' + reason);

                    triageIndex++;

                    // Small delay between triage calls
                    Emulator.randomDelay(200, 400).then(function() {
                        triageNext();
                    });
                }).catch(function(error) {
                    console.error('[LiSeSca] Triage error for ' + profile.fullName + ':', error);
                    // Fail-open: treat as keep
                    profile.aiDecision = 'keep';
                    profile.aiReason = 'Triage error';
                    triageIndex++;
                    triageNext();
                });
            }

            triageNext();
        },

        /**
         * Process the next profile in deep scrape mode (Pass 2).
         * Triage is already done; this navigates to keep/maybe profiles.
         */
        processNextProfile: function() {
            var self = this;

            if (!State.isScraping()) {
                console.log('[LiSeSca] Deep scraping stopped.');
                self.finishScraping();
                return;
            }

            var state = State.getScrapingState();
            var profiles = State.getProfilesOnPage();
            var profileIndex = State.get(State.KEYS.PROFILE_INDEX, 0);
            var pagesScraped = state.currentPage - state.startPage;

            // Find next profile that passed triage (keep or maybe)
            while (profileIndex < profiles.length) {
                var p = profiles[profileIndex];
                if (p && (p.aiDecision === 'keep' || p.aiDecision === 'maybe')) {
                    break;
                }
                // Skip rejected or invalid profiles
                profileIndex++;
            }

            State.set(State.KEYS.PROFILE_INDEX, profileIndex);

            if (profileIndex >= profiles.length) {
                console.log('[LiSeSca] All profiles processed on page ' + state.currentPage);
                self.decideNextActionDeep();
                return;
            }

            var profile = profiles[profileIndex];

            // Count how many keep/maybe profiles total
            var toVisitCount = profiles.filter(function(p) {
                return p && (p.aiDecision === 'keep' || p.aiDecision === 'maybe');
            }).length;

            // Count how many we've visited so far (index in keep/maybe list)
            var visitedCount = profiles.slice(0, profileIndex).filter(function(p) {
                return p && (p.aiDecision === 'keep' || p.aiDecision === 'maybe');
            }).length;

            var statusMsg = 'Page ' + state.currentPage
                + ' (' + (pagesScraped + 1) + ' of ' + state.targetPageCount + ')'
                + ' — Visiting ' + (visitedCount + 1) + ' of ' + toVisitCount;

            UI.showStatus(statusMsg);

            var aiEnabled = State.getPeopleAIEnabled() && AIClient.isPeopleConfigured();
            if (aiEnabled) {
                UI.showAIStats(State.getAIPeopleEvaluated(), State.getAIPeopleAccepted(), '');
            }

            if (!profile.profileUrl) {
                console.warn('[LiSeSca] Profile missing URL, skipping.');
                State.set(State.KEYS.PROFILE_INDEX, profileIndex + 1);
                Emulator.randomDelay(300, 600).then(function() {
                    self.processNextProfile();
                });
                return;
            }

            // Navigate to profile page
            State.set(State.KEYS.CURRENT_PROFILE_URL, profile.profileUrl);

            var decisionLabel = profile.aiDecision === 'keep' ? 'Keep' : 'Maybe';
            UI.showStatus(statusMsg + ' — ' + decisionLabel);

            console.log('[LiSeSca] Visiting profile: ' + profile.fullName
                + ' (' + profile.aiDecision + ')');

            window.location.href = profile.profileUrl;
        },

        /**
         * Handle a profile visit in deep scrape mode.
         * Extracts full profile data and returns to search results.
         */
        handleProfileVisit: function() {
            var self = this;
            State.getScrapingState();
            var profiles = State.getProfilesOnPage();
            var profileIndex = State.get(State.KEYS.PROFILE_INDEX, 0);
            var profile = profiles[profileIndex];

            if (!profile) {
                console.warn('[LiSeSca] No profile data found for current index.');
                this.returnToSearchPage();
                return;
            }

            // Count keep/maybe profiles for accurate progress display
            var toVisitCount = profiles.filter(function(p) {
                return p && (p.aiDecision === 'keep' || p.aiDecision === 'maybe');
            }).length;
            var visitedCount = profiles.slice(0, profileIndex).filter(function(p) {
                return p && (p.aiDecision === 'keep' || p.aiDecision === 'maybe');
            }).length;

            var statusMsg = 'Profile ' + (visitedCount + 1) + ' of ' + toVisitCount;
            UI.showStatus(statusMsg + ' — Loading profile...');

            ProfileExtractor.waitForProfileLoad().then(function() {
                if (!State.isScraping()) {
                    return null;
                }
                ProfileExtractor.clickShowMore();
                if (ProfileExtractor.isRestrictedProfile()) {
                    return { restricted: true };
                }
                return ProfileExtractor.extractFullProfile();
            }).then(function(fullProfile) {
                if (!State.isScraping()) {
                    return null;
                }

                if (!fullProfile || fullProfile.restricted) {
                    console.warn('[LiSeSca] Restricted or unavailable profile: ' + profile.profileUrl);
                    return 'skip';
                }

                var mergedProfile = self.mergeProfileData(profile, fullProfile);
                var decision = profile.aiDecision || 'keep';
                var aiEnabled = State.getPeopleAIEnabled() && AIClient.isPeopleConfigured();
                var fullAIEnabled = State.getPeopleFullAIEnabled();

                if (decision === 'maybe' && aiEnabled && fullAIEnabled) {
                    var profileMarkdown = ProfileExtractor.formatProfileForAI(mergedProfile);
                    UI.showStatus(statusMsg + ' — AI: Full evaluation...');
                    return AIClient.evaluateFullProfile(profileMarkdown).then(function(evalResult) {
                        if (!State.isScraping()) {
                            return null;
                        }

                        if (evalResult.accept) {
                            console.log('[LiSeSca] AI accepted profile after full review: '
                                + mergedProfile.fullName + ' - ' + evalResult.reason);
                            State.incrementAIPeopleAccepted();
                            UI.showAIStats(State.getAIPeopleEvaluated(), State.getAIPeopleAccepted(), '');
                            State.appendBuffer([mergedProfile]);
                        } else {
                            console.log('[LiSeSca] AI FULL REJECT: ' + mergedProfile.fullName);
                            console.log('  Profile: ' + mergedProfile.profileUrl);
                            console.log('  Reason: ' + evalResult.reason);
                        }
                        return 'done';
                    });
                }

                // Keep or Maybe (without full AI evaluation)
                if (aiEnabled) {
                    State.incrementAIPeopleAccepted();
                    UI.showAIStats(State.getAIPeopleEvaluated(), State.getAIPeopleAccepted(), '');
                    console.log('[LiSeSca] AI accepted profile: ' + mergedProfile.fullName
                        + ' — triage=' + decision);
                }
                State.appendBuffer([mergedProfile]);
                return 'done';
            }).then(function(result) {
                if (!State.isScraping()) {
                    return;
                }
                if (result === null) {
                    return;
                }

                State.set(State.KEYS.PROFILE_INDEX, profileIndex + 1);
                State.set(State.KEYS.CURRENT_PROFILE_URL, '');

                var delayMin = result === 'skip' ? 1500 : 3000;
                var delayMax = result === 'skip' ? 3000 : 8000;
                return Emulator.randomDelay(delayMin, delayMax).then(function() {
                    self.returnToSearchPage();
                });
            }).catch(function(error) {
                console.error('[LiSeSca] Error handling profile visit:', error);
                State.set(State.KEYS.PROFILE_INDEX, profileIndex + 1);
                State.set(State.KEYS.CURRENT_PROFILE_URL, '');
                Emulator.randomDelay(1500, 3000).then(function() {
                    self.returnToSearchPage();
                });
            });
        },

        /**
         * Merge card data with full profile data.
         * @param {Object} cardProfile - Profile data from search card.
         * @param {Object} fullProfile - Full profile data from profile page.
         * @returns {Object}
         */
        mergeProfileData: function(cardProfile, fullProfile) {
            return {
                fullName: fullProfile.fullName || cardProfile.fullName,
                headline: fullProfile.headline || cardProfile.description || '',
                description: cardProfile.description || '',
                location: fullProfile.location || cardProfile.location || '',
                profileUrl: fullProfile.profileUrl || cardProfile.profileUrl || '',
                connectionDegree: cardProfile.connectionDegree || 0,
                profileAbout: fullProfile.profileAbout || '',
                currentRole: fullProfile.currentRole || null,
                pastRoles: fullProfile.pastRoles || [],
                aiDecision: cardProfile.aiDecision || '',
                aiReason: cardProfile.aiReason || ''
            };
        },

        /**
         * Navigate back to the search results page.
         */
        returnToSearchPage: function() {
            var page = State.get(State.KEYS.CURRENT_PAGE, 1);
            UI.showStatus('Returning to search results...');
            Paginator.navigateToPage(page);
        },

        /**
         * Decide next action after finishing profiles on a page (deep mode).
         */
        decideNextActionDeep: function() {
            var state = State.getScrapingState();
            var pagesScraped = state.currentPage - state.startPage + 1;

            if (state.profilesOnPage.length === 0) {
                console.log('[LiSeSca] No results on page ' + state.currentPage + '. End of results.');
                this.finishScraping();
                return;
            }

            if (pagesScraped >= state.targetPageCount) {
                console.log('[LiSeSca] Reached target of ' + state.targetPageCount + ' pages.');
                this.finishScraping();
                return;
            }

            if (!State.isScraping()) {
                this.finishScraping();
                return;
            }

            State.advancePage();
            var nextPage = State.get(State.KEYS.CURRENT_PAGE, 1);
            State.set(State.KEYS.PROFILE_INDEX, 0);
            State.set(State.KEYS.PROFILES_ON_PAGE, JSON.stringify([]));

            UI.showStatus('Moving to page ' + nextPage + '...');
            setTimeout(function() {
                Paginator.navigateToPage(nextPage);
            }, Emulator.getRandomInt(1000, 2500));
        },

        /**
         * Decide next action after extracting a page.
         * @param {number} profilesOnThisPage - Number of profiles extracted.
         */
        decideNextAction: function(profilesOnThisPage) {
            var state = State.getScrapingState();
            var pagesScraped = state.currentPage - state.startPage + 1;

            if (profilesOnThisPage === 0) {
                console.log('[LiSeSca] No results on page ' + state.currentPage + '. End of results.');
                this.finishScraping();
                return;
            }

            if (pagesScraped >= state.targetPageCount) {
                console.log('[LiSeSca] Reached target of ' + state.targetPageCount + ' pages.');
                this.finishScraping();
                return;
            }

            if (!State.isScraping()) {
                console.log('[LiSeSca] Scraping stopped by user.');
                this.finishScraping();
                return;
            }

            State.advancePage();
            var nextPage = State.get(State.KEYS.CURRENT_PAGE, 1);
            UI.showStatus('Moving to page ' + nextPage + '...');

            setTimeout(function() {
                Paginator.navigateToPage(nextPage);
            }, Emulator.getRandomInt(1000, 2500));
        },

        /**
         * Complete the scraping session.
         */
        finishScraping: function() {
            var buffer = State.getBuffer();
            var totalProfiles = buffer.length;
            var aiEnabled = State.getPeopleAIEnabled();
            var aiEvaluated = State.getAIPeopleEvaluated();
            var aiAccepted = State.getAIPeopleAccepted();

            console.log('[LiSeSca] Scraping finished! Total: ' + totalProfiles + ' profiles.');
            if (aiEnabled && aiEvaluated > 0) {
                console.log('[LiSeSca] AI stats: ' + aiAccepted + '/' + aiEvaluated + ' accepted.');
            }

            UI.hideAIStats();

            if (totalProfiles > 0) {
                UI.showStatus('Done! ' + totalProfiles + ' profiles scraped. Downloading...');
                Output.downloadResults(buffer);
            } else {
                UI.showStatus('No profiles found.');
            }

            State.clear();
            setTimeout(function() {
                UI.showIdleState();
            }, 5000);
        },

        /**
         * Stop scraping (STOP button handler).
         */
        stopScraping: function() {
            console.log('[LiSeSca] Scraping stopped by user.');
            Emulator.cancel();
            State.set(State.KEYS.IS_SCRAPING, false);
            this.finishScraping();
        }
    };

    // ===== ENTRY POINT =====
    // Main entry for the LiSeSca userscript.
    // Imports all modules and initializes the controller.

    Controller.init();

})();
