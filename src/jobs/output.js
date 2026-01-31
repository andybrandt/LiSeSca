// ===== OUTPUT GENERATION (JOBS) =====
// Formats scraped job data into XLSX and Markdown.
// CSV is not offered for jobs because job data contains long text fields
// (descriptions, company info) that are poorly suited to CSV format.
import { State } from '../shared/state.js';
import { Output } from '../people/output.js';

export const JobOutput = {

    /** Column headers for XLSX export */
    COLUMN_HEADERS: [
        'Job Title', 'Company', 'Location', 'Posted', 'Applicants', 'Job State',
        'Workplace Type', 'Employment Type', 'Apply Link', 'Job Link',
        'Network Connections', 'Industry', 'Employee Count',
        'About the Job', 'Premium Insights', 'About the Company'
    ],

    /**
     * Convert a job object into a row array for XLSX.
     * @param {Object} job - A job data object.
     * @returns {Array<string>} Array of cell values.
     */
    jobToRow: function(job) {
        return [
            job.jobTitle || '',
            job.company || '',
            job.location || '',
            job.postedDate || '',
            job.applicants || '',
            job.jobState || '',
            job.workplaceType || '',
            job.employmentType || '',
            job.applyLink || '',
            job.jobLink || '',
            job.networkConnections || '',
            job.industry || '',
            job.employeeCount || '',
            job.jobDescription || '',
            job.premiumInsights || '',
            job.aboutCompany || ''
        ];
    },

    /**
     * Format a single job into Markdown.
     * @param {Object} job - A job data object.
     * @returns {string} The formatted Markdown block for this job.
     */
    formatJobMarkdown: function(job) {
        var lines = [];

        lines.push('# ' + (job.jobTitle || '(untitled)'));
        lines.push('');
        lines.push('**Company:** ' + (job.company || '(unknown)'));
        lines.push('**Location:** ' + (job.location || '(unknown)'));

        // Posted + Applicants on the same line
        var postedLine = '';
        if (job.postedDate) {
            postedLine += '**Posted:** ' + job.postedDate;
        }
        if (job.applicants) {
            if (postedLine) {
                postedLine += ' | ';
            }
            postedLine += '**Applicants:** ' + job.applicants;
        }
        if (postedLine) {
            lines.push(postedLine);
        }

        if (job.jobState) {
            lines.push('**Job State:** ' + job.jobState);
        }

        // Type line (workplace + employment)
        var typeParts = [];
        if (job.employmentType) {
            typeParts.push(job.employmentType);
        }
        if (job.workplaceType) {
            typeParts.push(job.workplaceType);
        }
        if (typeParts.length > 0) {
            lines.push('**Type:** ' + typeParts.join(', '));
        }

        // Apply and Job links
        if (job.applyLink) {
            lines.push('**Apply:** ' + job.applyLink);
        }
        lines.push('**Job Link:** ' + (job.jobLink || ''));

        if (job.networkConnections) {
            lines.push('**Network:** ' + job.networkConnections);
        }

        // Industry + Employee count
        var industryLine = '';
        if (job.industry) {
            industryLine += '**Industry:** ' + job.industry;
        }
        if (job.employeeCount) {
            if (industryLine) {
                industryLine += ' | ';
            }
            industryLine += '**Employees:** ' + job.employeeCount;
        }
        if (industryLine) {
            lines.push(industryLine);
        }

        // Job description
        if (job.jobDescription) {
            lines.push('');
            lines.push('## About the Job');
            lines.push('');
            lines.push(job.jobDescription);
        }

        // About the company
        if (job.aboutCompany) {
            lines.push('');
            lines.push('## About the Company');
            lines.push('');
            lines.push(job.aboutCompany);
        }

        // Premium insights
        if (job.premiumInsights) {
            lines.push('');
            lines.push('## Job Seeker Insights (Premium)');
            lines.push('');
            lines.push(job.premiumInsights);
        }

        return lines.join('\n');
    },

    /**
     * Generate a complete Markdown document from an array of jobs.
     * @param {Array} jobs - Array of job data objects.
     * @returns {string} The complete Markdown content.
     */
    generateMarkdown: function(jobs) {
        var blocks = jobs.map(function(job) {
            return JobOutput.formatJobMarkdown(job);
        });
        return blocks.join('\n\n---\n\n') + '\n';
    },

    /**
     * Generate an XLSX file from job data.
     * @param {Array} jobs - Array of job data objects.
     * @returns {Uint8Array} The binary XLSX file content.
     */
    generateXLSX: function(jobs) {
        var self = this;
        var data = [this.COLUMN_HEADERS];
        jobs.forEach(function(job) {
            data.push(self.jobToRow(job));
        });

        var worksheet = XLSX.utils.aoa_to_sheet(data);
        var workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'LinkedIn Jobs');

        var xlsxData = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
        return new Uint8Array(xlsxData);
    },

    /**
     * Generate a job-specific filename.
     * @param {string} extension - File extension.
     * @returns {string} The generated filename.
     */
    buildFilename: function(extension) {
        var ext = extension || 'md';
        var now = new Date();
        var year = now.getFullYear();
        var month = String(now.getMonth() + 1).padStart(2, '0');
        var day = String(now.getDate()).padStart(2, '0');
        var hours = String(now.getHours()).padStart(2, '0');
        var minutes = String(now.getMinutes()).padStart(2, '0');
        return 'linkedin-jobs-' + year + '-' + month + '-' + day
            + '-' + hours + 'h' + minutes + '.' + ext;
    },

    /**
     * Download job results in the selected formats.
     * Jobs support XLSX and Markdown only (no CSV due to long text fields).
     * @param {Array} jobs - Array of job data objects.
     */
    downloadResults: function(jobs) {
        if (!jobs || jobs.length === 0) {
            console.warn('[LiSeSca] No jobs to download.');
            return;
        }

        var formats = State.getFormats();
        console.log('[LiSeSca] Downloading jobs in formats: ' + formats.join(', '));

        var self = this;
        var delayMs = 0;

        // XLSX format
        if (formats.indexOf('xlsx') !== -1) {
            setTimeout(function() {
                var xlsxData = self.generateXLSX(jobs);
                var xlsxFilename = self.buildFilename('xlsx');
                Output.downloadFile(
                    xlsxData,
                    xlsxFilename,
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                );
            }, delayMs);
            delayMs += 200;
        }

        // Markdown format
        if (formats.indexOf('md') !== -1) {
            setTimeout(function() {
                var markdown = self.generateMarkdown(jobs);
                var mdFilename = self.buildFilename('md');
                Output.downloadFile(markdown, mdFilename, 'text/markdown;charset=utf-8');
            }, delayMs);
        }
    }
};
