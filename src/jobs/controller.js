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
import { CONFIG } from '../shared/config.js';
import { State } from '../shared/state.js';
import { PageDetector } from '../shared/page-detector.js';
import { AIClient } from '../shared/ai-client.js';
import { UI } from '../ui/ui.js';
import { Emulator } from '../people/emulator.js';
import { JobExtractor } from './extractor.js';
import { JobEmulator } from './emulator.js';
import { JobPaginator } from './paginator.js';
import { JobOutput } from './output.js';

export const JobController = {

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

                        return AIClient.triageCard(cardMarkdown).then(function(decision) {
                            if (!State.isScraping()) {
                                return null;
                            }

                            if (decision === 'reject') {
                                // Reject: skip job entirely, no full details fetched
                                console.log('[LiSeSca] AI rejected job: ' + cardData.jobTitle);
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
                                console.log('[LiSeSca] AI kept job: ' + cardData.jobTitle);
                                UI.showStatus(statusMsg + ' — AI: Keep');
                                return JobExtractor.extractFullJob(jobId);
                            }

                            // Maybe: fetch full details, then ask AI again
                            console.log('[LiSeSca] AI maybe on job: ' + cardData.jobTitle);
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

                                return AIClient.evaluateFullJob(fullJobMarkdown).then(function(accept) {
                                    if (!State.isScraping()) {
                                        return null;
                                    }

                                    if (accept) {
                                        console.log('[LiSeSca] AI accepted job after full review: ' + job.jobTitle);
                                        UI.showStatus(statusMsg + ' — AI: Accept');
                                        return job;
                                    }

                                    // Reject after full evaluation: skip
                                    console.log('[LiSeSca] AI rejected job after full review: ' + job.jobTitle);
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

        console.log('[LiSeSca] Job scraping finished! Total: ' + totalJobs + ' jobs across '
            + pagesScraped + ' page(s).');

        UI.showProgress('');
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
