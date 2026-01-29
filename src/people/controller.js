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


