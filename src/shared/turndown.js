    // ===== TURNDOWN SERVICE =====
    // Shared HTML-to-Markdown converter instance for job descriptions.
    // Turndown is loaded via @require from CDN.
    //
    // IMPORTANT: LinkedIn enforces Trusted Types, a browser security policy
    // that blocks direct innerHTML assignment. Turndown internally uses
    // innerHTML when given an HTML string, which triggers a Trusted Types
    // violation and crashes with "Cannot read properties of null ('firstChild')".
    //
    // To work around this, we use two strategies:
    // 1. Pass live DOM nodes to Turndown (preferred — no innerHTML needed)
    // 2. For HTML strings, use DOMParser to create a separate Document context
    //    that is NOT subject to the page's Trusted Types policy, then pass
    //    the parsed DOM node to Turndown.
    var turndownService = null;

    /**
     * Get or create the shared TurndownService instance.
     * Lazy initialization in case Turndown is loaded after our IIFE runs.
     * @returns {TurndownService|null} The Turndown instance, or null if not available.
     */
    function getTurndownService() {
        if (turndownService) {
            return turndownService;
        }
        if (typeof TurndownService !== 'undefined') {
            turndownService = new TurndownService({
                headingStyle: 'atx',
                bulletListMarker: '-'
            });
            return turndownService;
        }
        console.warn('[LiSeSca] TurndownService not available.');
        return null;
    }

    /**
     * Safely convert HTML to Markdown, bypassing LinkedIn's Trusted Types policy.
     * Accepts either a DOM node or an HTML string.
     *
     * When given a DOM node: passes it directly to Turndown (no innerHTML involved).
     * When given a string: uses DOMParser to build a DOM tree in a separate document
     * context that is not subject to the page's Trusted Types restrictions, then
     * passes the resulting node to Turndown.
     *
     * @param {HTMLElement|string} input - A live DOM element or an HTML string.
     * @returns {string} The Markdown text, or plain text fallback, or empty string.
     */
    function htmlToMarkdown(input) {
        if (!input) {
            return '';
        }

        var td = getTurndownService();
        if (!td) {
            // Fallback: extract plain text if Turndown is not available
            if (typeof input === 'string') {
                var tempParser = new DOMParser();
                var tempDoc = tempParser.parseFromString(input, 'text/html');
                return (tempDoc.body.textContent || '').trim();
            }
            return (input.textContent || '').trim();
        }

        // If input is already a DOM node, pass it directly to Turndown
        if (typeof input !== 'string') {
            return td.turndown(input);
        }

        // For HTML strings, parse via DOMParser to avoid Trusted Types violations.
        // DOMParser creates an entirely separate Document that does not inherit
        // the page's Content Security Policy or Trusted Types restrictions.
        var parser = new DOMParser();
        var doc = parser.parseFromString(input, 'text/html');
        return td.turndown(doc.body);
    }


