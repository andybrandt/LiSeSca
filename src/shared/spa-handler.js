// ===== SPA NAVIGATION HANDLER =====
// Detects URL changes in LinkedIn's SPA by intercepting History API.
// Calls a callback when navigation occurs so the UI can be rebuilt appropriately.
import { PageDetector } from './page-detector.js';

export const SpaHandler = {
    /** Callback function to invoke on navigation: callback(newPageType, oldPageType) */
    onNavigate: null,

    /** Last known URL to detect actual changes */
    lastUrl: '',

    /** Whether the handler has been initialized */
    initialized: false,

    /**
     * Initialize the SPA handler.
     * Wraps History API methods and listens for popstate events.
     * @param {function} callback - Called with (newPageType, oldPageType) on navigation.
     */
    init: function(callback) {
        if (this.initialized) {
            console.log('[LiSeSca] SpaHandler already initialized, skipping.');
            return;
        }

        this.onNavigate = callback;
        this.lastUrl = window.location.href;
        this.initialized = true;

        var self = this;

        // Wrap history.pushState to intercept SPA navigations
        var originalPushState = history.pushState;
        history.pushState = function() {
            var result = originalPushState.apply(this, arguments);
            self.handleUrlChange();
            return result;
        };

        // Wrap history.replaceState to intercept URL replacements
        var originalReplaceState = history.replaceState;
        history.replaceState = function() {
            var result = originalReplaceState.apply(this, arguments);
            self.handleUrlChange();
            return result;
        };

        // Listen for back/forward button navigation
        window.addEventListener('popstate', function() {
            self.handleUrlChange();
        });

        console.log('[LiSeSca] SpaHandler initialized. Monitoring URL changes.');
    },

    /**
     * Check if the URL has actually changed and invoke the callback if so.
     */
    handleUrlChange: function() {
        var currentUrl = window.location.href;

        // Only trigger if the URL actually changed
        if (currentUrl === this.lastUrl) {
            return;
        }

        var oldUrl = this.lastUrl;
        this.lastUrl = currentUrl;

        // Determine page types before and after navigation
        var oldPageType = this.getPageTypeFromUrl(oldUrl);
        var newPageType = PageDetector.getPageType();

        console.log('[LiSeSca] SPA navigation detected: ' + oldPageType + ' -> ' + newPageType);

        // Invoke the callback if one is registered
        if (this.onNavigate) {
            this.onNavigate(newPageType, oldPageType);
        }
    },

    /**
     * Determine page type from a URL string (for analyzing old URL).
     * @param {string} url - The URL to analyze.
     * @returns {string} 'people', 'jobs', or 'unknown'.
     */
    getPageTypeFromUrl: function(url) {
        if (url.indexOf('linkedin.com/search/results/people') !== -1) {
            return 'people';
        }
        if (url.indexOf('linkedin.com/jobs/search') !== -1 ||
            url.indexOf('linkedin.com/jobs/collections') !== -1) {
            return 'jobs';
        }
        return 'unknown';
    }
};
