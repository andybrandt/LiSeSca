// ===== JOB EMULATION =====
// Simulates human browsing behavior specific to job detail panels.
// When reviewing a job, a human would scroll the detail panel, move the mouse
// over the description, and spend several seconds reading before moving on.
import { CONFIG } from '../shared/config.js';
import { UI } from '../ui/ui.js';
import { Emulator } from '../people/emulator.js';

export const JobEmulator = {
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
