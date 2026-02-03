// ===== DATA EXTRACTION (PEOPLE) =====
// Reads the current page's DOM and returns an array of profile objects.
// Each profile is represented as:
//   { fullName, connectionDegree, description, location, profileUrl }
import { Selectors } from '../selectors/people.js';

export const Extractor = {

    /**
     * Wait for search result cards to appear in the DOM.
     * LinkedIn is an SPA and may load results asynchronously,
     * so we poll for up to 10 seconds before giving up.
     * @returns {Promise<NodeList>} The list of result card elements (may be empty).
     */
    waitForResults: function() {
        return new Promise(function(resolve) {
            const maxWaitMs = 10000;
            const pollIntervalMs = 500;
            let elapsed = 0;

            const poll = setInterval(function() {
                const cards = document.querySelectorAll(Selectors.RESULT_CARD);
                if (cards.length > 0) {
                    clearInterval(poll);
                    console.log('[LiSeSca] Found ' + cards.length + ' result cards.');
                    resolve(cards);
                    return;
                }
                elapsed += pollIntervalMs;
                if (elapsed >= maxWaitMs) {
                    clearInterval(poll);
                    console.log('[LiSeSca] No result cards found after ' + maxWaitMs + 'ms (end of results).');
                    resolve([]); // Return empty array instead of rejecting
                }
            }, pollIntervalMs);
        });
    },

    /**
     * Extract profile data from all result cards on the current page.
     * Skips cards that fail to parse (logs a warning for each).
     * @returns {Promise<Array>} Array of profile data objects.
     */
    extractCurrentPage: function() {
        return this.waitForResults().then(function(cards) {
            const profiles = [];
            cards.forEach(function(card, index) {
                try {
                    const profile = Extractor.extractCard(card);
                    if (profile) {
                        profiles.push(profile);
                    }
                } catch (error) {
                    console.warn('[LiSeSca] Failed to extract card #' + index + ':', error);
                }
            });
            console.log('[LiSeSca] Extracted ' + profiles.length + ' profiles from this page.');
            return profiles;
        });
    },

    /**
     * Extract profile data from a single result card element.
     * @param {HTMLElement} card - The listitem div element.
     * @returns {Object|null} Profile data object, or null if no title link found.
     */
    extractCard: function(card) {
        const titleLink = card.querySelector(Selectors.TITLE_LINK);
        if (!titleLink) {
            console.warn('[LiSeSca] Card has no title link, skipping.');
            return null;
        }

        const fullName = this.extractName(titleLink);
        const profileUrl = this.extractProfileUrl(titleLink);
        const connectionDegree = this.extractDegree(titleLink);
        const description = this.extractDescription(titleLink);
        const location = this.extractLocation(titleLink);

        return {
            fullName: fullName,
            connectionDegree: connectionDegree,
            description: description,
            location: location,
            profileUrl: profileUrl
        };
    },

    /**
     * Format a people card as Markdown for AI evaluation.
     * @param {Object} profile - The card data from extractCard.
     * @returns {string} Markdown-formatted card summary.
     */
    formatCardForAI: function(profile) {
        var lines = [];
        lines.push('## ' + (profile.fullName || 'Unknown Name'));

        if (profile.description) {
            lines.push('**Headline:** ' + profile.description);
        }
        if (profile.location) {
            lines.push('**Location:** ' + profile.location);
        }
        if (profile.connectionDegree) {
            lines.push('**Connection degree:** ' + profile.connectionDegree);
        }
        if (profile.profileUrl) {
            lines.push('**Profile:** ' + profile.profileUrl);
        }

        return lines.join('\n');
    },

    /**
     * Extract the person's full name from the title link.
     * @param {HTMLElement} titleLink - The <a> element with data-view-name.
     * @returns {string} The full name, trimmed.
     */
    extractName: function(titleLink) {
        return (titleLink.textContent || '').trim();
    },

    /**
     * Extract and clean the profile URL from the title link's href.
     * @param {HTMLElement} titleLink - The <a> element.
     * @returns {string} The cleaned profile URL.
     */
    extractProfileUrl: function(titleLink) {
        const rawUrl = titleLink.href || '';
        return this.cleanProfileUrl(rawUrl);
    },

    /**
     * Remove query parameters and hash fragments from a LinkedIn profile URL.
     * @param {string} rawUrl - The full URL with potential tracking parameters.
     * @returns {string} The clean URL (origin + pathname only).
     */
    cleanProfileUrl: function(rawUrl) {
        if (!rawUrl) {
            return '';
        }
        try {
            const url = new URL(rawUrl);
            return url.origin + url.pathname;
        } catch (error) {
            return rawUrl;
        }
    },

    /**
     * Extract the connection degree from the span sibling of the title link.
     * @param {HTMLElement} titleLink - The <a> element.
     * @returns {number} The connection degree (1, 2, 3, etc.) or 0 if not found.
     */
    extractDegree: function(titleLink) {
        const titleParagraph = titleLink.parentElement;
        if (!titleParagraph) {
            return 0;
        }

        const spans = titleParagraph.querySelectorAll('span span');
        for (let i = 0; i < spans.length; i++) {
            const text = spans[i].textContent || '';
            const match = text.match(/(\d+)(st|nd|rd|th)/);
            if (match) {
                return parseInt(match[1], 10);
            }
        }
        return 0;
    },

    /**
     * Extract the description (headline) text from the first sibling <div>.
     * @param {HTMLElement} titleLink - The <a> element.
     * @returns {string} The description text, or empty string if not found.
     */
    extractDescription: function(titleLink) {
        const titleParagraph = titleLink.parentElement;
        if (!titleParagraph) {
            return '';
        }

        const descriptionDiv = titleParagraph.nextElementSibling;
        if (!descriptionDiv) {
            return '';
        }

        const descParagraph = descriptionDiv.querySelector('p');
        if (!descParagraph) {
            return '';
        }

        return (descParagraph.textContent || '').trim();
    },

    /**
     * Extract the location text from the second sibling <div>.
     * @param {HTMLElement} titleLink - The <a> element.
     * @returns {string} The location text, or empty string if not found.
     */
    extractLocation: function(titleLink) {
        const titleParagraph = titleLink.parentElement;
        if (!titleParagraph) {
            return '';
        }

        const descriptionDiv = titleParagraph.nextElementSibling;
        if (!descriptionDiv) {
            return '';
        }

        const locationDiv = descriptionDiv.nextElementSibling;
        if (!locationDiv) {
            return '';
        }

        const locParagraph = locationDiv.querySelector('p');
        if (!locParagraph) {
            return '';
        }

        return (locParagraph.textContent || '').trim();
    }
};
