// ===== MAIN CONTROLLER (PEOPLE SEARCH) =====
// Orchestrates the people search scraping lifecycle.
// Also handles SPA navigation detection and UI lifecycle.
import { CONFIG } from '../shared/config.js';
import { State } from '../shared/state.js';
import { PageDetector } from '../shared/page-detector.js';
import { SpaHandler } from '../shared/spa-handler.js';
import { AIClient } from '../shared/ai-client.js';
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
        if (!CONFIG.isPeopleAIConfigured()) {
            aiEnabled = false;
        }
        State.savePeopleAIEnabled(aiEnabled);

        State.startSession(target, startPage, baseUrl, 'people');
        State.saveFormats(selectedFormats);

        if (aiEnabled) {
            AIClient.resetPeopleConversation();
        }

        this.scrapeCycle();
    },

    /**
     * The core scraping cycle. Runs once per page.
     * If AI is enabled, scores each profile and filters by score >= 3.
     */
    scrapeCycle: function() {
        var state = State.getScrapingState();
        var pagesScraped = state.currentPage - state.startPage;
        var targetDisplay = (state.targetPageCount >= 9999)
            ? 'all' : state.targetPageCount.toString();

        var statusPrefix = 'Scanning page ' + state.currentPage
            + ' (' + (pagesScraped + 1) + ' of ' + targetDisplay + ')';

        var self = this;
        var aiEnabled = State.getPeopleAIEnabled() && AIClient.isPeopleConfigured();

        // Reset AI conversation for each page (conversation history is lost on page reload)
        if (aiEnabled) {
            AIClient.resetPeopleConversation();
        }

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

            if (profiles.length === 0) {
                self.decideNextAction(0);
                return;
            }

            if (aiEnabled) {
                // Score profiles with AI
                return self.scoreProfiles(profiles, state);
            } else {
                // No AI: save all profiles
                if (profiles.length > 0) {
                    console.table(profiles.map(function(p) {
                        return {
                            name: p.fullName,
                            degree: p.connectionDegree,
                            description: (p.description || '').substring(0, 50),
                            location: p.location
                        };
                    }));
                }
                State.appendBuffer(profiles);
                self.decideNextAction(profiles.length);
            }

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
     * Score all profiles on the page using AI.
     * Only saves profiles with score >= 3.
     * If AI fails, falls back to saving all profiles with "unavailable" rating.
     * @param {Array} profiles - Array of profile card data.
     * @param {Object} state - Current scraping state.
     */
    scoreProfiles: function(profiles, state) {
        var self = this;
        var scoreIndex = 0;
        var pagesScraped = state.currentPage - state.startPage;
        var savedCount = 0;
        var aiFailureCount = 0;
        var consecutiveFailures = 0;
        var aiDisabled = false; // Flag to disable AI after too many failures

        function scoreNext() {
            if (!State.isScraping()) {
                self.finishScraping();
                return;
            }

            if (scoreIndex >= profiles.length) {
                // Scoring complete
                console.log('[LiSeSca] Scoring complete: ' + savedCount + '/'
                    + profiles.length + ' profiles saved.');
                if (aiFailureCount > 0) {
                    console.log('[LiSeSca] AI failures: ' + aiFailureCount + ' profiles saved without rating.');
                }

                self.decideNextAction(profiles.length);
                return;
            }

            var profile = profiles[scoreIndex];
            var statusMsg = 'Page ' + state.currentPage
                + ' (' + (pagesScraped + 1) + ' of ' + state.targetPageCount + ')'
                + ' — Scoring ' + (scoreIndex + 1) + ' of ' + profiles.length;

            if (aiDisabled) {
                statusMsg += ' (AI unavailable)';
            }

            UI.showStatus(statusMsg);
            UI.showAIStats(State.getAIPeopleEvaluated(), State.getAIPeopleAccepted(), '');

            if (!profile || !profile.profileUrl) {
                console.warn('[LiSeSca] Profile missing URL, skipping.');
                scoreIndex++;
                scoreNext();
                return;
            }

            // If AI is disabled due to failures, save profile without rating
            if (aiDisabled) {
                profile.aiScore = '';
                profile.aiLabel = 'AI unavailable';
                profile.aiReason = 'AI service not responding';
                State.appendBuffer([profile]);
                savedCount++;
                aiFailureCount++;
                scoreIndex++;
                // Continue without delay since no AI call
                scoreNext();
                return;
            }

            var cardMarkdown = Extractor.formatCardForAI(profile);

            AIClient.scorePeopleCard(cardMarkdown).then(function(result) {
                if (!State.isScraping()) {
                    return;
                }

                var score = result.score;
                var label = result.label;
                var reason = result.reason;

                // Reset consecutive failures on success
                consecutiveFailures = 0;

                State.incrementAIPeopleEvaluated();

                console.log('[LiSeSca] AI SCORE: ' + profile.fullName
                    + ' — ' + score + '/5 (' + label + ') — ' + reason);

                // Save profile if score >= 3
                if (score >= 3) {
                    profile.aiScore = score;
                    profile.aiLabel = label;
                    profile.aiReason = reason;
                    State.appendBuffer([profile]);
                    State.incrementAIPeopleAccepted();
                    savedCount++;
                }

                UI.showAIStats(State.getAIPeopleEvaluated(), State.getAIPeopleAccepted(), '');

                scoreIndex++;

                // Small delay between scoring calls
                Emulator.randomDelay(200, 400).then(function() {
                    scoreNext();
                });
            }).catch(function(error) {
                console.error('[LiSeSca] Scoring error for ' + profile.fullName + ':', error);

                consecutiveFailures++;
                aiFailureCount++;

                // After 3 consecutive failures, disable AI for remaining profiles on this page
                if (consecutiveFailures >= 3) {
                    console.warn('[LiSeSca] AI disabled after ' + consecutiveFailures + ' consecutive failures. Saving remaining profiles without rating.');
                    aiDisabled = true;
                }

                // Save profile with unavailable rating
                profile.aiScore = '';
                profile.aiLabel = 'AI unavailable';
                profile.aiReason = 'Scoring failed: ' + error.message;
                State.appendBuffer([profile]);
                savedCount++;

                scoreIndex++;
                scoreNext();
            });
        }

        scoreNext();
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
        var state = State.getScrapingState();
        var pagesScraped = state.currentPage - state.startPage + 1;

        console.log('[LiSeSca] Scraping finished! Total: ' + totalProfiles + ' profiles.');
        if (aiEnabled && aiEvaluated > 0) {
            console.log('[LiSeSca] AI stats: ' + aiAccepted + '/' + aiEvaluated + ' saved (score >= 3).');
        }

        UI.hideAIStats();

        if (totalProfiles > 0) {
            UI.showStatus('Done! ' + totalProfiles + ' profiles scraped. Downloading...');
            Output.downloadResults(buffer);
            State.clear();
            setTimeout(function() {
                UI.showIdleState();
            }, 5000);
        } else if (aiEnabled && aiEvaluated > 0) {
            // AI filtering was active but no profiles matched - show special notification
            State.clear();
            UI.showNoResults(aiEvaluated, pagesScraped, 'profile');
        } else {
            UI.showStatus('No profiles found.');
            State.clear();
            setTimeout(function() {
                UI.showIdleState();
            }, 5000);
        }
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
