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
            // Job-specific state keys
            SCRAPE_MODE: 'lisesca_scrapeMode',       // 'people' or 'jobs'
            JOB_INDEX: 'lisesca_jobIndex',            // current job index on page (0-based)
            JOB_IDS_ON_PAGE: 'lisesca_jobIdsOnPage',  // JSON array of job IDs for current page
            JOB_TOTAL: 'lisesca_jobTotal'             // total jobs count for "All" mode
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
                scrapeMode: this.getScrapeMode(),
                jobIndex: this.get(this.KEYS.JOB_INDEX, 0),
                jobIdsOnPage: this.getJobIdsOnPage()
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
         * Save selected export formats to persistent storage.
         * @param {Array<string>} formats - Array of format identifiers.
         */
        saveFormats: function(formats) {
            this.set(this.KEYS.FORMATS, JSON.stringify(formats));
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
            console.log('[LiSeSca] Session state cleared.');
        }
    };


