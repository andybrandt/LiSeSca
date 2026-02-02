// ===== OUTPUT GENERATION (PEOPLE) =====
// Formats scraped profile data into XLSX, CSV, and Markdown.
import { State } from '../shared/state.js';

export const Output = {

    /**
     * Format a single profile into Markdown.
     * @param {Object} profile - A profile data object.
     * @returns {string} The formatted Markdown block.
     */
    formatProfile: function(profile) {
        const lines = [];
        lines.push('# ' + profile.fullName);
        lines.push('');

        if (profile.connectionDegree === 0) {
            lines.push('No connection.');
        } else if (profile.connectionDegree) {
            const ordinal = this.toOrdinal(profile.connectionDegree);
            lines.push('Connection: ' + ordinal);
        }

        var headline = profile.headline || profile.description || '';
        if (headline) {
            lines.push('Headline: ' + headline);
        }
        lines.push('Location: ' + (profile.location || '(none)'));
        lines.push('Full profile URL: ' + (profile.profileUrl || '(none)'));

        if (profile.profileAbout) {
            lines.push('');
            lines.push('## About');
            lines.push('');
            lines.push(profile.profileAbout);
        }

        if (profile.currentRole) {
            lines.push('');
            lines.push('## Current Role');
            lines.push('');
            lines.push(this.formatRoleDetails(profile.currentRole));
        }

        if (profile.pastRoles && profile.pastRoles.length > 0) {
            lines.push('');
            lines.push('## Past Roles');
            lines.push('');
            profile.pastRoles.forEach(function(role, index) {
                lines.push((index + 1) + '. ' + Output.formatRoleDetails(role));
            });
        }

        return lines.join('\n');
    },

    /**
     * Convert a number to its ordinal string.
     * @param {number} n - The number.
     * @returns {string} The ordinal string.
     */
    toOrdinal: function(n) {
        const suffixes = { 1: 'st', 2: 'nd', 3: 'rd' };
        const lastTwo = n % 100;
        if (lastTwo >= 11 && lastTwo <= 13) {
            return n + 'th';
        }
        const lastDigit = n % 10;
        return n + (suffixes[lastDigit] || 'th');
    },

    /**
     * Generate a complete Markdown document from an array of profiles.
     * @param {Array} profiles - Array of profile data objects.
     * @returns {string} The complete Markdown content.
     */
    generateMarkdown: function(profiles) {
        const blocks = profiles.map(function(profile) {
            return Output.formatProfile(profile);
        });
        return blocks.join('\n\n---\n\n') + '\n';
    },

    COLUMN_HEADERS_BASIC: ['Name', 'Title/Description', 'Location', 'LinkedIn URL', 'Connection degree'],
    COLUMN_HEADERS_DEEP: [
        'Name', 'Headline', 'Location', 'LinkedIn URL', 'Connection degree',
        'About',
        'Current Title', 'Current Company', 'Current Description', 'Current Location', 'Current Duration',
        'Past Role 1', 'Past Role 2', 'Past Role 3'
    ],

    /**
     * Convert a profile object into a row array.
     * @param {Object} profile - A profile data object.
     * @returns {Array<string|number>} Array of cell values.
     */
    profileToRow: function(profile, useDeep) {
        if (!useDeep) {
            return [
                profile.fullName || '',
                profile.description || '',
                profile.location || '',
                profile.profileUrl || '',
                profile.connectionDegree || 0
            ];
        }

        var currentRole = profile.currentRole || {};
        var pastRoles = profile.pastRoles || [];

        return [
            profile.fullName || '',
            profile.headline || profile.description || '',
            profile.location || '',
            profile.profileUrl || '',
            profile.connectionDegree || 0,
            profile.profileAbout || '',
            currentRole.title || '',
            currentRole.company || '',
            currentRole.description || '',
            currentRole.location || '',
            currentRole.duration || '',
            this.formatRoleSummary(pastRoles[0]),
            this.formatRoleSummary(pastRoles[1]),
            this.formatRoleSummary(pastRoles[2])
        ];
    },

    /**
     * Check if any profiles include deep data.
     * @param {Array} profiles - Array of profile data objects.
     * @returns {boolean}
     */
    hasDeepData: function(profiles) {
        if (!profiles || profiles.length === 0) {
            return false;
        }
        return profiles.some(function(profile) {
            return !!(profile && (profile.currentRole || (profile.pastRoles && profile.pastRoles.length > 0)));
        });
    },

    /**
     * Format a role into a single-line summary.
     * @param {Object} role - Role data.
     * @returns {string}
     */
    formatRoleSummary: function(role) {
        if (!role) {
            return '';
        }
        var parts = [];
        if (role.title) {
            parts.push(role.title);
        }
        if (role.company) {
            parts.push('@ ' + role.company);
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
        return line;
    },

    /**
     * Format a role with full details for Markdown.
     * @param {Object} role - Role data.
     * @returns {string}
     */
    formatRoleDetails: function(role) {
        if (!role) {
            return '(no details)';
        }
        var lines = [];
        if (role.title) {
            lines.push('Title: ' + role.title);
        }
        if (role.company) {
            lines.push('Company: ' + role.company);
        }
        if (role.duration) {
            lines.push('Duration: ' + role.duration);
        }
        if (role.location) {
            lines.push('Location: ' + role.location);
        }
        if (role.description) {
            lines.push('Description: ' + role.description);
        }
        return lines.join('\n');
    },

    /**
     * Escape a value for CSV output (RFC 4180).
     * @param {*} value - The cell value to escape.
     * @returns {string} The CSV-safe string.
     */
    escapeCSVField: function(value) {
        var str = String(value);
        return '"' + str.replace(/"/g, '""') + '"';
    },

    /**
     * Generate a CSV string from an array of profiles.
     * @param {Array} profiles - Array of profile data objects.
     * @returns {string} The complete CSV content.
     */
    generateCSV: function(profiles) {
        var self = this;
        var lines = [];

        var useDeep = this.hasDeepData(profiles);
        var headers = useDeep ? this.COLUMN_HEADERS_DEEP : this.COLUMN_HEADERS_BASIC;
        var headerLine = headers.map(function(header) {
            return self.escapeCSVField(header);
        }).join(',');
        lines.push(headerLine);

        profiles.forEach(function(profile) {
            var row = self.profileToRow(profile, useDeep);
            var csvLine = row.map(function(cell) {
                return self.escapeCSVField(cell);
            }).join(',');
            lines.push(csvLine);
        });

        return lines.join('\r\n') + '\r\n';
    },

    /**
     * Generate an XLSX file as a Uint8Array.
     * @param {Array} profiles - Array of profile data objects.
     * @returns {Uint8Array} The binary XLSX file content.
     */
    generateXLSX: function(profiles) {
        var self = this;
        var useDeep = this.hasDeepData(profiles);
        var headers = useDeep ? this.COLUMN_HEADERS_DEEP : this.COLUMN_HEADERS_BASIC;
        var data = [headers];
        profiles.forEach(function(profile) {
            data.push(self.profileToRow(profile, useDeep));
        });

        var worksheet = XLSX.utils.aoa_to_sheet(data);
        var workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'LinkedIn Search');

        var xlsxData = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
        return new Uint8Array(xlsxData);
    },

    /**
     * Generate a filename based on the current date and time.
     * @param {string} extension - File extension (default: 'md').
     * @returns {string} The generated filename.
     */
    buildFilename: function(extension) {
        var ext = extension || 'md';
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        return 'linkedin-search-' + year + '-' + month + '-' + day
            + '-' + hours + 'h' + minutes + '.' + ext;
    },

    /**
     * Trigger a file download in the browser.
     * @param {string|Uint8Array} content - The file content.
     * @param {string} filename - The desired filename.
     * @param {string} mimeType - The MIME type for the Blob.
     */
    downloadFile: function(content, filename, mimeType) {
        var type = mimeType || 'text/markdown;charset=utf-8';
        const blob = new Blob([content], { type: type });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.style.display = 'none';

        document.body.appendChild(link);
        link.click();

        setTimeout(function() {
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }, 1000);

        console.log('[LiSeSca] File download triggered: ' + filename);
    },

    /**
     * Generate output files in the selected formats and trigger downloads.
     * @param {Array} profiles - Array of profile data objects.
     */
    downloadResults: function(profiles) {
        if (!profiles || profiles.length === 0) {
            console.warn('[LiSeSca] No profiles to download.');
            return;
        }

        var formats = State.getFormats();
        console.log('[LiSeSca] Downloading in formats: ' + formats.join(', '));

        var self = this;
        var delayMs = 0;

        if (formats.indexOf('xlsx') !== -1) {
            setTimeout(function() {
                var xlsxData = self.generateXLSX(profiles);
                var xlsxFilename = self.buildFilename('xlsx');
                self.downloadFile(
                    xlsxData,
                    xlsxFilename,
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                );
            }, delayMs);
            delayMs += 200;
        }

        if (formats.indexOf('csv') !== -1) {
            setTimeout(function() {
                var csvContent = self.generateCSV(profiles);
                var csvFilename = self.buildFilename('csv');
                self.downloadFile(csvContent, csvFilename, 'text/csv;charset=utf-8');
            }, delayMs);
            delayMs += 200;
        }

        if (formats.indexOf('md') !== -1) {
            setTimeout(function() {
                var markdown = self.generateMarkdown(profiles);
                var mdFilename = self.buildFilename('md');
                self.downloadFile(markdown, mdFilename, 'text/markdown;charset=utf-8');
            }, delayMs);
        }
    }
};
