// ===== PROFILE EXTRACTION (PEOPLE) =====
// Extracts full profile data from a LinkedIn profile page.
import { ProfileSelectors } from '../selectors/profile.js';
import { htmlToMarkdown } from '../shared/turndown.js';

export const ProfileExtractor = {

    /**
     * Check if the current page looks like a LinkedIn profile page.
     * @returns {boolean}
     */
    isOnProfilePage: function() {
        var href = window.location.href;
        return href.indexOf('linkedin.com/in/') !== -1 || href.indexOf('linkedin.com/pub/') !== -1;
    },

    /**
     * Wait for the profile page to load key content.
     * @returns {Promise<void>}
     */
    waitForProfileLoad: function() {
        var self = this;
        return new Promise(function(resolve, reject) {
            var maxWaitMs = 12000;
            var pollIntervalMs = 400;
            var elapsed = 0;

            var poll = setInterval(function() {
                var nameEl = self.getFirstMatch(ProfileSelectors.NAME, document);
                var expSection = self.getFirstMatch(ProfileSelectors.EXPERIENCE_SECTION, document);
                if (nameEl || expSection) {
                    clearInterval(poll);
                    resolve();
                    return;
                }
                elapsed += pollIntervalMs;
                if (elapsed >= maxWaitMs) {
                    clearInterval(poll);
                    reject(new Error('Profile content did not load in time.'));
                }
            }, pollIntervalMs);
        });
    },

    /**
     * Determine if this profile is restricted/private.
     * @returns {boolean}
     */
    isRestrictedProfile: function() {
        var name = this.extractName();
        if (name && name.toLowerCase() === 'linkedin member') {
            return true;
        }

        var bodyText = document.body ? (document.body.textContent || '') : '';
        var restrictedPhrases = [
            'This profile is not available',
            'Profile is private',
            'LinkedIn Member',
            'You do not have access'
        ];

        for (var i = 0; i < restrictedPhrases.length; i++) {
            if (bodyText.indexOf(restrictedPhrases[i]) !== -1) {
                return true;
            }
        }

        return false;
    },

    /**
     * Click all "Show more" / "See more" buttons to expand collapsed text.
     */
    clickShowMore: function() {
        var buttons = this.getAllMatches(ProfileSelectors.SHOW_MORE_BUTTON, document);
        buttons.forEach(function(btn) {
            try {
                btn.click();
            } catch (error) {
                // Ignore individual failures
            }
        });
    },

    /**
     * Extract the full profile data object.
     * @returns {Object} Profile data.
     */
    extractFullProfile: function() {
        var fullName = this.extractName();
        var headline = this.extractHeadline();
        var profileAbout = this.extractAbout();
        var location = this.extractLocation();
        var profileUrl = this.extractProfileUrl();

        var roles = this.extractExperienceEntries();
        var currentRole = roles.length > 0 ? roles[0] : null;
        var pastRoles = roles.length > 1 ? roles.slice(1, 4) : [];

        return {
            fullName: fullName,
            headline: headline,
            profileAbout: profileAbout,
            location: location,
            profileUrl: profileUrl,
            currentRole: currentRole,
            pastRoles: pastRoles
        };
    },

    /**
     * Format a full profile for AI evaluation.
     * @param {Object} profile - Full profile data.
     * @returns {string} Markdown summary for AI.
     */
    formatProfileForAI: function(profile) {
        var lines = [];
        lines.push('## ' + (profile.fullName || 'Unknown Name'));

        if (profile.headline) {
            lines.push('**Headline:** ' + profile.headline);
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

        if (profile.profileAbout) {
            lines.push('');
            lines.push('**About:**');
            lines.push(profile.profileAbout);
        }

        if (profile.currentRole) {
            lines.push('');
            lines.push('**Current Role:** ' + this.formatRoleLine(profile.currentRole));
        }

        if (profile.pastRoles && profile.pastRoles.length > 0) {
            lines.push('');
            lines.push('**Past Roles:**');
            profile.pastRoles.forEach(function(role) {
                lines.push('- ' + ProfileExtractor.formatRoleLine(role));
            });
        }

        return lines.join('\n');
    },

    /**
     * Extract the profile name.
     * @returns {string}
     */
    extractName: function() {
        return this.extractText(ProfileSelectors.NAME, document);
    },

    /**
     * Extract the headline text.
     * @returns {string}
     */
    extractHeadline: function() {
        return this.extractText(ProfileSelectors.HEADLINE, document);
    },

    /**
     * Extract the location text.
     * @returns {string}
     */
    extractLocation: function() {
        return this.extractText(ProfileSelectors.LOCATION, document);
    },

    /**
     * Extract the "About" section text.
     * @returns {string}
     */
    extractAbout: function() {
        // Try to find the About section first
        var section = this.getFirstMatch(ProfileSelectors.ABOUT_SECTION, document);

        // If we have an about section, look for the text within it
        if (section) {
            var aboutEl = this.getFirstMatch(ProfileSelectors.ABOUT_TEXT, section);
            if (aboutEl) {
                return (aboutEl.textContent || '').trim();
            }
        }

        // Fallback: search the entire page for About-style text containers
        var aboutTextEl = this.getFirstMatch(ProfileSelectors.ABOUT_TEXT, document);
        if (aboutTextEl) {
            // Make sure it's not inside Experience section
            var expSection = this.getFirstMatch(ProfileSelectors.EXPERIENCE_SECTION, document);
            if (expSection && expSection.contains(aboutTextEl)) {
                return '';
            }
            return (aboutTextEl.textContent || '').trim();
        }

        return '';
    },

    /**
     * Extract the profile URL without query params.
     * @returns {string}
     */
    extractProfileUrl: function() {
        var href = window.location.href;
        try {
            var url = new URL(href);
            return url.origin + url.pathname;
        } catch (error) {
            return href;
        }
    },

    /**
     * Extract experience entries (current + past roles).
     * LinkedIn has two structures:
     * 1. Simple: one role per entry (role title, company, dates, location)
     * 2. Grouped: company header with nested sub-roles
     * @returns {Array<Object>} Roles in descending order (most recent first).
     */
    extractExperienceEntries: function() {
        var self = this;
        var section = this.getFirstMatch(ProfileSelectors.EXPERIENCE_SECTION, document);
        if (!section) {
            console.log('[LiSeSca] No experience section found.');
            return [];
        }

        var roles = [];

        // Get top-level experience items (either companies or single roles)
        var topItems = section.querySelectorAll('li.artdeco-list__item');

        for (var i = 0; i < topItems.length; i++) {
            var item = topItems[i];

            // Check if this is a grouped entry (has sub-roles)
            var subRolesContainer = item.querySelector('.pvs-entity__sub-components ul');

            if (subRolesContainer) {
                // Grouped entry: extract company name from header, then each sub-role
                var companyName = this.extractCompanyFromHeader(item);
                var subItems = subRolesContainer.querySelectorAll(':scope > li');

                for (var j = 0; j < subItems.length; j++) {
                    var role = this.extractRoleFromSubEntry(subItems[j], companyName);
                    if (role && role.title) {
                        roles.push(role);
                    }
                }
            } else {
                // Simple entry: single role
                var role = this.extractSimpleRole(item);
                if (role && role.title) {
                    roles.push(role);
                }
            }

            // Limit to first 4 entries for efficiency (current + 3 past)
            if (roles.length >= 4) {
                break;
            }
        }

        console.log('[LiSeSca] Extracted ' + roles.length + ' experience entries.');
        return roles;
    },

    /**
     * Extract company name from a grouped experience header.
     * @param {HTMLElement} item - The top-level experience item.
     * @returns {string} Company name.
     */
    extractCompanyFromHeader: function(item) {
        // The company name is in the header's bold text
        var boldSpan = item.querySelector('.mr1.hoverable-link-text.t-bold span[aria-hidden="true"]');
        if (boldSpan) {
            return (boldSpan.textContent || '').trim();
        }
        // Fallback to any t-bold span
        boldSpan = item.querySelector('.t-bold span[aria-hidden="true"]');
        return boldSpan ? (boldSpan.textContent || '').trim() : '';
    },

    /**
     * Extract a role from a sub-entry within a grouped company.
     * @param {HTMLElement} subEntry - The nested role list item.
     * @param {string} companyName - The company name from parent.
     * @returns {Object|null} Role data.
     */
    extractRoleFromSubEntry: function(subEntry, companyName) {
        if (!subEntry) {
            return null;
        }

        // Title is in bold span
        var titleEl = subEntry.querySelector('.mr1.hoverable-link-text.t-bold span[aria-hidden="true"]');
        if (!titleEl) {
            titleEl = subEntry.querySelector('.t-bold span[aria-hidden="true"]');
        }
        var title = titleEl ? (titleEl.textContent || '').trim() : '';

        // Dates from caption wrapper or t-black--light
        var dates = this.extractDatesFromEntry(subEntry);

        // Location from t-black--light (second occurrence typically)
        var location = this.extractLocationFromEntry(subEntry);

        return {
            title: title,
            company: companyName,
            description: '',
            location: location,
            duration: dates
        };
    },

    /**
     * Extract a simple role (single entry, not grouped).
     * @param {HTMLElement} item - The experience list item.
     * @returns {Object|null} Role data.
     */
    extractSimpleRole: function(item) {
        if (!item) {
            return null;
        }

        // Title is in bold span within the main content area
        var titleEl = item.querySelector('.mr1.hoverable-link-text.t-bold span[aria-hidden="true"]');
        if (!titleEl) {
            titleEl = item.querySelector('.t-bold span[aria-hidden="true"]');
        }
        var title = titleEl ? (titleEl.textContent || '').trim() : '';

        // Company is in t-14 t-normal (not t-black--light)
        var companyEl = item.querySelector('span.t-14.t-normal:not(.t-black--light) span[aria-hidden="true"]');
        var company = companyEl ? (companyEl.textContent || '').trim() : '';

        // Dates
        var dates = this.extractDatesFromEntry(item);

        // Location
        var location = this.extractLocationFromEntry(item);

        return {
            title: title,
            company: company,
            description: '',
            location: location,
            duration: dates
        };
    },

    /**
     * Extract dates/duration from an entry.
     * @param {HTMLElement} entry - The entry element.
     * @returns {string} Duration string.
     */
    extractDatesFromEntry: function(entry) {
        // Try caption wrapper first (e.g., "Dec 2013 - Present · 12 yrs 3 mos")
        var captionEl = entry.querySelector('.pvs-entity__caption-wrapper[aria-hidden="true"]');
        if (captionEl) {
            return (captionEl.textContent || '').trim();
        }

        // Fallback: t-black--light spans, first one is usually dates
        var lightSpans = entry.querySelectorAll('span.t-14.t-normal.t-black--light span[aria-hidden="true"]');
        if (lightSpans.length > 0) {
            return (lightSpans[0].textContent || '').trim();
        }

        return '';
    },

    /**
     * Extract location from an entry.
     * @param {HTMLElement} entry - The entry element.
     * @returns {string} Location string.
     */
    extractLocationFromEntry: function(entry) {
        // Location is usually the second t-black--light span (after dates)
        var lightSpans = entry.querySelectorAll('span.t-14.t-normal.t-black--light span[aria-hidden="true"]');

        // Skip the caption wrapper content, look for standalone location
        for (var i = 0; i < lightSpans.length; i++) {
            var text = (lightSpans[i].textContent || '').trim();
            // If it looks like a location (no dates pattern)
            if (text && !text.match(/\d{4}/) && !text.match(/\d+\s*(yr|mo|year|month)/i)) {
                return text;
            }
        }

        return '';
    },

    /**
     * Extract a single role entry from an experience list item (legacy fallback).
     * @param {HTMLElement} entry - The experience list item.
     * @returns {Object|null} Role data.
     */
    extractRoleFromEntry: function(entry) {
        return this.extractSimpleRole(entry);
    },

    /**
     * Clean company name string by removing extra qualifiers.
     * @param {string} raw - Raw company text.
     * @returns {string}
     */
    cleanCompanyName: function(raw) {
        if (!raw) {
            return '';
        }
        var parts = raw.split('·');
        return parts[0].trim();
    },

    /**
     * Format a role into a single line summary.
     * @param {Object} role - Role data.
     * @returns {string}
     */
    formatRoleLine: function(role) {
        var parts = [];
        if (role.title) {
            parts.push(role.title);
        }
        if (role.company) {
            parts.push('at ' + role.company);
        }
        var suffix = [];
        if (role.duration) {
            suffix.push(role.duration);
        }
        if (role.location) {
            suffix.push(role.location);
        }
        var line = parts.join(' ');
        if (suffix.length > 0) {
            line += ' (' + suffix.join(', ') + ')';
        }
        if (role.description) {
            line += ' — ' + role.description;
        }
        return line || '(unknown role)';
    },

    /**
     * Extract text content using a selector list.
     * @param {Array<string>} selectors - Selector list.
     * @param {HTMLElement|Document} root - Root to search within.
     * @returns {string}
     */
    extractText: function(selectors, root) {
        var el = this.getFirstMatch(selectors, root);
        return el ? (el.textContent || '').trim() : '';
    },

    /**
     * Get the first element that matches any selector.
     * @param {Array<string>} selectors - Selector list.
     * @param {HTMLElement|Document} root - Root to search within.
     * @returns {HTMLElement|null}
     */
    getFirstMatch: function(selectors, root) {
        if (!selectors || selectors.length === 0) {
            return null;
        }
        var scope = root || document;
        for (var i = 0; i < selectors.length; i++) {
            var el = scope.querySelector(selectors[i]);
            if (el) {
                return el;
            }
        }
        return null;
    },

    /**
     * Get all matching elements for a selector list.
     * @param {Array<string>} selectors - Selector list.
     * @param {HTMLElement|Document} root - Root to search within.
     * @returns {Array<HTMLElement>}
     */
    getAllMatches: function(selectors, root) {
        var scope = root || document;
        var results = [];
        if (!selectors || selectors.length === 0) {
            return results;
        }
        for (var i = 0; i < selectors.length; i++) {
            var nodes = scope.querySelectorAll(selectors[i]);
            for (var j = 0; j < nodes.length; j++) {
                if (results.indexOf(nodes[j]) === -1) {
                    results.push(nodes[j]);
                }
            }
        }
        return results;
    }
};
