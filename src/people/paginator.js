// ===== PAGINATION (PEOPLE) =====
// Handles navigation between search result pages.
// LinkedIn uses the "page=" URL parameter for pagination.
import { State } from '../shared/state.js';

export const Paginator = {

    /**
     * Get the current page number from the URL's "page=" parameter.
     * @returns {number} Page number (1 if not specified).
     */
    getCurrentPage: function() {
        const url = new URL(window.location.href);
        const pageParam = url.searchParams.get('page');
        return pageParam ? parseInt(pageParam, 10) : 1;
    },

    /**
     * Get the base search URL (without the "page" parameter).
     * @returns {string} The cleaned base URL.
     */
    getBaseSearchUrl: function() {
        const url = new URL(window.location.href);
        url.searchParams.delete('page');
        return url.toString();
    },

    /**
     * Navigate to a specific page by updating the URL.
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
