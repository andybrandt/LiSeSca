// ==UserScript==
// @name         LiSeSca - LinkedIn Search Scraper
// @namespace    https://github.com/andybrandt/lisesca
// @version      0.3.5
// @description  Scrapes LinkedIn people search and job search results with human emulation
// @author       Andy Brandt
// @match        https://www.linkedin.com/search/results/people/*
// @match        https://www.linkedin.com/jobs/search/*
// @match        https://www.linkedin.com/jobs/collections/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @require      https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js
// @require      https://cdn.jsdelivr.net/npm/turndown@7.2.0/dist/turndown.js
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ===== CONFIGURATION =====
    // Default settings for the scraper. These can be overridden
    // by user preferences stored in Tampermonkey's persistent storage.
    const CONFIG = {
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


    // ===== CSS SELECTORS (PEOPLE SEARCH) =====
    // Resilient selectors based on data attributes and ARIA roles,
    // avoiding LinkedIn's generated CSS class names which change frequently.
    const Selectors = {
        RESULT_CARD: 'div[role="listitem"]',
        TITLE_LINK: 'a[data-view-name="search-result-lockup-title"]'
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

        // Right panel — detail view
        DETAIL_CONTAINER: '.jobs-search__job-details--container',
        DETAIL_TITLE: '.job-details-jobs-unified-top-card__job-title h1',
        DETAIL_COMPANY_NAME: '.job-details-jobs-unified-top-card__company-name a',
        DETAIL_PRIMARY_DESC: '.job-details-jobs-unified-top-card__primary-description-container',
        DETAIL_TERTIARY_DESC: '.job-details-jobs-unified-top-card__tertiary-description-container',
        DETAIL_FIT_PREFS: '.job-details-fit-level-preferences button',
        DETAIL_APPLY_BUTTON: '.jobs-apply-button',
        DETAIL_JOB_DESCRIPTION: '#job-details',
        DETAIL_SHOW_MORE: '.inline-show-more-text__button',

        // Premium sections
        DETAIL_PREMIUM_INSIGHTS: '.jobs-premium-applicant-insights',
        DETAIL_PREMIUM_AI_ASSESSMENT: '.job-details-module h2',

        // About the company
        DETAIL_ABOUT_COMPANY: '.jobs-company',
        DETAIL_COMPANY_INFO: '.jobs-company__inline-information',
        DETAIL_COMPANY_DESC: '.jobs-company__company-description',

        // People connections
        DETAIL_CONNECTIONS: '.job-details-people-who-can-help__connections-card-summary',

        // Pagination (jobs uses different classes than people search)
        PAGINATION: '.jobs-search-pagination__pages',
        PAGINATION_BUTTON: '.jobs-search-pagination__indicator-button'
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
            JOB_IDS_ON_PAGE: 'lisesca_jobIdsOnPage'   // JSON array of job IDs for current page
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
            console.log('[LiSeSca] Session state cleared.');
        }
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


    // ===== JOB DATA EXTRACTION =====
    // Extracts job data from the left-panel cards and right-panel detail view.
    // The flow is: click a card → wait for detail panel → extract all fields.
    const JobExtractor = {

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
         * This method reads those shell attributes directly (no scrolling needed).
         * @returns {Promise<Array<string>>} Array of all discovered job ID strings.
         */
        discoverAllJobIds: function() {
            // Read all job IDs from the outer <li> shell elements.
            // These are always present in the DOM regardless of scroll position.
            var listItems = document.querySelectorAll(JobSelectors.JOB_LIST_ITEM);
            var allIds = [];

            listItems.forEach(function(li) {
                var jobId = li.getAttribute('data-occludable-job-id');
                if (jobId && allIds.indexOf(jobId) === -1) {
                    allIds.push(jobId);
                }
            });

            console.log('[LiSeSca] Discovered ' + allIds.length + ' job IDs from list item shells.');

            // Fallback: if no occludable shells found, try rendered cards directly
            if (allIds.length === 0) {
                allIds = this.getJobIds();
                console.log('[LiSeSca] Fallback: found ' + allIds.length + ' job IDs from rendered cards.');
            }

            return Promise.resolve(allIds);
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

            return {
                jobId: jobId,
                jobTitle: jobTitle,
                company: company,
                location: location,
                directLink: directLink,
                cardInsight: insight
            };
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
            var card = document.querySelector('div[data-job-id="' + jobId + '"]');

            // If the inner card content is not rendered, we need to scroll
            // the outer <li> shell into view to trigger Ember rendering.
            if (!card) {
                console.log('[LiSeSca] Card not rendered for ' + jobId + ', scrolling shell into view...');
                var shell = document.querySelector('li[data-occludable-job-id="' + jobId + '"]');

                if (!shell) {
                    console.warn('[LiSeSca] No shell <li> found for job ' + jobId);
                    return Promise.resolve();
                }

                // Scroll the shell into view — this triggers Ember to render the inner content
                shell.scrollIntoView({ behavior: 'smooth', block: 'center' });

                // Poll for the inner div[data-job-id] to appear after Ember renders it
                var maxAttempts = 20;  // 20 * 200ms = 4 seconds max wait
                var attempt = 0;

                /**
                 * Poll until the inner card content is rendered by Ember.
                 * @returns {Promise<HTMLElement|null>} The rendered card, or null.
                 */
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
                    if (!renderedCard) {
                        // Last resort: try clicking the shell itself
                        console.log('[LiSeSca] Clicking shell <li> as fallback for ' + jobId);
                        shell.click();
                        return;
                    }
                    var titleLink = renderedCard.querySelector(JobSelectors.CARD_TITLE_LINK);
                    if (titleLink) {
                        titleLink.click();
                    } else {
                        renderedCard.click();
                    }
                    console.log('[LiSeSca] Clicked job card: ' + jobId);
                });
            }

            // Card is already in the DOM — click it directly
            var titleLink = card.querySelector(JobSelectors.CARD_TITLE_LINK);
            if (titleLink) {
                titleLink.click();
            } else {
                card.click();
            }

            console.log('[LiSeSca] Clicked job card: ' + jobId);
            return Promise.resolve();
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
                var cardData = card ? self.extractCardBasics(card) : { jobId: jobId };

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
                    jobDescription: jobDescription || '',
                    premiumInsights: premiumInsights || '',
                    aboutCompany: aboutCompany.description || ''
                };

                console.log('[LiSeSca] Extracted job: ' + job.jobTitle + ' at ' + job.company);
                return job;
            });
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


    // ===== PAGINATION (PEOPLE SEARCH) =====
    // Handles navigation between search result pages by manipulating the URL.
    const Paginator = {

        /**
         * Get the current page number from the URL.
         * @returns {number} Current page number (1-based).
         */
        getCurrentPage: function() {
            const url = new URL(window.location.href);
            const pageParam = url.searchParams.get('page');
            return pageParam ? parseInt(pageParam, 10) : 1;
        },

        /**
         * Get the base search URL without the page parameter.
         * @returns {string} The search URL with the page parameter removed.
         */
        getBaseSearchUrl: function() {
            const url = new URL(window.location.href);
            url.searchParams.delete('page');
            return url.toString();
        },

        /**
         * Navigate to a specific page number by modifying the URL.
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
            } else {
                const ordinal = this.toOrdinal(profile.connectionDegree);
                lines.push('Connection: ' + ordinal);
            }

            lines.push('Description: ' + (profile.description || '(none)'));
            lines.push('Location: ' + (profile.location || '(none)'));
            lines.push('Full profile URL: ' + (profile.profileUrl || '(none)'));

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

        COLUMN_HEADERS: ['Name', 'Title/Description', 'Location', 'LinkedIn URL', 'Connection degree'],

        /**
         * Convert a profile object into a row array.
         * @param {Object} profile - A profile data object.
         * @returns {Array<string|number>} Array of cell values.
         */
        profileToRow: function(profile) {
            return [
                profile.fullName || '',
                profile.description || '',
                profile.location || '',
                profile.profileUrl || '',
                profile.connectionDegree || 0
            ];
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

            var headerLine = this.COLUMN_HEADERS.map(function(header) {
                return self.escapeCSVField(header);
            }).join(',');
            lines.push(headerLine);

            profiles.forEach(function(profile) {
                var row = self.profileToRow(profile);
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
            var data = [this.COLUMN_HEADERS];
            profiles.forEach(function(profile) {
                data.push(self.profileToRow(profile));
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


    // ===== OUTPUT GENERATION (JOBS) =====
    // Formats scraped job data into XLSX and Markdown.
    // CSV is not offered for jobs because job data contains long text fields
    // (descriptions, company info) that are poorly suited to CSV format.
    const JobOutput = {

        /** Column headers for XLSX export */
        COLUMN_HEADERS: [
            'Job Title', 'Company', 'Location', 'Posted', 'Applicants',
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


    // ===== USER INTERFACE =====
    // Creates and manages the floating overlay panel with scrape controls.
    // Adapts to the current page type: green SCRAPE button for people search,
    // blue SCRAPE button for jobs search, with different page count options.
    const UI = {
        /** References to key DOM elements */
        panel: null,
        menu: null,
        statusArea: null,
        isMenuOpen: false,

        /**
         * Inject all LiSeSca styles into the page.
         */
        injectStyles: function() {
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
                options = [
                    { value: '1', text: '1' },
                    { value: '3', text: '3' },
                    { value: '5', text: '5' },
                    { value: '10', text: '10' }
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

            // GO button — dispatches to the correct controller
            var goBtn = document.createElement('button');
            goBtn.className = 'lisesca-go-btn';
            goBtn.textContent = 'GO';
            goBtn.addEventListener('click', function() {
                var pageSelect = document.getElementById('lisesca-page-select');
                var selectedValue = pageSelect.value;
                console.log('[LiSeSca] GO pressed, pages=' + selectedValue + ', pageType=' + pageType);

                if (isJobs) {
                    JobController.startScraping(selectedValue);
                } else {
                    Controller.startScraping(selectedValue);
                }
            });

            this.menu.appendChild(label);
            this.menu.appendChild(select);
            this.menu.appendChild(fmtLabel);
            this.menu.appendChild(fmtRow);
            this.menu.appendChild(goBtn);

            // --- Status area ---
            this.statusArea = document.createElement('div');
            this.statusArea.className = 'lisesca-status';

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
                    JobController.stopScraping();
                } else {
                    Controller.stopScraping();
                }
            });

            this.statusArea.appendChild(statusText);
            this.statusArea.appendChild(stopBtn);

            // --- Assemble panel ---
            this.panel.appendChild(topbar);
            this.panel.appendChild(this.menu);
            this.panel.appendChild(this.statusArea);

            document.body.appendChild(this.panel);
            console.log('[LiSeSca] UI panel injected (' + pageType + ' mode).');
        },

        /**
         * Toggle the dropdown menu open/closed.
         */
        toggleMenu: function() {
            this.isMenuOpen = !this.isMenuOpen;
            if (this.isMenuOpen) {
                this.menu.classList.add('lisesca-open');
            } else {
                this.menu.classList.remove('lisesca-open');
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
            this.menu.classList.remove('lisesca-open');
            this.isMenuOpen = false;
        },

        // --- Configuration panel ---
        configOverlay: null,

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
            panel.appendChild(pageSectionLabel);
            panel.appendChild(minRow);
            panel.appendChild(maxRow);
            panel.appendChild(jobSectionLabel);
            panel.appendChild(jobReviewMinRow);
            panel.appendChild(jobReviewMaxRow);
            panel.appendChild(jobPauseMinRow);
            panel.appendChild(jobPauseMaxRow);
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
        }
    };


    // ===== MAIN CONTROLLER (PEOPLE SEARCH) =====
    // Orchestrates the people search scraping lifecycle.
    const Controller = {

        /**
         * Initialize the script. Called once on every page load.
         * Dispatches to the correct controller based on page type and scrape mode.
         */
        init: function() {
            console.log('[LiSeSca] v' + CONFIG.VERSION + ' initializing...');

            CONFIG.load();

            UI.injectStyles();
            UI.createPanel();
            UI.createConfigPanel();

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
         * Resume an active people scraping session after a page reload.
         */
        resumeScraping: function() {
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

            State.startSession(target, startPage, baseUrl, 'people');
            State.saveFormats(selectedFormats);

            this.scrapeCycle();
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

            console.log('[LiSeSca] Scraping finished! Total: ' + totalProfiles + ' profiles.');

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

            var target = parseInt(pageCount, 10);
            var startPage = JobPaginator.getCurrentPage();
            var baseUrl = JobPaginator.getBaseSearchUrl();

            console.log('[LiSeSca] Starting job scrape: target=' + target
                + ' pages, starting at page ' + startPage);

            var selectedFormats = State.readFormatsFromUI();
            if (selectedFormats.length === 0) {
                selectedFormats = ['xlsx'];
            }

            State.startSession(target, startPage, baseUrl, 'jobs');
            State.saveFormats(selectedFormats);

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
            UI.showStatus(statusMsg);

            // Extract the full job data
            JobExtractor.extractFullJob(jobId).then(function(job) {
                if (!State.isScraping()) {
                    return;
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
            }).then(function() {
                if (!State.isScraping()) {
                    return;
                }

                // Advance to the next job
                State.set(State.KEYS.JOB_INDEX, jobIndex + 1);

                // Configurable pause between jobs
                return Emulator.randomDelay(
                    CONFIG.MIN_JOB_PAUSE * 1000,
                    CONFIG.MAX_JOB_PAUSE * 1000
                );
            }).then(function() {
                if (!State.isScraping()) {
                    self.finishScraping();
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

            console.log('[LiSeSca] Job scraping finished! Total: ' + totalJobs + ' jobs across '
                + pagesScraped + ' page(s).');

            if (totalJobs > 0) {
                UI.showStatus('Done! ' + totalJobs + ' jobs scraped across '
                    + pagesScraped + ' page(s). Downloading...');
                JobOutput.downloadResults(buffer);
            } else {
                UI.showStatus('No jobs found.');
            }

            State.clear();
            setTimeout(function() {
                UI.showIdleState();
            }, 5000);
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


    // ===== ENTRY POINT =====
    Controller.init();

})();
