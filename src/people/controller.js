// ===== MAIN CONTROLLER (PEOPLE SEARCH) =====
// Orchestrates the people search scraping lifecycle.
// Also handles SPA navigation detection and UI lifecycle.
import { CONFIG } from '../shared/config.js';
import { State } from '../shared/state.js';
import { PageDetector } from '../shared/page-detector.js';
import { SpaHandler } from '../shared/spa-handler.js';
import { UI, setControllers } from '../ui/ui.js';
import { Emulator } from './emulator.js';
import { Extractor } from './extractor.js';
import { Paginator } from './paginator.js';
import { Output } from './output.js';
import { JobController } from '../jobs/controller.js';

export const Controller = {

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

        if (pageType === 'unknown') {
            console.log('[LiSeSca] Not on a supported page. UI hidden, waiting for navigation.');
            return;
        }

        // Create UI panels for the current page type
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
