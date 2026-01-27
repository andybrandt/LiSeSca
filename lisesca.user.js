// ==UserScript==
// @name         LiSeSca - LinkedIn Search Scraper
// @namespace    https://github.com/andybrandt/lisesca
// @version      0.2.0
// @description  Scrapes LinkedIn people search results with human emulation
// @author       Andy Brandt
// @match        https://www.linkedin.com/search/results/people/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @require      https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ===== CONFIGURATION =====
    // Default settings for the scraper. These can be overridden
    // by user preferences stored in Tampermonkey's persistent storage.
    const CONFIG = {
        VERSION: '0.2.0',
        MIN_PAGE_TIME: 10,   // Minimum seconds to spend "scanning" each page
        MAX_PAGE_TIME: 40,   // Maximum seconds to spend "scanning" each page

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
                } catch (error) {
                    console.warn('[LiSeSca] Failed to parse saved config, using defaults:', error);
                }
            }
            console.log('[LiSeSca] Config loaded:', {
                MIN_PAGE_TIME: this.MIN_PAGE_TIME,
                MAX_PAGE_TIME: this.MAX_PAGE_TIME
            });
        },

        /**
         * Save the current configuration to persistent storage.
         */
        save: function() {
            const configData = JSON.stringify({
                MIN_PAGE_TIME: this.MIN_PAGE_TIME,
                MAX_PAGE_TIME: this.MAX_PAGE_TIME
            });
            GM_setValue('lisesca_config', configData);
            console.log('[LiSeSca] Config saved.');
        }
    };


    // ===== CSS SELECTORS =====
    // Resilient selectors based on data attributes and ARIA roles,
    // avoiding LinkedIn's generated CSS class names which change frequently.
    const Selectors = {
        RESULT_CARD: 'div[role="listitem"]',
        TITLE_LINK: 'a[data-view-name="search-result-lockup-title"]'
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
            FORMATS: 'lisesca_formats'
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
                formats: this.getFormats()
            };
        },

        /**
         * Initialize a new scraping session.
         * @param {number} targetPageCount - How many pages to scrape (9999 for "all").
         * @param {number} startPage - The page number where scraping begins.
         * @param {string} searchUrl - The base search URL (without page parameter).
         */
        startSession: function(targetPageCount, startPage, searchUrl) {
            this.set(this.KEYS.IS_SCRAPING, true);
            this.set(this.KEYS.CURRENT_PAGE, startPage);
            this.set(this.KEYS.TARGET_PAGE_COUNT, targetPageCount);
            this.set(this.KEYS.START_PAGE, startPage);
            this.set(this.KEYS.SEARCH_URL, searchUrl);
            this.set(this.KEYS.SCRAPED_BUFFER, JSON.stringify([]));
            console.log('[LiSeSca] Session started: pages=' + targetPageCount
                + ', startPage=' + startPage);
        },

        /**
         * Append newly extracted profiles to the persistent buffer.
         * This is the "data safety" strategy: after each page, we persist
         * the cumulative results. If the browser crashes, previous pages' data
         * is safe in Tampermonkey storage.
         * @param {Array} newProfiles - Array of profile objects from the current page.
         */
        appendBuffer: function(newProfiles) {
            const buffer = this.getBuffer();
            const updated = buffer.concat(newProfiles);
            this.set(this.KEYS.SCRAPED_BUFFER, JSON.stringify(updated));
            console.log('[LiSeSca] Buffer updated: ' + updated.length + ' total profiles.');
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
         * Get the current scraped profiles buffer.
         * @returns {Array} Array of profile objects.
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
            console.log('[LiSeSca] Session state cleared.');
        }
    };


    // ===== DATA EXTRACTION =====
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
         * DOM structure (verified from LinkedIn HTML examples):
         *   <div role="listitem">
         *     ...
         *       <p>
         *         <a data-view-name="search-result-lockup-title">Name</a>
         *         <span><span> • 2nd</span></span>
         *       </p>
         *       <div><p>Description (headline)</p></div>
         *       <div><p>Location</p></div>
         *     ...
         *   </div>
         * @param {HTMLElement} card - The listitem div element.
         * @returns {Object|null} Profile data object, or null if no title link found.
         */
        extractCard: function(card) {
            // Find the title link — this is our anchor point for all other data
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
         * Strips query parameters (tracking data) and keeps just the clean path.
         * Example: "https://www.linkedin.com/in/john-doe/?miniProfile=..." →
         *          "https://www.linkedin.com/in/john-doe/"
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
                // Return just the origin + pathname (no query string or hash)
                return url.origin + url.pathname;
            } catch (error) {
                // If URL parsing fails, return the raw URL as-is
                return rawUrl;
            }
        },

        /**
         * Extract the connection degree from the span sibling of the title link.
         * The degree text is inside a nested <span> within the same <p> as the
         * title link, formatted as " • 2nd", " • 1st", " • 3rd", etc.
         * @param {HTMLElement} titleLink - The <a> element.
         * @returns {number} The connection degree (1, 2, 3, etc.) or 0 if not found.
         */
        extractDegree: function(titleLink) {
            // The title link and degree span share the same parent <p>
            const titleParagraph = titleLink.parentElement;
            if (!titleParagraph) {
                return 0;
            }

            // Look for a nested span containing the degree text pattern
            const spans = titleParagraph.querySelectorAll('span span');
            for (let i = 0; i < spans.length; i++) {
                const text = spans[i].textContent || '';
                // Match patterns like "1st", "2nd", "3rd", or just a digit
                const match = text.match(/(\d+)(st|nd|rd|th)/);
                if (match) {
                    return parseInt(match[1], 10);
                }
            }
            return 0;
        },

        /**
         * Extract the description (headline) text from the first sibling <div>
         * after the title paragraph.
         * Structure: <p>(title)</p> → next sibling <div> → inner <p> = description
         * @param {HTMLElement} titleLink - The <a> element.
         * @returns {string} The description text, or empty string if not found.
         */
        extractDescription: function(titleLink) {
            const titleParagraph = titleLink.parentElement;
            if (!titleParagraph) {
                return '';
            }

            // Walk to the next sibling element (should be a <div> containing description)
            const descriptionDiv = titleParagraph.nextElementSibling;
            if (!descriptionDiv) {
                return '';
            }

            // The description is inside a <p> within this div
            const descParagraph = descriptionDiv.querySelector('p');
            if (!descParagraph) {
                return '';
            }

            return (descParagraph.textContent || '').trim();
        },

        /**
         * Extract the location text from the second sibling <div>
         * after the title paragraph.
         * Structure: <p>(title)</p> → sibling div (description) → next sibling div → inner <p> = location
         * @param {HTMLElement} titleLink - The <a> element.
         * @returns {string} The location text, or empty string if not found.
         */
        extractLocation: function(titleLink) {
            const titleParagraph = titleLink.parentElement;
            if (!titleParagraph) {
                return '';
            }

            // Walk past the description div to the location div
            const descriptionDiv = titleParagraph.nextElementSibling;
            if (!descriptionDiv) {
                return '';
            }

            const locationDiv = descriptionDiv.nextElementSibling;
            if (!locationDiv) {
                return '';
            }

            // The location is inside a <p> within this div
            const locParagraph = locationDiv.querySelector('p');
            if (!locParagraph) {
                return '';
            }

            return (locParagraph.textContent || '').trim();
        }
    };


    // ===== HUMAN EMULATION =====
    // Simulates human browsing behavior (scrolling, mouse movement, pauses)
    // to avoid triggering LinkedIn's bot detection.
    // The emulation sequence: scroll down gradually with random pauses,
    // dispatch fake mouse movement events, spend a realistic amount of time.
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
         * The coordinates drift gradually downward to simulate a user scanning
         * a list of search results. LinkedIn's bot-detection listeners receive
         * these events as if a real mouse moved.
         *
         * Events are dispatched on multiple targets: the document, the body,
         * and the main content area — to cover wherever LinkedIn may be listening.
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

            // Dispatch on document (catches document-level listeners)
            document.dispatchEvent(event);

            // Also dispatch on body and the main content area if available,
            // since LinkedIn may attach listeners at different DOM levels
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
         * LinkedIn's SPA may listen for scroll events on the window, document,
         * or a specific container element. We fire on all of them to ensure
         * LinkedIn's analytics and bot-detection code sees scrolling activity.
         */
        dispatchScrollEvent: function() {
            // Fire on window (most common scroll listener target)
            window.dispatchEvent(new Event('scroll', { bubbles: true }));

            // Fire on document
            document.dispatchEvent(new Event('scroll', { bubbles: true }));

            // Fire on the main content areas that LinkedIn might monitor
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
         * Run the full human emulation sequence.
         * Scrolls down the page gradually while dispatching mouse and scroll events,
         * taking between CONFIG.MIN_PAGE_TIME and CONFIG.MAX_PAGE_TIME seconds.
         *
         * The sequence:
         *   1. Calculate total emulation time (random between min and max).
         *   2. Divide the page into scroll steps.
         *   3. For each step: scroll a random amount, dispatch scroll + mouse events, pause.
         *   4. Insert 2-3 longer "reading" pauses at random points.
         *   5. Update the UI status with a countdown (piggybacking on existing steps).
         *
         * @param {string} statusPrefix - Text to show before the countdown (e.g. "Scanning page 3 (2 of 10)").
         * @returns {Promise<void>} Resolves when emulation is complete.
         */
        emulateHumanScan: function(statusPrefix) {
            this.cancelled = false;
            const self = this;

            // Total time to spend on this page (in milliseconds)
            const totalTimeMs = this.getRandomInt(
                CONFIG.MIN_PAGE_TIME * 1000,
                CONFIG.MAX_PAGE_TIME * 1000
            );
            const totalTimeSec = Math.round(totalTimeMs / 1000);

            // Calculate the total scrollable height of the page
            const pageHeight = document.documentElement.scrollHeight;
            const viewportHeight = window.innerHeight;
            const scrollableDistance = Math.max(pageHeight - viewportHeight, 0);

            // How many scroll steps to take (roughly one every 300-600ms)
            const averageStepMs = 450;
            const numberOfSteps = Math.max(Math.floor(totalTimeMs / averageStepMs), 10);

            // How much to scroll per step (with some randomness)
            const baseScrollPerStep = scrollableDistance / numberOfSteps;

            // Pick 2-3 random steps where we'll insert a longer "reading" pause
            const numberOfPauses = self.getRandomInt(2, 3);
            const pauseSteps = new Set();
            while (pauseSteps.size < numberOfPauses) {
                pauseSteps.add(self.getRandomInt(2, numberOfSteps - 2));
            }

            console.log('[LiSeSca] Emulation: ' + numberOfSteps + ' steps over ~'
                + totalTimeSec + 's, '
                + numberOfPauses + ' reading pauses.');

            // Record start time for the countdown display
            const startTimeMs = Date.now();

            // Show initial status with total duration
            const prefix = statusPrefix || 'Scanning';
            UI.showStatus(prefix + ' — ' + totalTimeSec + 's remaining');

            let currentScroll = 0;

            /**
             * Execute one scroll step, then schedule the next.
             * Uses a recursive Promise chain (not a loop) to allow
             * async pauses between steps without blocking the event loop.
             *
             * The countdown display is updated as part of each step,
             * so no additional timer is needed.
             * @param {number} step - Current step index (0-based).
             * @returns {Promise<void>}
             */
            function executeStep(step) {
                if (self.cancelled) {
                    console.log('[LiSeSca] Emulation cancelled.');
                    return Promise.resolve();
                }
                if (step >= numberOfSteps) {
                    // Final scroll to ensure we've reached the bottom
                    // (triggers lazy-loading of any remaining content)
                    window.scrollTo({ top: scrollableDistance, behavior: 'smooth' });
                    self.dispatchScrollEvent();
                    return Promise.resolve();
                }

                // Update the countdown in the UI (piggybacks on existing step,
                // no extra timer needed)
                const elapsedMs = Date.now() - startTimeMs;
                const remainingSec = Math.max(0, Math.round((totalTimeMs - elapsedMs) / 1000));
                UI.showStatus(prefix + ' — ' + remainingSec + 's remaining');

                // Scroll down by a random amount (roughly baseScrollPerStep ± 40%)
                const scrollAmount = baseScrollPerStep * (0.6 + Math.random() * 0.8);
                currentScroll = Math.min(currentScroll + scrollAmount, scrollableDistance);
                window.scrollTo({ top: currentScroll, behavior: 'smooth' });

                // Dispatch scroll events on all containers LinkedIn might monitor
                self.dispatchScrollEvent();

                // Dispatch a fake mouse movement at approximately the current scroll position
                const mouseY = self.getRandomInt(100, viewportHeight - 100);
                self.dispatchMouseMove(mouseY);

                // Determine the delay before the next step
                let delayMin = 200;
                let delayMax = 600;

                // If this is a "reading pause" step, linger longer (1-3 seconds)
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
         * The next step in the chain will check this flag and stop.
         */
        cancel: function() {
            this.cancelled = true;
        }
    };


    // ===== PAGINATION =====
    // Handles navigation between search result pages by manipulating the URL.
    // Instead of clicking the DOM "Next" button (fragile in an SPA),
    // we directly modify the URL's page parameter and force a full navigation.
    const Paginator = {

        /**
         * Get the current page number from the URL.
         * LinkedIn uses ?page=N as the pagination parameter.
         * If no page parameter exists, we're on page 1.
         * @returns {number} Current page number (1-based).
         */
        getCurrentPage: function() {
            const url = new URL(window.location.href);
            const pageParam = url.searchParams.get('page');
            return pageParam ? parseInt(pageParam, 10) : 1;
        },

        /**
         * Get the base search URL without the page parameter.
         * This is stored in state so we can reconstruct URLs for any page number.
         * @returns {string} The search URL with the page parameter removed.
         */
        getBaseSearchUrl: function() {
            const url = new URL(window.location.href);
            url.searchParams.delete('page');
            return url.toString();
        },

        /**
         * Navigate to a specific page number by modifying the URL.
         * This triggers a full page reload, which is intentional:
         * it clears browser memory and gives us a clean DOM for the next page.
         * @param {number} pageNum - The page number to navigate to.
         */
        navigateToPage: function(pageNum) {
            const baseUrl = State.get(State.KEYS.SEARCH_URL, this.getBaseSearchUrl());
            const url = new URL(baseUrl);
            url.searchParams.set('page', pageNum.toString());
            const targetUrl = url.toString();

            console.log('[LiSeSca] Navigating to page ' + pageNum + ': ' + targetUrl);
            window.location.href = targetUrl;
            // After this line, the page reloads and this script context is destroyed.
            // The state machine will resume in Controller.init() on the new page.
        }
    };


    // ===== OUTPUT GENERATION =====
    // Formats scraped data into multiple formats (XLSX, CSV, Markdown)
    // and triggers browser file downloads.
    // The browser cannot write directly to the user's disk, so we create
    // in-memory Blobs and trigger downloads via temporary <a> elements.
    // XLSX generation uses the SheetJS library loaded via @require.
    const Output = {

        /**
         * Format a single profile into the Markdown output format.
         * Format per specification:
         *   # Full Name
         *   Connection: 2nd (or "No connection." for degree 0)
         *   Description: ...
         *   Location: ...
         *   Full profile URL: ...
         *
         * @param {Object} profile - A profile data object.
         * @returns {string} The formatted Markdown block for this profile.
         */
        formatProfile: function(profile) {
            const lines = [];

            // Heading: full name
            lines.push('# ' + profile.fullName);
            lines.push('');

            // Connection degree
            if (profile.connectionDegree === 0) {
                lines.push('No connection.');
            } else {
                // Convert degree number to ordinal: 1 → "1st", 2 → "2nd", 3 → "3rd", etc.
                const ordinal = this.toOrdinal(profile.connectionDegree);
                lines.push('Connection: ' + ordinal);
            }

            // Description (headline)
            lines.push('Description: ' + (profile.description || '(none)'));

            // Location
            lines.push('Location: ' + (profile.location || '(none)'));

            // Profile URL
            lines.push('Full profile URL: ' + (profile.profileUrl || '(none)'));

            return lines.join('\n');
        },

        /**
         * Convert a number to its ordinal string (1 → "1st", 2 → "2nd", etc.).
         * @param {number} n - The number.
         * @returns {string} The ordinal string.
         */
        toOrdinal: function(n) {
            const suffixes = { 1: 'st', 2: 'nd', 3: 'rd' };
            // Special case: 11th, 12th, 13th
            const lastTwo = n % 100;
            if (lastTwo >= 11 && lastTwo <= 13) {
                return n + 'th';
            }
            const lastDigit = n % 10;
            return n + (suffixes[lastDigit] || 'th');
        },

        /**
         * Generate a complete Markdown document from an array of profiles.
         * Profiles are separated by horizontal rules (---).
         * @param {Array} profiles - Array of profile data objects.
         * @returns {string} The complete Markdown content.
         */
        generateMarkdown: function(profiles) {
            const blocks = profiles.map(function(profile) {
                return Output.formatProfile(profile);
            });
            // Join profile blocks with horizontal rules and blank lines
            return blocks.join('\n\n---\n\n') + '\n';
        },

        /**
         * Column headers used for CSV and XLSX exports.
         * The order here defines the column order in the output files.
         */
        COLUMN_HEADERS: ['Name', 'Title/Description', 'Location', 'LinkedIn URL', 'Connection degree'],

        /**
         * Convert a profile object into a row array matching COLUMN_HEADERS order.
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
         * All text fields are enclosed in double quotes. Any double quote
         * characters inside the value are escaped by doubling them ("").
         * @param {*} value - The cell value to escape.
         * @returns {string} The CSV-safe string.
         */
        escapeCSVField: function(value) {
            var str = String(value);
            // Replace any " with "" and wrap in quotes
            return '"' + str.replace(/"/g, '""') + '"';
        },

        /**
         * Generate a CSV string from an array of profiles.
         * Uses RFC 4180 conventions: CRLF line endings, all fields quoted.
         * @param {Array} profiles - Array of profile data objects.
         * @returns {string} The complete CSV content.
         */
        generateCSV: function(profiles) {
            var self = this;
            var lines = [];

            // Header row
            var headerLine = this.COLUMN_HEADERS.map(function(header) {
                return self.escapeCSVField(header);
            }).join(',');
            lines.push(headerLine);

            // Data rows
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
         * Generate an XLSX file as a Uint8Array using the SheetJS library.
         * Builds a workbook with one sheet named "LinkedIn Search" containing
         * the header row and all profile data.
         * @param {Array} profiles - Array of profile data objects.
         * @returns {Uint8Array} The binary XLSX file content.
         */
        generateXLSX: function(profiles) {
            var self = this;

            // Build a 2D array: header row + data rows
            var data = [this.COLUMN_HEADERS];
            profiles.forEach(function(profile) {
                data.push(self.profileToRow(profile));
            });

            // Create worksheet from the 2D array
            var worksheet = XLSX.utils.aoa_to_sheet(data);

            // Create workbook and add the worksheet
            var workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'LinkedIn Search');

            // Write to binary array
            var xlsxData = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
            return new Uint8Array(xlsxData);
        },

        /**
         * Generate a filename based on the current date and time.
         * Format: linkedin-search-YYYY-MM-DD-HHhMM.<extension>
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
         * Creates an in-memory Blob, generates a temporary object URL,
         * and simulates a click on a hidden <a> element to start the download.
         * Content can be a string (for text formats) or a Uint8Array (for binary formats).
         * @param {string|Uint8Array} content - The file content.
         * @param {string} filename - The desired filename.
         * @param {string} mimeType - The MIME type for the Blob (default: 'text/markdown;charset=utf-8').
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

            // Clean up the temporary elements after a short delay
            setTimeout(function() {
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
            }, 1000);

            console.log('[LiSeSca] File download triggered: ' + filename);
        },

        /**
         * Generate output files in the selected formats and trigger downloads.
         * Reads the format selection from persistent state (not from the DOM,
         * since the UI checkboxes do not survive page reloads).
         * Downloads are staggered by 200ms to prevent browsers from blocking
         * multiple simultaneous download prompts.
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

            // XLSX format
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

            // CSV format
            if (formats.indexOf('csv') !== -1) {
                setTimeout(function() {
                    var csvContent = self.generateCSV(profiles);
                    var csvFilename = self.buildFilename('csv');
                    self.downloadFile(csvContent, csvFilename, 'text/csv;charset=utf-8');
                }, delayMs);
                delayMs += 200;
            }

            // Markdown format
            if (formats.indexOf('md') !== -1) {
                setTimeout(function() {
                    var markdown = self.generateMarkdown(profiles);
                    var mdFilename = self.buildFilename('md');
                    self.downloadFile(markdown, mdFilename, 'text/markdown;charset=utf-8');
                }, delayMs);
            }
        }
    };


    // ===== USER INTERFACE =====
    // Creates and manages the floating overlay panel with scrape controls.
    const UI = {
        /** References to key DOM elements */
        panel: null,
        menu: null,
        statusArea: null,
        isMenuOpen: false,

        /**
         * Inject all LiSeSca styles into the page.
         * Uses GM_addStyle to add a <style> block with lisesca- prefixed classes.
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

                /* The main SCRAPE button */
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
                    accent-color: #58a6ff;
                    cursor: pointer;
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
         * Build and inject the entire floating panel into the page DOM.
         * The panel has three sections:
         *   1. Top bar — SCRAPE button + gear icon (always visible)
         *   2. Menu — page selector + GO button (toggleable)
         *   3. Status — progress text + stop button (shown during scraping)
         */
        createPanel: function() {
            // Create the main container
            this.panel = document.createElement('div');
            this.panel.className = 'lisesca-panel';

            // --- Top bar ---
            const topbar = document.createElement('div');
            topbar.className = 'lisesca-topbar';

            // SCRAPE button — toggles the dropdown menu
            const scrapeBtn = document.createElement('button');
            scrapeBtn.className = 'lisesca-scrape-btn';
            scrapeBtn.textContent = 'SCRAPE';
            scrapeBtn.addEventListener('click', () => this.toggleMenu());

            // Gear icon — opens configuration (Phase 6)
            const gearBtn = document.createElement('button');
            gearBtn.className = 'lisesca-gear-btn';
            gearBtn.innerHTML = '&#9881;';  // Unicode gear character
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
            const label = document.createElement('div');
            label.className = 'lisesca-menu-label';
            label.textContent = 'Pages to scrape:';

            // Page count selector
            const select = document.createElement('select');
            select.className = 'lisesca-select';
            select.id = 'lisesca-page-select';
            const options = [
                { value: '1', text: '1' },
                { value: '10', text: '10' },
                { value: '50', text: '50' },
                { value: 'all', text: 'All' }
            ];
            options.forEach(function(opt) {
                const option = document.createElement('option');
                option.value = opt.value;
                option.textContent = opt.text;
                select.appendChild(option);
            });

            // --- Format selection checkboxes ---
            const fmtLabel = document.createElement('div');
            fmtLabel.className = 'lisesca-fmt-label';
            fmtLabel.textContent = 'Save as:';

            const fmtRow = document.createElement('div');
            fmtRow.className = 'lisesca-fmt-row';

            // XLSX checkbox (checked by default)
            const xlsxLabel = document.createElement('label');
            xlsxLabel.className = 'lisesca-checkbox-label';
            const xlsxCheck = document.createElement('input');
            xlsxCheck.type = 'checkbox';
            xlsxCheck.id = 'lisesca-fmt-xlsx';
            xlsxCheck.checked = true;
            xlsxLabel.appendChild(xlsxCheck);
            xlsxLabel.appendChild(document.createTextNode('XLSX'));

            // CSV checkbox (unchecked by default)
            const csvLabel = document.createElement('label');
            csvLabel.className = 'lisesca-checkbox-label';
            const csvCheck = document.createElement('input');
            csvCheck.type = 'checkbox';
            csvCheck.id = 'lisesca-fmt-csv';
            csvCheck.checked = false;
            csvLabel.appendChild(csvCheck);
            csvLabel.appendChild(document.createTextNode('CSV'));

            // Markdown checkbox (unchecked by default)
            const mdLabel = document.createElement('label');
            mdLabel.className = 'lisesca-checkbox-label';
            const mdCheck = document.createElement('input');
            mdCheck.type = 'checkbox';
            mdCheck.id = 'lisesca-fmt-md';
            mdCheck.checked = false;
            mdLabel.appendChild(mdCheck);
            mdLabel.appendChild(document.createTextNode('Markdown'));

            fmtRow.appendChild(xlsxLabel);
            fmtRow.appendChild(csvLabel);
            fmtRow.appendChild(mdLabel);

            // GO button — starts the scraping process
            const goBtn = document.createElement('button');
            goBtn.className = 'lisesca-go-btn';
            goBtn.textContent = 'GO';
            goBtn.addEventListener('click', function() {
                const pageSelect = document.getElementById('lisesca-page-select');
                const selectedValue = pageSelect.value;
                console.log('[LiSeSca] GO pressed, pages=' + selectedValue);
                Controller.startScraping(selectedValue);
            });

            this.menu.appendChild(label);
            this.menu.appendChild(select);
            this.menu.appendChild(fmtLabel);
            this.menu.appendChild(fmtRow);
            this.menu.appendChild(goBtn);

            // --- Status area (hidden initially, used during scraping) ---
            this.statusArea = document.createElement('div');
            this.statusArea.className = 'lisesca-status';

            const statusText = document.createElement('div');
            statusText.id = 'lisesca-status-text';
            statusText.textContent = 'Initializing...';

            const stopBtn = document.createElement('button');
            stopBtn.className = 'lisesca-stop-btn';
            stopBtn.textContent = 'STOP';
            stopBtn.addEventListener('click', function() {
                Controller.stopScraping();
            });

            this.statusArea.appendChild(statusText);
            this.statusArea.appendChild(stopBtn);

            // --- Assemble panel ---
            this.panel.appendChild(topbar);
            this.panel.appendChild(this.menu);
            this.panel.appendChild(this.statusArea);

            // Inject into the page
            document.body.appendChild(this.panel);
            console.log('[LiSeSca] UI panel injected.');
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
         * Show a status message in the status area (used during scraping).
         * Hides the dropdown menu and shows the status section instead.
         * @param {string} message - The status text to display.
         */
        showStatus: function(message) {
            this.menu.classList.remove('lisesca-open');
            this.isMenuOpen = false;
            this.statusArea.classList.add('lisesca-visible');
            document.getElementById('lisesca-status-text').textContent = message;
        },

        /**
         * Hide the status area and return to idle state.
         */
        hideStatus: function() {
            this.statusArea.classList.remove('lisesca-visible');
        },

        /**
         * Switch the panel into "idle" mode — show SCRAPE button, hide status.
         */
        showIdleState: function() {
            this.hideStatus();
            this.menu.classList.remove('lisesca-open');
            this.isMenuOpen = false;
        },

        // --- Configuration panel ---

        /** Reference to the config overlay element */
        configOverlay: null,

        /**
         * Create the configuration panel overlay.
         * This is a modal dialog with input fields for MIN/MAX page time.
         * Created once and toggled visible/hidden as needed.
         */
        createConfigPanel: function() {
            // Overlay backdrop
            this.configOverlay = document.createElement('div');
            this.configOverlay.className = 'lisesca-config-overlay';

            // Panel container
            const panel = document.createElement('div');
            panel.className = 'lisesca-config-panel';

            // Title
            const title = document.createElement('div');
            title.className = 'lisesca-config-title';
            title.textContent = 'LiSeSca Configuration';

            // MIN_PAGE_TIME input
            const minRow = document.createElement('div');
            minRow.className = 'lisesca-config-row';

            const minLabel = document.createElement('label');
            minLabel.textContent = 'Minimum page time (seconds):';
            minLabel.htmlFor = 'lisesca-config-min';

            const minInput = document.createElement('input');
            minInput.type = 'number';
            minInput.id = 'lisesca-config-min';
            minInput.min = '5';
            minInput.max = '30';
            minInput.value = CONFIG.MIN_PAGE_TIME.toString();

            minRow.appendChild(minLabel);
            minRow.appendChild(minInput);

            // MAX_PAGE_TIME input
            const maxRow = document.createElement('div');
            maxRow.className = 'lisesca-config-row';

            const maxLabel = document.createElement('label');
            maxLabel.textContent = 'Maximum page time (seconds):';
            maxLabel.htmlFor = 'lisesca-config-max';

            const maxInput = document.createElement('input');
            maxInput.type = 'number';
            maxInput.id = 'lisesca-config-max';
            maxInput.min = '15';
            maxInput.max = '120';
            maxInput.value = CONFIG.MAX_PAGE_TIME.toString();

            maxRow.appendChild(maxLabel);
            maxRow.appendChild(maxInput);

            // Error message area
            const errorDiv = document.createElement('div');
            errorDiv.className = 'lisesca-config-error';
            errorDiv.id = 'lisesca-config-error';

            // Buttons row
            const buttonsRow = document.createElement('div');
            buttonsRow.className = 'lisesca-config-buttons';

            const saveBtn = document.createElement('button');
            saveBtn.className = 'lisesca-config-save';
            saveBtn.textContent = 'Save';
            saveBtn.addEventListener('click', function() {
                UI.saveConfig();
            });

            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'lisesca-config-cancel';
            cancelBtn.textContent = 'Cancel';
            cancelBtn.addEventListener('click', function() {
                UI.hideConfig();
            });

            buttonsRow.appendChild(saveBtn);
            buttonsRow.appendChild(cancelBtn);

            // Assemble the panel
            panel.appendChild(title);
            panel.appendChild(minRow);
            panel.appendChild(maxRow);
            panel.appendChild(errorDiv);
            panel.appendChild(buttonsRow);

            this.configOverlay.appendChild(panel);

            // Close on clicking the overlay backdrop (outside the panel)
            this.configOverlay.addEventListener('click', function(event) {
                if (event.target === UI.configOverlay) {
                    UI.hideConfig();
                }
            });

            document.body.appendChild(this.configOverlay);
        },

        /**
         * Show the configuration panel with current values loaded into inputs.
         */
        showConfig: function() {
            document.getElementById('lisesca-config-min').value = CONFIG.MIN_PAGE_TIME.toString();
            document.getElementById('lisesca-config-max').value = CONFIG.MAX_PAGE_TIME.toString();
            document.getElementById('lisesca-config-error').textContent = '';
            this.configOverlay.classList.add('lisesca-visible');
        },

        /**
         * Hide the configuration panel without saving.
         */
        hideConfig: function() {
            this.configOverlay.classList.remove('lisesca-visible');
        },

        /**
         * Validate and save the configuration from the panel inputs.
         * Validation rules:
         *   - MIN must be between 5 and 30
         *   - MAX must be between 15 and 120
         *   - MAX must be greater than MIN
         */
        saveConfig: function() {
            const minInput = document.getElementById('lisesca-config-min');
            const maxInput = document.getElementById('lisesca-config-max');
            const errorDiv = document.getElementById('lisesca-config-error');

            const minVal = parseInt(minInput.value, 10);
            const maxVal = parseInt(maxInput.value, 10);

            // Validation
            if (isNaN(minVal) || isNaN(maxVal)) {
                errorDiv.textContent = 'Please enter valid numbers.';
                return;
            }
            if (minVal < 5 || minVal > 30) {
                errorDiv.textContent = 'Minimum page time must be between 5 and 30 seconds.';
                return;
            }
            if (maxVal < 15 || maxVal > 120) {
                errorDiv.textContent = 'Maximum page time must be between 15 and 120 seconds.';
                return;
            }
            if (maxVal <= minVal) {
                errorDiv.textContent = 'Maximum must be greater than minimum.';
                return;
            }

            // Save to CONFIG and persist
            CONFIG.MIN_PAGE_TIME = minVal;
            CONFIG.MAX_PAGE_TIME = maxVal;
            CONFIG.save();

            console.log('[LiSeSca] Config updated: MIN=' + minVal + 's, MAX=' + maxVal + 's');
            this.hideConfig();
        }
    };


    // ===== MAIN CONTROLLER =====
    // Orchestrates the entire scraping lifecycle as a state machine.
    // On page load, it checks for an active scraping session and either
    // resumes the scrape cycle or shows the idle UI.
    //
    // State machine lifecycle:
    //   Page Load → Check isScraping?
    //     YES → Resume scrapeCycle (emulate → extract → buffer → next page or finish)
    //     NO  → Show idle UI (SCRAPE button)
    const Controller = {

        /**
         * Initialize the script. Called once on every page load.
         * Sets up the UI and checks if we need to resume a scraping session.
         */
        init: function() {
            console.log('[LiSeSca] v' + CONFIG.VERSION + ' initializing...');

            // Load user configuration from persistent storage
            CONFIG.load();

            // Inject CSS and create the floating panel + config overlay
            UI.injectStyles();
            UI.createPanel();
            UI.createConfigPanel();

            // Check if we have an active scraping session to resume
            if (State.isScraping()) {
                this.resumeScraping();
            } else {
                console.log('[LiSeSca] Ready. Click SCRAPE to begin.');
            }
        },

        /**
         * Resume an active scraping session after a page reload.
         * Validates the stored state and continues the scrape cycle.
         */
        resumeScraping: function() {
            const state = State.getScrapingState();
            const pagesScraped = state.currentPage - state.startPage;
            console.log('[LiSeSca] Resuming scraping session. Page '
                + state.currentPage + ', ' + pagesScraped + ' pages done so far, '
                + state.scrapedBuffer.length + ' profiles buffered.');

            this.scrapeCycle();
        },

        /**
         * Called when the GO button is pressed to start a new scraping session.
         * Initializes the state machine and begins the first scrape cycle.
         * @param {string} pageCount - Number of pages to scrape ('1', '10', '50', 'all').
         */
        startScraping: function(pageCount) {
            // Convert the page count selection to a numeric target
            // "all" maps to a large sentinel value (9999)
            const target = (pageCount === 'all') ? 9999 : parseInt(pageCount, 10);
            const startPage = Paginator.getCurrentPage();
            const baseUrl = Paginator.getBaseSearchUrl();

            console.log('[LiSeSca] Starting new scrape: target=' + target
                + ' pages, starting at page ' + startPage);

            // Save selected export formats before the session starts
            // (the UI checkboxes will not survive page reloads)
            var selectedFormats = State.readFormatsFromUI();
            if (selectedFormats.length === 0) {
                selectedFormats = ['xlsx'];  // Ensure at least one format
            }

            // Initialize the persistent session state
            State.startSession(target, startPage, baseUrl);
            State.saveFormats(selectedFormats);

            console.log('[LiSeSca] Export formats: ' + selectedFormats.join(', '));

            // Begin the scrape cycle
            this.scrapeCycle();
        },

        /**
         * The core scraping cycle. Runs once per page.
         * Sequence: show status → emulate human → extract data → buffer → decide next action.
         */
        scrapeCycle: function() {
            const state = State.getScrapingState();
            const pagesScraped = state.currentPage - state.startPage;
            const targetDisplay = (state.targetPageCount >= 9999)
                ? 'all' : state.targetPageCount.toString();

            // Build a status prefix for the emulation countdown display
            const statusPrefix = 'Scanning page ' + state.currentPage
                + ' (' + (pagesScraped + 1) + ' of ' + targetDisplay + ')';

            const self = this;

            // Step 1: Emulate human scanning behavior (status prefix is passed
            // so the emulator can show a countdown without extra timers)
            Emulator.emulateHumanScan(statusPrefix).then(function() {
                // Check if user pressed STOP during emulation
                if (!State.isScraping()) {
                    console.log('[LiSeSca] Scraping was stopped during emulation.');
                    return;
                }

                UI.showStatus('Extracting page ' + state.currentPage + '...');

                // Step 2: Extract profile data from the current page
                return Extractor.extractCurrentPage();
            }).then(function(profiles) {
                // If scraping was stopped, profiles will be undefined
                if (!profiles) {
                    return;
                }

                console.log('[LiSeSca] Page ' + state.currentPage
                    + ': extracted ' + profiles.length + ' profiles.');

                // Display a summary table in the console
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

                // Step 3: Append to the persistent buffer (data safety)
                State.appendBuffer(profiles);

                // Step 4: Decide whether to continue or finish
                self.decideNextAction(profiles.length);

            }).catch(function(error) {
                console.error('[LiSeSca] Scrape cycle error:', error);
                UI.showStatus('Error: ' + error.message);

                // On error, stop the session and download whatever we have so far
                const buffer = State.getBuffer();
                if (buffer.length > 0) {
                    console.log('[LiSeSca] ' + buffer.length + ' profiles in buffer despite error. Downloading...');
                    Output.downloadResults(buffer);
                }
                State.clear();
                setTimeout(function() {
                    UI.showIdleState();
                }, 5000);
            });
        },

        /**
         * Decide whether to continue scraping the next page or finish.
         * Conditions to stop:
         *   - We've scraped the target number of pages
         *   - The current page had 0 results (end of search results)
         *   - User pressed STOP
         * @param {number} profilesOnThisPage - Number of profiles extracted from this page.
         */
        decideNextAction: function(profilesOnThisPage) {
            const state = State.getScrapingState();
            const pagesScraped = state.currentPage - state.startPage + 1;

            // Condition 1: No results on this page → end of search results
            if (profilesOnThisPage === 0) {
                console.log('[LiSeSca] No results on page ' + state.currentPage
                    + '. End of search results.');
                this.finishScraping();
                return;
            }

            // Condition 2: Reached the target page count
            if (pagesScraped >= state.targetPageCount) {
                console.log('[LiSeSca] Reached target of ' + state.targetPageCount + ' pages.');
                this.finishScraping();
                return;
            }

            // Condition 3: User pressed STOP
            if (!State.isScraping()) {
                console.log('[LiSeSca] Scraping stopped by user.');
                this.finishScraping();
                return;
            }

            // Otherwise: advance to the next page
            State.advancePage();
            const nextPage = State.get(State.KEYS.CURRENT_PAGE, 1);
            UI.showStatus('Moving to page ' + nextPage + '...');

            // Brief delay before navigating (makes it look more natural)
            setTimeout(function() {
                Paginator.navigateToPage(nextPage);
                // Page will reload → Controller.init() → resumeScraping()
            }, Emulator.getRandomInt(1000, 2500));
        },

        /**
         * Complete the scraping session.
         * Logs the final results, triggers download (Phase 5), and clears state.
         */
        finishScraping: function() {
            const buffer = State.getBuffer();
            const totalProfiles = buffer.length;

            console.log('[LiSeSca] Scraping finished! Total: ' + totalProfiles + ' profiles.');

            if (totalProfiles > 0) {
                console.log('[LiSeSca] Full results:', buffer);
                UI.showStatus('Done! ' + totalProfiles + ' profiles scraped. Downloading...');

                // Generate and download the Markdown file
                Output.downloadResults(buffer);
            } else {
                UI.showStatus('No profiles found.');
            }

            // Clear the session state
            State.clear();

            // Return to idle after a brief delay
            setTimeout(function() {
                UI.showIdleState();
            }, 5000);
        },

        /**
         * Called when the STOP button is pressed during scraping.
         * Cancels emulation, marks session as stopped, and finishes.
         */
        stopScraping: function() {
            console.log('[LiSeSca] Scraping stopped by user.');
            Emulator.cancel();
            State.set(State.KEYS.IS_SCRAPING, false);
            this.finishScraping();
        }
    };


    // ===== ENTRY POINT =====
    Controller.init();

})();
