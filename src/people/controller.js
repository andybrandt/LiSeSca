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
import { ProfileExtractor } from './profile-extractor.js';
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
        var state = State.getScrapingState();
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
