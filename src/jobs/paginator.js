// ===== PAGINATION (JOBS) =====
// Handles navigation between job search result pages.
// Jobs use the "start=" parameter (increments by 25 per page).
import { State } from '../shared/state.js';
import { JobSelectors } from '../selectors/jobs.js';

export const JobPaginator = {
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
     * Get the total number of pages from the "Page X of Y" text.
     * @returns {number} Total pages, or 0 if not found.
     */
    getTotalPages: function() {
        var pageState = document.querySelector('.jobs-search-pagination__page-state');
        if (pageState) {
            var text = (pageState.textContent || '').trim();
            var match = text.match(/Page\s+\d+\s+of\s+(\d+)/i);
            if (match) {
                return parseInt(match[1], 10);
            }
        }
        return 0;
    },

    /**
     * Check if there is a next page available.
     * Uses the "Page X of Y" indicator, falling back to checking
     * if the current page is less than the detected total.
     * @returns {boolean}
     */
    hasNextPage: function() {
        var totalPages = this.getTotalPages();
        if (totalPages > 0) {
            return this.getCurrentPage() < totalPages;
        }
        // Fallback: check if a "Next" button exists and is not disabled
        var nextBtn = document.querySelector('.jobs-search-pagination__button--next');
        return nextBtn !== null && !nextBtn.disabled;
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
