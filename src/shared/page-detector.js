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


