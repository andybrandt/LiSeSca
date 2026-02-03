// ===== USER INTERFACE =====
// Creates and manages the floating overlay panel with scrape controls.
// Adapts to the current page type: green SCRAPE button for people search,
// blue SCRAPE button for jobs search, with different page count options.
import { CONFIG } from '../shared/config.js';
import { State } from '../shared/state.js';
import { PageDetector } from '../shared/page-detector.js';
import { JobPaginator } from '../jobs/paginator.js';
import { AIClient } from '../shared/ai-client.js';

// Controller and JobController are used in event handlers (runtime calls, not import-time)
// They will be available in the bundled IIFE scope when Rollup bundles the code.
// We import them here to satisfy the ES module system.
// Note: This creates a circular dependency which Rollup handles correctly for IIFE output.
let Controller, JobController;

export function setControllers(ctrl, jobCtrl) {
    Controller = ctrl;
    JobController = jobCtrl;
}

export const UI = {
    /** References to key DOM elements */
    panel: null,
    menu: null,
    statusArea: null,
    noResultsArea: null,
    isMenuOpen: false,

    /** Flag to prevent duplicate style injection (styles persist across SPA navigation) */
    stylesInjected: false,

    /**
     * Inject all LiSeSca styles into the page.
     * Skips if already injected (styles persist across SPA navigation).
     */
    injectStyles: function() {
        if (this.stylesInjected) {
            console.log('[LiSeSca] Styles already injected, skipping.');
            return;
        }
        this.stylesInjected = true;
        GM_addStyle(`
            /* ---- LiSeSca floating panel ---- */
            .lisesca-panel {
                position: fixed;
                top: 10px;
                right: 10px;
                z-index: 10000;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 13px;
                background: #1b1f23;
                color: #e1e4e8;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
                padding: 0;
                min-width: 180px;
                user-select: none;
            }

            /* Top bar with SCRAPE button and gear icon */
            .lisesca-topbar {
                display: flex;
                align-items: center;
                padding: 8px 10px;
                gap: 8px;
            }

            /* The main SCRAPE button — green for people, blue for jobs */
            .lisesca-scrape-btn {
                flex: 1;
                background: #2ea44f;
                color: #ffffff;
                border: none;
                border-radius: 5px;
                padding: 6px 14px;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                letter-spacing: 0.5px;
                transition: background 0.15s;
            }
            .lisesca-scrape-btn:hover {
                background: #3fb950;
            }

            /* Blue variant for jobs pages */
            .lisesca-scrape-btn--jobs {
                background: #1f6feb;
            }
            .lisesca-scrape-btn--jobs:hover {
                background: #388bfd;
            }

            /* Gear (config) icon button */
            .lisesca-gear-btn {
                background: none;
                border: none;
                color: #8b949e;
                cursor: pointer;
                font-size: 16px;
                padding: 4px;
                line-height: 1;
                transition: color 0.15s;
            }
            .lisesca-gear-btn:hover {
                color: #e1e4e8;
            }

            /* Dropdown menu (hidden by default) */
            .lisesca-menu {
                display: none;
                padding: 8px 10px 10px;
                border-top: 1px solid #30363d;
            }
            .lisesca-menu.lisesca-open {
                display: block;
            }

            /* Label text above the dropdown */
            .lisesca-menu-label {
                font-size: 11px;
                color: #8b949e;
                margin-bottom: 5px;
            }

            /* Page count selector dropdown */
            .lisesca-select {
                width: 100%;
                background: #0d1117;
                color: #e1e4e8;
                border: 1px solid #30363d;
                border-radius: 4px;
                padding: 5px 8px;
                font-size: 13px;
                margin-bottom: 8px;
                cursor: pointer;
            }
            .lisesca-select:focus {
                outline: none;
                border-color: #58a6ff;
            }

            /* Format selection checkboxes */
            .lisesca-fmt-label {
                font-size: 11px;
                color: #8b949e;
                margin-bottom: 5px;
                margin-top: 4px;
            }

            .lisesca-fmt-row {
                display: flex;
                gap: 10px;
                margin-bottom: 8px;
            }

            .lisesca-toggle-row {
                display: flex;
                align-items: center;
                gap: 6px;
                margin-bottom: 8px;
            }

            .lisesca-checkbox-label {
                display: flex;
                align-items: center;
                gap: 4px;
                font-size: 12px;
                color: #c9d1d9;
                cursor: pointer;
            }

            .lisesca-checkbox-label input[type="checkbox"] {
                -webkit-appearance: checkbox !important;
                appearance: checkbox !important;
                position: static !important;
                width: 14px !important;
                height: 14px !important;
                min-width: 14px !important;
                min-height: 14px !important;
                flex-shrink: 0 !important;
                accent-color: #58a6ff;
                cursor: pointer;
                margin: 0 2px 0 0 !important;
                padding: 0 !important;
                opacity: 1 !important;
            }

            /* GO button inside the dropdown */
            .lisesca-go-btn {
                width: 100%;
                background: #1f6feb;
                color: #ffffff;
                border: none;
                border-radius: 5px;
                padding: 6px 14px;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                transition: background 0.15s;
            }
            .lisesca-go-btn:hover {
                background: #388bfd;
            }

            /* Status display area (shown during scraping) */
            .lisesca-status {
                display: none;
                padding: 8px 10px 10px;
                border-top: 1px solid #30363d;
                font-size: 12px;
                color: #8b949e;
            }
            .lisesca-status.lisesca-visible {
                display: block;
            }

            .lisesca-status-progress {
                display: none;
                margin-bottom: 4px;
            }
            .lisesca-status-progress.lisesca-visible {
                display: block;
            }

            /* Stop button (shown during scraping) */
            .lisesca-stop-btn {
                width: 100%;
                background: #da3633;
                color: #ffffff;
                border: none;
                border-radius: 5px;
                padding: 5px 12px;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
                margin-top: 6px;
                transition: background 0.15s;
            }
            .lisesca-stop-btn:hover {
                background: #f85149;
            }

            /* AI stats display in progress area */
            .lisesca-ai-stats {
                display: none;
                font-size: 11px;
                color: #58a6ff;
                margin-bottom: 4px;
            }
            .lisesca-ai-stats.lisesca-visible {
                display: block;
            }

            /* No-results notification */
            .lisesca-no-results {
                display: none;
                padding: 12px 10px;
                border-top: 1px solid #30363d;
                text-align: center;
            }
            .lisesca-no-results.lisesca-visible {
                display: block;
            }
            .lisesca-no-results-icon {
                font-size: 24px;
                margin-bottom: 8px;
                color: #8b949e;
            }
            .lisesca-no-results-title {
                font-size: 13px;
                font-weight: 600;
                color: #e1e4e8;
                margin-bottom: 6px;
            }
            .lisesca-no-results-stats {
                font-size: 11px;
                color: #8b949e;
                margin-bottom: 10px;
            }
            .lisesca-no-results-btn {
                width: 100%;
                background: #21262d;
                color: #c9d1d9;
                border: 1px solid #30363d;
                border-radius: 5px;
                padding: 6px 12px;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
                transition: background 0.15s;
            }
            .lisesca-no-results-btn:hover {
                background: #30363d;
            }

            /* ---- Configuration overlay ---- */
            .lisesca-config-overlay {
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.5);
                z-index: 10001;
                justify-content: center;
                align-items: center;
            }
            .lisesca-config-overlay.lisesca-visible {
                display: flex;
            }

            .lisesca-config-panel {
                background: #1b1f23;
                color: #e1e4e8;
                border-radius: 10px;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
                padding: 20px 24px;
                min-width: 280px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 13px;
            }

            .lisesca-config-title {
                font-size: 15px;
                font-weight: 600;
                margin-bottom: 16px;
                color: #f0f6fc;
            }

            .lisesca-config-version {
                font-size: 11px;
                color: #8b949e;
                margin-top: -12px;
                margin-bottom: 16px;
            }

            .lisesca-config-section {
                font-size: 12px;
                font-weight: 600;
                color: #8b949e;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                margin-top: 14px;
                margin-bottom: 10px;
                padding-bottom: 4px;
                border-bottom: 1px solid #30363d;
            }

            .lisesca-config-row {
                margin-bottom: 12px;
            }

            .lisesca-config-row label {
                display: block;
                font-size: 11px;
                color: #8b949e;
                margin-bottom: 4px;
            }

            .lisesca-config-row input {
                width: 100%;
                background: #0d1117;
                color: #e1e4e8;
                border: 1px solid #30363d;
                border-radius: 4px;
                padding: 5px 8px;
                font-size: 13px;
                box-sizing: border-box;
            }
            .lisesca-config-row input:focus {
                outline: none;
                border-color: #58a6ff;
            }

            .lisesca-config-error {
                color: #f85149;
                font-size: 11px;
                margin-top: 4px;
                min-height: 16px;
            }

            .lisesca-config-buttons {
                display: flex;
                gap: 8px;
                margin-top: 16px;
            }

            .lisesca-config-save {
                flex: 1;
                background: #1f6feb;
                color: #ffffff;
                border: none;
                border-radius: 5px;
                padding: 7px 14px;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                transition: background 0.15s;
            }
            .lisesca-config-save:hover {
                background: #388bfd;
            }

            .lisesca-config-cancel {
                flex: 1;
                background: #21262d;
                color: #c9d1d9;
                border: 1px solid #30363d;
                border-radius: 5px;
                padding: 7px 14px;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                transition: background 0.15s;
            }
            .lisesca-config-cancel:hover {
                background: #30363d;
            }

            /* ---- AI Configuration overlay ---- */
            .lisesca-ai-config-overlay {
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.5);
                z-index: 10002;
                justify-content: center;
                align-items: center;
            }
            .lisesca-ai-config-overlay.lisesca-visible {
                display: flex;
            }

            .lisesca-ai-config-panel {
                background: #1b1f23;
                color: #e1e4e8;
                border-radius: 10px;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
                padding: 20px 24px;
                width: 400px;
                max-width: 90vw;
                max-height: 90vh;
                overflow-y: auto;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 13px;
            }

            .lisesca-ai-config-title {
                font-size: 15px;
                font-weight: 600;
                margin-bottom: 16px;
                color: #f0f6fc;
            }

            .lisesca-ai-config-row {
                margin-bottom: 14px;
            }

            .lisesca-ai-config-row label {
                display: block;
                font-size: 11px;
                color: #8b949e;
                margin-bottom: 4px;
            }

            .lisesca-ai-config-row input[type="password"],
            .lisesca-ai-config-row input[type="text"] {
                width: 100%;
                background: #0d1117;
                color: #e1e4e8;
                border: 1px solid #30363d;
                border-radius: 4px;
                padding: 8px 10px;
                font-size: 13px;
                box-sizing: border-box;
            }
            .lisesca-ai-config-row input:focus {
                outline: none;
                border-color: #58a6ff;
            }

            .lisesca-ai-config-row textarea {
                width: 100%;
                background: #0d1117;
                color: #e1e4e8;
                border: 1px solid #30363d;
                border-radius: 4px;
                padding: 8px 10px;
                font-size: 13px;
                font-family: inherit;
                box-sizing: border-box;
                resize: vertical;
                min-height: 200px;
            }
            .lisesca-ai-config-row textarea:focus {
                outline: none;
                border-color: #58a6ff;
            }

            /* Model selection dropdown and refresh button */
            .lisesca-model-container {
                display: flex;
                gap: 8px;
                align-items: center;
            }

            .lisesca-model-select {
                flex: 1;
                background: #0d1117;
                color: #e1e4e8;
                border: 1px solid #30363d;
                border-radius: 4px;
                padding: 8px 10px;
                font-size: 13px;
                box-sizing: border-box;
                cursor: pointer;
            }
            .lisesca-model-select:focus {
                outline: none;
                border-color: #58a6ff;
            }
            .lisesca-model-select:disabled {
                background: #161b22;
                color: #6e7681;
                cursor: not-allowed;
            }
            .lisesca-model-select optgroup {
                background: #0d1117;
                color: #8b949e;
                font-weight: 600;
                font-style: normal;
            }
            .lisesca-model-select option {
                background: #0d1117;
                color: #e1e4e8;
                padding: 4px;
            }

            .lisesca-model-refresh {
                background: #21262d;
                color: #c9d1d9;
                border: 1px solid #30363d;
                border-radius: 4px;
                padding: 8px 12px;
                font-size: 12px;
                font-weight: 500;
                cursor: pointer;
                white-space: nowrap;
                transition: background 0.15s;
            }
            .lisesca-model-refresh:hover {
                background: #30363d;
            }
            .lisesca-model-refresh:disabled {
                background: #161b22;
                color: #6e7681;
                cursor: not-allowed;
            }

            .lisesca-ai-config-row .lisesca-hint {
                font-size: 10px;
                color: #6e7681;
                margin-top: 4px;
            }

            .lisesca-ai-config-error {
                color: #f85149;
                font-size: 11px;
                margin-top: 4px;
                min-height: 16px;
            }

            .lisesca-ai-config-buttons {
                display: flex;
                gap: 8px;
                margin-top: 16px;
            }

            .lisesca-ai-config-save {
                flex: 1;
                background: #1f6feb;
                color: #ffffff;
                border: none;
                border-radius: 5px;
                padding: 7px 14px;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                transition: background 0.15s;
            }
            .lisesca-ai-config-save:hover {
                background: #388bfd;
            }

            .lisesca-ai-config-cancel {
                flex: 1;
                background: #21262d;
                color: #c9d1d9;
                border: 1px solid #30363d;
                border-radius: 5px;
                padding: 7px 14px;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                transition: background 0.15s;
            }
            .lisesca-ai-config-cancel:hover {
                background: #30363d;
            }

            /* Button to open AI config from main config panel */
            .lisesca-ai-config-btn {
                width: 100%;
                background: #21262d;
                color: #c9d1d9;
                border: 1px solid #30363d;
                border-radius: 5px;
                padding: 7px 14px;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                transition: background 0.15s;
            }
            .lisesca-ai-config-btn:hover {
                background: #30363d;
            }

            /* AI toggle in scrape menu - disabled state */
            .lisesca-checkbox-label.lisesca-disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
            .lisesca-checkbox-label.lisesca-disabled input[type="checkbox"] {
                cursor: not-allowed;
            }
        `);
    },

    /**
     * Build and inject the floating panel, adapting to the current page type.
     * People search: green SCRAPE button, page options 1/10/50/All.
     * Jobs search: blue SCRAPE button, page options 1/3/5/10.
     */
    createPanel: function() {
        var pageType = PageDetector.getPageType();
        var isJobs = (pageType === 'jobs');

        // Create the main container
        this.panel = document.createElement('div');
        this.panel.className = 'lisesca-panel';

        // --- Top bar ---
        var topbar = document.createElement('div');
        topbar.className = 'lisesca-topbar';

        // SCRAPE button — color depends on page type
        var scrapeBtn = document.createElement('button');
        scrapeBtn.className = 'lisesca-scrape-btn' + (isJobs ? ' lisesca-scrape-btn--jobs' : '');
        scrapeBtn.textContent = 'SCRAPE';
        scrapeBtn.addEventListener('click', function() {
            UI.toggleMenu();
        });

        // Gear icon — opens configuration
        var gearBtn = document.createElement('button');
        gearBtn.className = 'lisesca-gear-btn';
        gearBtn.innerHTML = '&#9881;';
        gearBtn.title = 'Configuration';
        gearBtn.addEventListener('click', function() {
            UI.showConfig();
        });

        topbar.appendChild(scrapeBtn);
        topbar.appendChild(gearBtn);

        // --- Dropdown menu ---
        this.menu = document.createElement('div');
        this.menu.className = 'lisesca-menu';

        // "Pages to scrape" label
        var label = document.createElement('div');
        label.className = 'lisesca-menu-label';
        label.textContent = 'Pages to scrape:';

        // Page count selector — different options for people vs jobs
        var select = document.createElement('select');
        select.className = 'lisesca-select';
        select.id = 'lisesca-page-select';

        var options;
        if (isJobs) {
            // Try to read total results count from the page subtitle
            var totalJobsText = '';
            var subtitleEl = document.querySelector('.jobs-search-results-list__subtitle span');
            var totalJobs = 0;
            if (subtitleEl) {
                totalJobsText = (subtitleEl.textContent || '').trim();
                var match = totalJobsText.match(/^([\d,]+)\s+result/);
                if (match) {
                    totalJobs = parseInt(match[1].replace(/,/g, ''), 10);
                }
            }
            var totalPages = totalJobs > 0
                ? Math.ceil(totalJobs / JobPaginator.JOBS_PER_PAGE)
                : 0;

            // Build the "All" label with page count if available
            var allLabel = 'All';
            if (totalJobs > 0) {
                allLabel = 'All (' + totalPages + 'p)';
            }

            options = [
                { value: '1', text: '1' },
                { value: '3', text: '3' },
                { value: '5', text: '5' },
                { value: '10', text: '10' },
                { value: 'all', text: allLabel }
            ];
        } else {
            options = [
                { value: '1', text: '1' },
                { value: '10', text: '10' },
                { value: '50', text: '50' },
                { value: 'all', text: 'All' }
            ];
        }
        options.forEach(function(opt) {
            var option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.text;
            select.appendChild(option);
        });

        // --- Format selection checkboxes ---
        var fmtLabel = document.createElement('div');
        fmtLabel.className = 'lisesca-fmt-label';
        fmtLabel.textContent = 'Save as:';

        var fmtRow = document.createElement('div');
        fmtRow.className = 'lisesca-fmt-row';

        // XLSX checkbox (checked by default)
        var xlsxLabel = document.createElement('label');
        xlsxLabel.className = 'lisesca-checkbox-label';
        var xlsxCheck = document.createElement('input');
        xlsxCheck.type = 'checkbox';
        xlsxCheck.id = 'lisesca-fmt-xlsx';
        xlsxCheck.checked = true;
        xlsxLabel.appendChild(xlsxCheck);
        xlsxLabel.appendChild(document.createTextNode('XLSX'));
        fmtRow.appendChild(xlsxLabel);

        // CSV checkbox — only for people search (not useful for jobs)
        if (!isJobs) {
            var csvLabel = document.createElement('label');
            csvLabel.className = 'lisesca-checkbox-label';
            var csvCheck = document.createElement('input');
            csvCheck.type = 'checkbox';
            csvCheck.id = 'lisesca-fmt-csv';
            csvCheck.checked = false;
            csvLabel.appendChild(csvCheck);
            csvLabel.appendChild(document.createTextNode('CSV'));
            fmtRow.appendChild(csvLabel);
        }

        // Markdown checkbox (unchecked by default)
        var mdLabel = document.createElement('label');
        mdLabel.className = 'lisesca-checkbox-label';
        var mdCheck = document.createElement('input');
        mdCheck.type = 'checkbox';
        mdCheck.id = 'lisesca-fmt-md';
        mdCheck.checked = false;
        mdLabel.appendChild(mdCheck);
        mdLabel.appendChild(document.createTextNode('Markdown'));
        fmtRow.appendChild(mdLabel);

        var includeViewedRow = null;
        var includeViewedCheck = null;
        var aiEnabledRow = null;
        var aiEnabledCheck = null;
        var fullAIRow = null;
        var fullAICheck = null;
        var peopleAIEnabledRow = null;
        var peopleAIEnabledCheck = null;
        if (isJobs) {
            includeViewedRow = document.createElement('div');
            includeViewedRow.className = 'lisesca-toggle-row';

            var includeViewedLabel = document.createElement('label');
            includeViewedLabel.className = 'lisesca-checkbox-label';
            includeViewedCheck = document.createElement('input');
            includeViewedCheck.type = 'checkbox';
            includeViewedCheck.id = 'lisesca-include-viewed';
            includeViewedCheck.checked = State.getIncludeViewed();
            includeViewedCheck.addEventListener('change', function() {
                State.saveIncludeViewed(includeViewedCheck.checked);
            });
            includeViewedLabel.appendChild(includeViewedCheck);
            includeViewedLabel.appendChild(document.createTextNode('Include viewed'));
            includeViewedRow.appendChild(includeViewedLabel);

            // AI job selection toggle
            aiEnabledRow = document.createElement('div');
            aiEnabledRow.className = 'lisesca-toggle-row';

            var aiEnabledLabel = document.createElement('label');
            aiEnabledLabel.className = 'lisesca-checkbox-label';

            // Disable if AI is not configured
            var aiConfigured = CONFIG.isAIConfigured();
            if (!aiConfigured) {
                aiEnabledLabel.classList.add('lisesca-disabled');
            }

            aiEnabledCheck = document.createElement('input');
            aiEnabledCheck.type = 'checkbox';
            aiEnabledCheck.id = 'lisesca-ai-enabled';
            aiEnabledCheck.checked = aiConfigured && State.getAIEnabled();
            aiEnabledCheck.disabled = !aiConfigured;

            aiEnabledLabel.appendChild(aiEnabledCheck);
            aiEnabledLabel.appendChild(document.createTextNode('AI job selection'));
            aiEnabledRow.appendChild(aiEnabledLabel);

            // Full AI evaluation toggle (indented, only visible when AI enabled)
            fullAIRow = document.createElement('div');
            fullAIRow.className = 'lisesca-toggle-row';
            fullAIRow.id = 'lisesca-full-ai-row';
            fullAIRow.style.marginLeft = '16px';  // Visual hierarchy (indented)
            fullAIRow.style.display = (aiConfigured && aiEnabledCheck.checked) ? 'flex' : 'none';

            var fullAILabel = document.createElement('label');
            fullAILabel.className = 'lisesca-checkbox-label';

            fullAICheck = document.createElement('input');
            fullAICheck.type = 'checkbox';
            fullAICheck.id = 'lisesca-full-ai-enabled';
            fullAICheck.checked = aiConfigured && State.getFullAIEnabled();
            fullAICheck.disabled = !aiConfigured;

            // Auto-uncheck "Include viewed" when Full AI is enabled
            fullAICheck.addEventListener('change', function() {
                State.saveFullAIEnabled(fullAICheck.checked);
                if (fullAICheck.checked && includeViewedCheck) {
                    includeViewedCheck.checked = false;
                    State.saveIncludeViewed(false);
                }
            });

            fullAILabel.appendChild(fullAICheck);
            fullAILabel.appendChild(document.createTextNode('Full AI evaluation'));
            fullAIRow.appendChild(fullAILabel);

            // AI enabled toggle controls Full AI row visibility
            aiEnabledCheck.addEventListener('change', function() {
                State.saveAIEnabled(aiEnabledCheck.checked);
                // Show/hide Full AI row based on AI enabled state
                if (aiEnabledCheck.checked) {
                    fullAIRow.style.display = 'flex';
                } else {
                    fullAIRow.style.display = 'none';
                    // Also disable Full AI when AI is disabled
                    fullAICheck.checked = false;
                    State.saveFullAIEnabled(false);
                }
            });
        } else {
            // AI people rating toggle
            peopleAIEnabledRow = document.createElement('div');
            peopleAIEnabledRow.className = 'lisesca-toggle-row';

            var peopleAIEnabledLabel = document.createElement('label');
            peopleAIEnabledLabel.className = 'lisesca-checkbox-label';

            var peopleAIConfigured = CONFIG.isPeopleAIConfigured();
            if (!peopleAIConfigured) {
                peopleAIEnabledLabel.classList.add('lisesca-disabled');
            }

            peopleAIEnabledCheck = document.createElement('input');
            peopleAIEnabledCheck.type = 'checkbox';
            peopleAIEnabledCheck.id = 'lisesca-people-ai-enabled';
            peopleAIEnabledCheck.checked = peopleAIConfigured && State.getPeopleAIEnabled();
            peopleAIEnabledCheck.disabled = !peopleAIConfigured;

            peopleAIEnabledCheck.addEventListener('change', function() {
                State.savePeopleAIEnabled(peopleAIEnabledCheck.checked);
            });

            peopleAIEnabledLabel.appendChild(peopleAIEnabledCheck);
            peopleAIEnabledLabel.appendChild(document.createTextNode('AI Rating'));
            peopleAIEnabledRow.appendChild(peopleAIEnabledLabel);
        }

        // GO button — dispatches to the correct controller
        var goBtn = document.createElement('button');
        goBtn.className = 'lisesca-go-btn';
        goBtn.textContent = 'GO';
        goBtn.addEventListener('click', function() {
            var pageSelect = document.getElementById('lisesca-page-select');
            var selectedValue = pageSelect.value;
            console.log('[LiSeSca] GO pressed, pages=' + selectedValue + ', pageType=' + pageType);

            if (isJobs) {
                State.saveIncludeViewed(State.readIncludeViewedFromUI());
                JobController.startScraping(selectedValue);
            } else {
                Controller.startScraping(selectedValue);
            }
        });

        this.menu.appendChild(label);
        this.menu.appendChild(select);
        this.menu.appendChild(fmtLabel);
        this.menu.appendChild(fmtRow);
        if (includeViewedRow) {
            this.menu.appendChild(includeViewedRow);
        }
        if (aiEnabledRow) {
            this.menu.appendChild(aiEnabledRow);
        }
        if (fullAIRow) {
            this.menu.appendChild(fullAIRow);
        }
        if (peopleAIEnabledRow) {
            this.menu.appendChild(peopleAIEnabledRow);
        }
        this.menu.appendChild(goBtn);

        // --- Status area ---
        this.statusArea = document.createElement('div');
        this.statusArea.className = 'lisesca-status';

        var progressText = document.createElement('div');
        progressText.id = 'lisesca-status-progress';
        progressText.className = 'lisesca-status-progress';
        progressText.textContent = '';

        // AI stats display (shown when AI filtering is active)
        var aiStatsText = document.createElement('div');
        aiStatsText.id = 'lisesca-ai-stats';
        aiStatsText.className = 'lisesca-ai-stats';
        aiStatsText.textContent = '';

        var statusText = document.createElement('div');
        statusText.id = 'lisesca-status-text';
        statusText.textContent = 'Initializing...';

        var stopBtn = document.createElement('button');
        stopBtn.className = 'lisesca-stop-btn';
        stopBtn.textContent = 'STOP';
        stopBtn.addEventListener('click', function() {
            // Dispatch to the correct controller based on active scrape mode
            var mode = State.getScrapeMode();
            if (mode === 'jobs') {
                JobController.stopScraping();
            } else {
                Controller.stopScraping();
            }
        });

        this.statusArea.appendChild(progressText);
        this.statusArea.appendChild(aiStatsText);
        this.statusArea.appendChild(statusText);
        this.statusArea.appendChild(stopBtn);

        // --- No-results notification area ---
        this.noResultsArea = document.createElement('div');
        this.noResultsArea.className = 'lisesca-no-results';
        this.noResultsArea.id = 'lisesca-no-results';

        var noResultsIcon = document.createElement('div');
        noResultsIcon.className = 'lisesca-no-results-icon';
        noResultsIcon.textContent = '\u2205'; // Empty set symbol

        var noResultsTitle = document.createElement('div');
        noResultsTitle.className = 'lisesca-no-results-title';
        noResultsTitle.id = 'lisesca-no-results-title';
        noResultsTitle.textContent = 'No matching jobs found';

        var noResultsStats = document.createElement('div');
        noResultsStats.className = 'lisesca-no-results-stats';
        noResultsStats.id = 'lisesca-no-results-stats';
        noResultsStats.textContent = '';

        var noResultsBtn = document.createElement('button');
        noResultsBtn.className = 'lisesca-no-results-btn';
        noResultsBtn.textContent = 'OK';
        noResultsBtn.addEventListener('click', function() {
            UI.hideNoResults();
        });

        this.noResultsArea.appendChild(noResultsIcon);
        this.noResultsArea.appendChild(noResultsTitle);
        this.noResultsArea.appendChild(noResultsStats);
        this.noResultsArea.appendChild(noResultsBtn);

        // --- Assemble panel ---
        this.panel.appendChild(topbar);
        this.panel.appendChild(this.menu);
        this.panel.appendChild(this.statusArea);
        this.panel.appendChild(this.noResultsArea);

        document.body.appendChild(this.panel);
        console.log('[LiSeSca] UI panel injected (' + pageType + ' mode).');
    },

    /**
     * Toggle the dropdown menu open/closed.
     */
    toggleMenu: function() {
        this.isMenuOpen = !this.isMenuOpen;
        if (this.isMenuOpen) {
            this.updateJobsAllLabel();
            this.updateAIToggleState();
            this.updatePeopleAIToggleState();
            this.menu.classList.add('lisesca-open');
        } else {
            this.menu.classList.remove('lisesca-open');
        }
    },

    /**
     * Refresh the "All (Np)" label for jobs if total is known.
     */
    updateJobsAllLabel: function() {
        if (!PageDetector.isOnJobsPage()) {
            return;
        }
        var select = document.getElementById('lisesca-page-select');
        if (!select) {
            return;
        }
        var subtitleEl = document.querySelector('.jobs-search-results-list__subtitle span');
        var totalJobs = 0;
        if (subtitleEl) {
            var totalJobsText = (subtitleEl.textContent || '').trim();
            var match = totalJobsText.match(/^([\d,]+)\s+result/);
            if (match) {
                totalJobs = parseInt(match[1].replace(/,/g, ''), 10);
            }
        }
        var totalPages = totalJobs > 0
            ? Math.ceil(totalJobs / JobPaginator.JOBS_PER_PAGE)
            : 0;
        var allLabel = (totalPages > 0) ? ('All (' + totalPages + 'p)') : 'All';
        for (var i = 0; i < select.options.length; i += 1) {
            if (select.options[i].value === 'all') {
                select.options[i].textContent = allLabel;
                break;
            }
        }
    },

    /**
     * Show a status message in the status area.
     * @param {string} message - The status text to display.
     */
    showStatus: function(message) {
        this.menu.classList.remove('lisesca-open');
        this.isMenuOpen = false;
        this.statusArea.classList.add('lisesca-visible');
        document.getElementById('lisesca-status-text').textContent = message;
    },

    /**
     * Update the job progress line in the status area.
     * @param {string} message - Progress text to display (empty to hide).
     */
    showProgress: function(message) {
        var progressEl = document.getElementById('lisesca-status-progress');
        if (!progressEl) {
            return;
        }
        if (message) {
            progressEl.textContent = message;
            progressEl.classList.add('lisesca-visible');
        } else {
            progressEl.textContent = '';
            progressEl.classList.remove('lisesca-visible');
        }
    },

    /**
     * Hide the status area.
     */
    hideStatus: function() {
        this.statusArea.classList.remove('lisesca-visible');
    },

    /**
     * Switch the panel into "idle" mode.
     */
    showIdleState: function() {
        this.hideStatus();
        this.showProgress('');
        this.hideAIStats();
        this.hideNoResults();
        this.menu.classList.remove('lisesca-open');
        this.isMenuOpen = false;
    },

    /**
     * Show AI evaluation statistics in the status area.
     * @param {number} evaluated - Number of jobs evaluated by AI.
     * @param {number} accepted - Number of jobs accepted by AI.
     */
    showAIStats: function(evaluated, accepted, labelSuffix) {
        var statsEl = document.getElementById('lisesca-ai-stats');
        if (!statsEl) {
            return;
        }
        if (evaluated > 0) {
            if (labelSuffix === '') {
                statsEl.textContent = 'AI ' + accepted + '/' + evaluated;
            } else {
                var suffix = (labelSuffix === undefined) ? ' accepted' : labelSuffix;
                statsEl.textContent = 'AI: ' + accepted + '/' + evaluated + suffix;
            }
            statsEl.classList.add('lisesca-visible');
        } else {
            statsEl.textContent = '';
            statsEl.classList.remove('lisesca-visible');
        }
    },

    /**
     * Hide the AI stats display.
     */
    hideAIStats: function() {
        var statsEl = document.getElementById('lisesca-ai-stats');
        if (statsEl) {
            statsEl.textContent = '';
            statsEl.classList.remove('lisesca-visible');
        }
    },

    /**
     * Show the no-results notification with statistics.
     * @param {number} evaluated - Number of items evaluated by AI.
     * @param {number} pagesScraped - Number of pages scanned.
     * @param {string} itemType - Type of item ('job' or 'profile'). Defaults to 'job'.
     */
    showNoResults: function(evaluated, pagesScraped, itemType) {
        // Hide status area first
        this.hideStatus();
        this.hideAIStats();

        var type = itemType || 'job';
        var plural = type + (evaluated !== 1 ? 's' : '');

        // Update the title based on item type
        var titleEl = document.getElementById('lisesca-no-results-title');
        if (titleEl) {
            titleEl.textContent = 'No matching ' + plural + ' found';
        }

        // Update the stats text
        var statsEl = document.getElementById('lisesca-no-results-stats');
        if (statsEl) {
            var statsText = evaluated + ' ' + plural + ' scanned';
            if (pagesScraped > 1) {
                statsText += ' across ' + pagesScraped + ' pages';
            }
            statsText += ', none matched your criteria (score >= 3)';
            statsEl.textContent = statsText;
        }

        // Show the no-results area
        var noResultsEl = document.getElementById('lisesca-no-results');
        if (noResultsEl) {
            noResultsEl.classList.add('lisesca-visible');
        }
    },

    /**
     * Hide the no-results notification.
     */
    hideNoResults: function() {
        var noResultsEl = document.getElementById('lisesca-no-results');
        if (noResultsEl) {
            noResultsEl.classList.remove('lisesca-visible');
        }
    },

    // --- Configuration panel ---
    configOverlay: null,

    // --- AI Configuration panel ---
    aiConfigOverlay: null,

    /**
     * Create the configuration panel overlay.
     */
    createConfigPanel: function() {
        this.configOverlay = document.createElement('div');
        this.configOverlay.className = 'lisesca-config-overlay';

        var panel = document.createElement('div');
        panel.className = 'lisesca-config-panel';

        var title = document.createElement('div');
        title.className = 'lisesca-config-title';
        title.textContent = 'LiSeSca Configuration';

        var version = document.createElement('div');
        version.className = 'lisesca-config-version';
        version.textContent = 'v' + CONFIG.VERSION;

        var minRow = document.createElement('div');
        minRow.className = 'lisesca-config-row';

        var minLabel = document.createElement('label');
        minLabel.textContent = 'Minimum page time (seconds):';
        minLabel.htmlFor = 'lisesca-config-min';

        var minInput = document.createElement('input');
        minInput.type = 'number';
        minInput.id = 'lisesca-config-min';
        minInput.min = '5';
        minInput.max = '30';
        minInput.value = CONFIG.MIN_PAGE_TIME.toString();

        minRow.appendChild(minLabel);
        minRow.appendChild(minInput);

        var maxRow = document.createElement('div');
        maxRow.className = 'lisesca-config-row';

        var maxLabel = document.createElement('label');
        maxLabel.textContent = 'Maximum page time (seconds):';
        maxLabel.htmlFor = 'lisesca-config-max';

        var maxInput = document.createElement('input');
        maxInput.type = 'number';
        maxInput.id = 'lisesca-config-max';
        maxInput.min = '15';
        maxInput.max = '120';
        maxInput.value = CONFIG.MAX_PAGE_TIME.toString();

        maxRow.appendChild(maxLabel);
        maxRow.appendChild(maxInput);

        // --- Job timing section ---
        var jobSectionLabel = document.createElement('div');
        jobSectionLabel.className = 'lisesca-config-section';
        jobSectionLabel.textContent = 'Job scraping timing';

        var jobReviewMinRow = document.createElement('div');
        jobReviewMinRow.className = 'lisesca-config-row';

        var jobReviewMinLabel = document.createElement('label');
        jobReviewMinLabel.textContent = 'Min job review time (seconds):';
        jobReviewMinLabel.htmlFor = 'lisesca-config-job-review-min';

        var jobReviewMinInput = document.createElement('input');
        jobReviewMinInput.type = 'number';
        jobReviewMinInput.id = 'lisesca-config-job-review-min';
        jobReviewMinInput.min = '1';
        jobReviewMinInput.max = '30';
        jobReviewMinInput.value = CONFIG.MIN_JOB_REVIEW_TIME.toString();

        jobReviewMinRow.appendChild(jobReviewMinLabel);
        jobReviewMinRow.appendChild(jobReviewMinInput);

        var jobReviewMaxRow = document.createElement('div');
        jobReviewMaxRow.className = 'lisesca-config-row';

        var jobReviewMaxLabel = document.createElement('label');
        jobReviewMaxLabel.textContent = 'Max job review time (seconds):';
        jobReviewMaxLabel.htmlFor = 'lisesca-config-job-review-max';

        var jobReviewMaxInput = document.createElement('input');
        jobReviewMaxInput.type = 'number';
        jobReviewMaxInput.id = 'lisesca-config-job-review-max';
        jobReviewMaxInput.min = '2';
        jobReviewMaxInput.max = '60';
        jobReviewMaxInput.value = CONFIG.MAX_JOB_REVIEW_TIME.toString();

        jobReviewMaxRow.appendChild(jobReviewMaxLabel);
        jobReviewMaxRow.appendChild(jobReviewMaxInput);

        var jobPauseMinRow = document.createElement('div');
        jobPauseMinRow.className = 'lisesca-config-row';

        var jobPauseMinLabel = document.createElement('label');
        jobPauseMinLabel.textContent = 'Min pause between jobs (seconds):';
        jobPauseMinLabel.htmlFor = 'lisesca-config-job-pause-min';

        var jobPauseMinInput = document.createElement('input');
        jobPauseMinInput.type = 'number';
        jobPauseMinInput.id = 'lisesca-config-job-pause-min';
        jobPauseMinInput.min = '0';
        jobPauseMinInput.max = '15';
        jobPauseMinInput.value = CONFIG.MIN_JOB_PAUSE.toString();

        jobPauseMinRow.appendChild(jobPauseMinLabel);
        jobPauseMinRow.appendChild(jobPauseMinInput);

        var jobPauseMaxRow = document.createElement('div');
        jobPauseMaxRow.className = 'lisesca-config-row';

        var jobPauseMaxLabel = document.createElement('label');
        jobPauseMaxLabel.textContent = 'Max pause between jobs (seconds):';
        jobPauseMaxLabel.htmlFor = 'lisesca-config-job-pause-max';

        var jobPauseMaxInput = document.createElement('input');
        jobPauseMaxInput.type = 'number';
        jobPauseMaxInput.id = 'lisesca-config-job-pause-max';
        jobPauseMaxInput.min = '1';
        jobPauseMaxInput.max = '30';
        jobPauseMaxInput.value = CONFIG.MAX_JOB_PAUSE.toString();

        jobPauseMaxRow.appendChild(jobPauseMaxLabel);
        jobPauseMaxRow.appendChild(jobPauseMaxInput);

        // --- AI Filtering section ---
        var aiSectionLabel = document.createElement('div');
        aiSectionLabel.className = 'lisesca-config-section';
        aiSectionLabel.textContent = 'AI Job Filtering';

        var aiConfigBtnRow = document.createElement('div');
        aiConfigBtnRow.className = 'lisesca-config-row';

        var aiConfigBtn = document.createElement('button');
        aiConfigBtn.className = 'lisesca-ai-config-btn';
        aiConfigBtn.textContent = 'AI Filtering...';
        aiConfigBtn.addEventListener('click', function() {
            UI.hideConfig();
            UI.showAIConfig();
        });

        aiConfigBtnRow.appendChild(aiConfigBtn);

        var errorDiv = document.createElement('div');
        errorDiv.className = 'lisesca-config-error';
        errorDiv.id = 'lisesca-config-error';

        var buttonsRow = document.createElement('div');
        buttonsRow.className = 'lisesca-config-buttons';

        var saveBtn = document.createElement('button');
        saveBtn.className = 'lisesca-config-save';
        saveBtn.textContent = 'Save';
        saveBtn.addEventListener('click', function() {
            UI.saveConfig();
        });

        var cancelBtn = document.createElement('button');
        cancelBtn.className = 'lisesca-config-cancel';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', function() {
            UI.hideConfig();
        });

        buttonsRow.appendChild(saveBtn);
        buttonsRow.appendChild(cancelBtn);

        // --- Page timing section label ---
        var pageSectionLabel = document.createElement('div');
        pageSectionLabel.className = 'lisesca-config-section';
        pageSectionLabel.textContent = 'Page scanning timing';

        panel.appendChild(title);
        panel.appendChild(version);
        panel.appendChild(pageSectionLabel);
        panel.appendChild(minRow);
        panel.appendChild(maxRow);
        panel.appendChild(jobSectionLabel);
        panel.appendChild(jobReviewMinRow);
        panel.appendChild(jobReviewMaxRow);
        panel.appendChild(jobPauseMinRow);
        panel.appendChild(jobPauseMaxRow);
        panel.appendChild(aiSectionLabel);
        panel.appendChild(aiConfigBtnRow);
        panel.appendChild(errorDiv);
        panel.appendChild(buttonsRow);

        this.configOverlay.appendChild(panel);

        this.configOverlay.addEventListener('click', function(event) {
            if (event.target === UI.configOverlay) {
                UI.hideConfig();
            }
        });

        document.body.appendChild(this.configOverlay);
    },

    /**
     * Show the configuration panel.
     */
    showConfig: function() {
        document.getElementById('lisesca-config-min').value = CONFIG.MIN_PAGE_TIME.toString();
        document.getElementById('lisesca-config-max').value = CONFIG.MAX_PAGE_TIME.toString();
        document.getElementById('lisesca-config-job-review-min').value = CONFIG.MIN_JOB_REVIEW_TIME.toString();
        document.getElementById('lisesca-config-job-review-max').value = CONFIG.MAX_JOB_REVIEW_TIME.toString();
        document.getElementById('lisesca-config-job-pause-min').value = CONFIG.MIN_JOB_PAUSE.toString();
        document.getElementById('lisesca-config-job-pause-max').value = CONFIG.MAX_JOB_PAUSE.toString();
        document.getElementById('lisesca-config-error').textContent = '';
        this.configOverlay.classList.add('lisesca-visible');
    },

    /**
     * Hide the configuration panel.
     */
    hideConfig: function() {
        this.configOverlay.classList.remove('lisesca-visible');
    },

    /**
     * Validate and save configuration.
     */
    saveConfig: function() {
        var errorDiv = document.getElementById('lisesca-config-error');

        // --- Read all inputs ---
        var minVal = parseInt(document.getElementById('lisesca-config-min').value, 10);
        var maxVal = parseInt(document.getElementById('lisesca-config-max').value, 10);
        var jobReviewMin = parseInt(document.getElementById('lisesca-config-job-review-min').value, 10);
        var jobReviewMax = parseInt(document.getElementById('lisesca-config-job-review-max').value, 10);
        var jobPauseMin = parseInt(document.getElementById('lisesca-config-job-pause-min').value, 10);
        var jobPauseMax = parseInt(document.getElementById('lisesca-config-job-pause-max').value, 10);

        // --- Validate all values ---
        if (isNaN(minVal) || isNaN(maxVal) || isNaN(jobReviewMin)
            || isNaN(jobReviewMax) || isNaN(jobPauseMin) || isNaN(jobPauseMax)) {
            errorDiv.textContent = 'Please enter valid numbers in all fields.';
            return;
        }

        // Page timing validation
        if (minVal < 5 || minVal > 30) {
            errorDiv.textContent = 'Min page time must be between 5 and 30 seconds.';
            return;
        }
        if (maxVal < 15 || maxVal > 120) {
            errorDiv.textContent = 'Max page time must be between 15 and 120 seconds.';
            return;
        }
        if (maxVal <= minVal) {
            errorDiv.textContent = 'Max page time must be greater than minimum.';
            return;
        }

        // Job review timing validation
        if (jobReviewMin < 1 || jobReviewMin > 30) {
            errorDiv.textContent = 'Min job review time must be between 1 and 30 seconds.';
            return;
        }
        if (jobReviewMax < 2 || jobReviewMax > 60) {
            errorDiv.textContent = 'Max job review time must be between 2 and 60 seconds.';
            return;
        }
        if (jobReviewMax <= jobReviewMin) {
            errorDiv.textContent = 'Max job review time must be greater than minimum.';
            return;
        }

        // Job pause validation
        if (jobPauseMin < 0 || jobPauseMin > 15) {
            errorDiv.textContent = 'Min job pause must be between 0 and 15 seconds.';
            return;
        }
        if (jobPauseMax < 1 || jobPauseMax > 30) {
            errorDiv.textContent = 'Max job pause must be between 1 and 30 seconds.';
            return;
        }
        if (jobPauseMax <= jobPauseMin) {
            errorDiv.textContent = 'Max job pause must be greater than minimum.';
            return;
        }

        // --- Apply all values ---
        CONFIG.MIN_PAGE_TIME = minVal;
        CONFIG.MAX_PAGE_TIME = maxVal;
        CONFIG.MIN_JOB_REVIEW_TIME = jobReviewMin;
        CONFIG.MAX_JOB_REVIEW_TIME = jobReviewMax;
        CONFIG.MIN_JOB_PAUSE = jobPauseMin;
        CONFIG.MAX_JOB_PAUSE = jobPauseMax;
        CONFIG.save();

        console.log('[LiSeSca] Config updated:', {
            pageTime: minVal + '-' + maxVal + 's',
            jobReview: jobReviewMin + '-' + jobReviewMax + 's',
            jobPause: jobPauseMin + '-' + jobPauseMax + 's'
        });
        this.hideConfig();
    },

    // --- AI Configuration panel methods ---

    /**
     * Create the AI configuration panel overlay.
     */
    createAIConfigPanel: function() {
        this.aiConfigOverlay = document.createElement('div');
        this.aiConfigOverlay.className = 'lisesca-ai-config-overlay';

        var panel = document.createElement('div');
        panel.className = 'lisesca-ai-config-panel';

        var title = document.createElement('div');
        title.className = 'lisesca-ai-config-title';
        title.textContent = 'AI Filtering Configuration';

        // API Key row
        var apiKeyRow = document.createElement('div');
        apiKeyRow.className = 'lisesca-ai-config-row';

        var apiKeyLabel = document.createElement('label');
        apiKeyLabel.textContent = 'Anthropic API Key:';
        apiKeyLabel.htmlFor = 'lisesca-ai-api-key';

        var apiKeyInput = document.createElement('input');
        apiKeyInput.type = 'password';
        apiKeyInput.id = 'lisesca-ai-api-key';
        apiKeyInput.placeholder = 'sk-ant-...';
        apiKeyInput.value = CONFIG.ANTHROPIC_API_KEY || '';

        var apiKeyHint = document.createElement('div');
        apiKeyHint.className = 'lisesca-hint';
        apiKeyHint.textContent = 'Get your API key from console.anthropic.com';

        apiKeyRow.appendChild(apiKeyLabel);
        apiKeyRow.appendChild(apiKeyInput);
        apiKeyRow.appendChild(apiKeyHint);

        // Moonshot API Key row
        var moonshotKeyRow = document.createElement('div');
        moonshotKeyRow.className = 'lisesca-ai-config-row';

        var moonshotKeyLabel = document.createElement('label');
        moonshotKeyLabel.textContent = 'Moonshot API Key:';
        moonshotKeyLabel.htmlFor = 'lisesca-moonshot-api-key';

        var moonshotKeyInput = document.createElement('input');
        moonshotKeyInput.type = 'password';
        moonshotKeyInput.id = 'lisesca-moonshot-api-key';
        moonshotKeyInput.placeholder = 'sk-...';
        moonshotKeyInput.value = CONFIG.MOONSHOT_API_KEY || '';

        var moonshotKeyHint = document.createElement('div');
        moonshotKeyHint.className = 'lisesca-hint';
        moonshotKeyHint.textContent = 'Get your API key from platform.moonshot.ai';

        moonshotKeyRow.appendChild(moonshotKeyLabel);
        moonshotKeyRow.appendChild(moonshotKeyInput);
        moonshotKeyRow.appendChild(moonshotKeyHint);

        // Model selection row
        var modelRow = document.createElement('div');
        modelRow.className = 'lisesca-ai-config-row';

        var modelLabel = document.createElement('label');
        modelLabel.textContent = 'Model:';
        modelLabel.htmlFor = 'lisesca-ai-model';

        var modelContainer = document.createElement('div');
        modelContainer.className = 'lisesca-model-container';

        var modelSelect = document.createElement('select');
        modelSelect.id = 'lisesca-ai-model';
        modelSelect.className = 'lisesca-model-select';

        var refreshBtn = document.createElement('button');
        refreshBtn.type = 'button';
        refreshBtn.className = 'lisesca-model-refresh';
        refreshBtn.textContent = 'Refresh';
        refreshBtn.addEventListener('click', function() {
            UI.refreshModels();
        });

        modelContainer.appendChild(modelSelect);
        modelContainer.appendChild(refreshBtn);

        var modelHint = document.createElement('div');
        modelHint.className = 'lisesca-hint';
        modelHint.textContent = 'Select AI model. Click Refresh to fetch available models.';

        modelRow.appendChild(modelLabel);
        modelRow.appendChild(modelContainer);
        modelRow.appendChild(modelHint);

        // Job Criteria row
        var criteriaRow = document.createElement('div');
        criteriaRow.className = 'lisesca-ai-config-row';

        var criteriaLabel = document.createElement('label');
        criteriaLabel.textContent = 'Job Search Criteria:';
        criteriaLabel.htmlFor = 'lisesca-ai-criteria';

        var criteriaTextarea = document.createElement('textarea');
        criteriaTextarea.id = 'lisesca-ai-criteria';
        criteriaTextarea.rows = 10;
        criteriaTextarea.placeholder = 'Describe the job you are looking for...\n\nExample:\nI am looking for Senior Software Engineering Manager roles.\nI have 15 years of experience in software development.\nI prefer remote or hybrid positions.\nI am NOT interested in:\n- Manufacturing or industrial positions\n- Roles requiring specific domain expertise I don\'t have';
        criteriaTextarea.value = CONFIG.JOB_CRITERIA || '';

        var criteriaHint = document.createElement('div');
        criteriaHint.className = 'lisesca-hint';
        criteriaHint.textContent = 'Describe your ideal job. Be specific about what you want and don\'t want.';

        criteriaRow.appendChild(criteriaLabel);
        criteriaRow.appendChild(criteriaTextarea);
        criteriaRow.appendChild(criteriaHint);

        // People Criteria row
        var peopleCriteriaRow = document.createElement('div');
        peopleCriteriaRow.className = 'lisesca-ai-config-row';

        var peopleCriteriaLabel = document.createElement('label');
        peopleCriteriaLabel.textContent = 'People Search Criteria:';
        peopleCriteriaLabel.htmlFor = 'lisesca-ai-people-criteria';

        var peopleCriteriaTextarea = document.createElement('textarea');
        peopleCriteriaTextarea.id = 'lisesca-ai-people-criteria';
        peopleCriteriaTextarea.rows = 10;
        peopleCriteriaTextarea.placeholder = 'Describe the kind of people you want to connect with...\n\nExample:\nI am looking for senior engineers and engineering managers in Berlin.\nI want people who work in B2B SaaS or AI startups.\nI am NOT interested in:\n- Sales or HR roles\n- People outside the DACH region';
        peopleCriteriaTextarea.value = CONFIG.PEOPLE_CRITERIA || '';

        var peopleCriteriaHint = document.createElement('div');
        peopleCriteriaHint.className = 'lisesca-hint';
        peopleCriteriaHint.textContent = 'Describe your target contacts (roles, industries, locations, etc.).';

        peopleCriteriaRow.appendChild(peopleCriteriaLabel);
        peopleCriteriaRow.appendChild(peopleCriteriaTextarea);
        peopleCriteriaRow.appendChild(peopleCriteriaHint);

        // Error display
        var errorDiv = document.createElement('div');
        errorDiv.className = 'lisesca-ai-config-error';
        errorDiv.id = 'lisesca-ai-config-error';

        // Buttons
        var buttonsRow = document.createElement('div');
        buttonsRow.className = 'lisesca-ai-config-buttons';

        var saveBtn = document.createElement('button');
        saveBtn.className = 'lisesca-ai-config-save';
        saveBtn.textContent = 'Save';
        saveBtn.addEventListener('click', function() {
            UI.saveAIConfig();
        });

        var cancelBtn = document.createElement('button');
        cancelBtn.className = 'lisesca-ai-config-cancel';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', function() {
            UI.hideAIConfig();
        });

        buttonsRow.appendChild(saveBtn);
        buttonsRow.appendChild(cancelBtn);

        // Assemble panel
        panel.appendChild(title);
        panel.appendChild(apiKeyRow);
        panel.appendChild(moonshotKeyRow);
        panel.appendChild(modelRow);
        panel.appendChild(criteriaRow);
        panel.appendChild(peopleCriteriaRow);
        panel.appendChild(errorDiv);
        panel.appendChild(buttonsRow);

        this.aiConfigOverlay.appendChild(panel);

        // Close on overlay click
        this.aiConfigOverlay.addEventListener('click', function(event) {
            if (event.target === UI.aiConfigOverlay) {
                UI.hideAIConfig();
            }
        });

        document.body.appendChild(this.aiConfigOverlay);
    },

    /**
     * Show the AI configuration panel.
     */
    showAIConfig: function() {
        document.getElementById('lisesca-ai-api-key').value = CONFIG.ANTHROPIC_API_KEY || '';
        document.getElementById('lisesca-moonshot-api-key').value = CONFIG.MOONSHOT_API_KEY || '';
        document.getElementById('lisesca-ai-criteria').value = CONFIG.JOB_CRITERIA || '';
        document.getElementById('lisesca-ai-people-criteria').value = CONFIG.PEOPLE_CRITERIA || '';
        document.getElementById('lisesca-ai-config-error').textContent = '';
        this.populateModelDropdown();
        this.aiConfigOverlay.classList.add('lisesca-visible');
    },

    /**
     * Hide the AI configuration panel.
     */
    hideAIConfig: function() {
        this.aiConfigOverlay.classList.remove('lisesca-visible');
    },

    /**
     * Populate the model dropdown with cached models, grouped by provider.
     * Models are shown in optgroups by provider. Only providers with valid
     * API keys are shown.
     */
    populateModelDropdown: function() {
        var select = document.getElementById('lisesca-ai-model');
        var anthropicKey = document.getElementById('lisesca-ai-api-key').value.trim();
        var moonshotKey = document.getElementById('lisesca-moonshot-api-key').value.trim();

        // Clear existing options
        select.innerHTML = '';

        // Check if we have any API keys
        if (!anthropicKey && !moonshotKey) {
            var placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = '(Enter API key first)';
            placeholder.disabled = true;
            placeholder.selected = true;
            select.appendChild(placeholder);
            select.disabled = true;
            return;
        }

        select.disabled = false;

        // Add default empty option
        var defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = '-- Select Model --';
        select.appendChild(defaultOpt);

        // Add Anthropic models if key is present
        if (anthropicKey && CONFIG.CACHED_MODELS.anthropic && CONFIG.CACHED_MODELS.anthropic.length > 0) {
            var anthropicGroup = document.createElement('optgroup');
            anthropicGroup.label = 'Anthropic';
            CONFIG.CACHED_MODELS.anthropic.forEach(function(model) {
                var opt = document.createElement('option');
                opt.value = model.id;
                opt.textContent = model.name || model.id;
                anthropicGroup.appendChild(opt);
            });
            select.appendChild(anthropicGroup);
        }

        // Add Moonshot models if key is present
        if (moonshotKey && CONFIG.CACHED_MODELS.moonshot && CONFIG.CACHED_MODELS.moonshot.length > 0) {
            var moonshotGroup = document.createElement('optgroup');
            moonshotGroup.label = 'Moonshot';
            CONFIG.CACHED_MODELS.moonshot.forEach(function(model) {
                var opt = document.createElement('option');
                opt.value = model.id;
                opt.textContent = model.name || model.id;
                moonshotGroup.appendChild(opt);
            });
            select.appendChild(moonshotGroup);
        }

        // If no cached models, show hint
        if (select.options.length === 1) {
            var hint = document.createElement('option');
            hint.value = '';
            hint.textContent = '(Click Refresh to fetch models)';
            hint.disabled = true;
            select.appendChild(hint);
        }

        // Set selected value
        if (CONFIG.AI_MODEL) {
            select.value = CONFIG.AI_MODEL;
        }
    },

    /**
     * Fetch available models from all providers with valid API keys.
     * Updates the cached models and repopulates the dropdown.
     */
    refreshModels: function() {
        var self = this;
        var anthropicKey = document.getElementById('lisesca-ai-api-key').value.trim();
        var moonshotKey = document.getElementById('lisesca-moonshot-api-key').value.trim();
        var refreshBtn = document.querySelector('.lisesca-model-refresh');
        var errorDiv = document.getElementById('lisesca-ai-config-error');

        if (!anthropicKey && !moonshotKey) {
            errorDiv.textContent = 'Enter at least one API key to fetch models.';
            return;
        }

        // Disable refresh button and show loading state
        refreshBtn.disabled = true;
        refreshBtn.textContent = 'Loading...';
        errorDiv.textContent = '';

        // Temporarily update CONFIG with current key values for fetching
        var originalAnthropicKey = CONFIG.ANTHROPIC_API_KEY;
        var originalMoonshotKey = CONFIG.MOONSHOT_API_KEY;
        CONFIG.ANTHROPIC_API_KEY = anthropicKey;
        CONFIG.MOONSHOT_API_KEY = moonshotKey;

        AIClient.fetchAllModels().then(function(results) {
            // Update cached models
            if (results.anthropic) {
                CONFIG.CACHED_MODELS.anthropic = results.anthropic;
                CONFIG.CACHED_MODELS.lastFetch.anthropic = Date.now();
            }
            if (results.moonshot) {
                CONFIG.CACHED_MODELS.moonshot = results.moonshot;
                CONFIG.CACHED_MODELS.lastFetch.moonshot = Date.now();
            }

            // Save cache to persistent storage
            CONFIG.saveAIConfig();

            // Repopulate dropdown
            self.populateModelDropdown();

            // Show success message
            var count = (results.anthropic ? results.anthropic.length : 0)
                + (results.moonshot ? results.moonshot.length : 0);
            console.log('[LiSeSca] Fetched ' + count + ' models from providers');

        }).catch(function(error) {
            console.error('[LiSeSca] Error fetching models:', error);
            errorDiv.textContent = 'Error fetching models: ' + error.message;

            // Restore original keys on error
            CONFIG.ANTHROPIC_API_KEY = originalAnthropicKey;
            CONFIG.MOONSHOT_API_KEY = originalMoonshotKey;

        }).finally(function() {
            // Re-enable refresh button
            refreshBtn.disabled = false;
            refreshBtn.textContent = 'Refresh';
        });
    },

    /**
     * Validate and save AI configuration.
     */
    saveAIConfig: function() {
        var errorDiv = document.getElementById('lisesca-ai-config-error');
        var anthropicKey = document.getElementById('lisesca-ai-api-key').value.trim();
        var moonshotKey = document.getElementById('lisesca-moonshot-api-key').value.trim();
        var selectedModel = document.getElementById('lisesca-ai-model').value;
        var criteria = document.getElementById('lisesca-ai-criteria').value.trim();
        var peopleCriteria = document.getElementById('lisesca-ai-people-criteria').value.trim();

        // At least one API key is required if any criteria is set
        if (!anthropicKey && !moonshotKey && (criteria || peopleCriteria)) {
            errorDiv.textContent = 'Please enter at least one API key to enable AI filtering.';
            return;
        }

        // Basic API key format validation for Anthropic
        if (anthropicKey && !anthropicKey.startsWith('sk-ant-')) {
            errorDiv.textContent = 'Anthropic API key should start with "sk-ant-"';
            return;
        }

        // Basic API key format validation for Moonshot
        if (moonshotKey && !moonshotKey.startsWith('sk-')) {
            errorDiv.textContent = 'Moonshot API key should start with "sk-"';
            return;
        }

        // Validate that selected model's provider has a key
        if (selectedModel) {
            var provider = CONFIG.getProviderForModel(selectedModel);
            if (provider === 'anthropic' && !anthropicKey) {
                errorDiv.textContent = 'Anthropic API key is required for the selected model.';
                return;
            }
            if (provider === 'moonshot' && !moonshotKey) {
                errorDiv.textContent = 'Moonshot API key is required for the selected model.';
                return;
            }
        }

        // Save to CONFIG
        CONFIG.ANTHROPIC_API_KEY = anthropicKey;
        CONFIG.MOONSHOT_API_KEY = moonshotKey;
        CONFIG.AI_MODEL = selectedModel;
        CONFIG.JOB_CRITERIA = criteria;
        CONFIG.PEOPLE_CRITERIA = peopleCriteria;
        CONFIG.saveAIConfig();

        // Update the AI toggle state in the menu if it exists
        this.updateAIToggleState();
        this.updatePeopleAIToggleState();

        console.log('[LiSeSca] AI config saved. Model: ' + selectedModel
            + ', Job configured: ' + CONFIG.isAIConfigured()
            + ', People configured: ' + CONFIG.isPeopleAIConfigured());
        this.hideAIConfig();
    },

    /**
     * Update the AI toggle checkbox state based on configuration.
     * Disables the checkbox if AI is not configured.
     * Also updates the Full AI toggle visibility and state.
     */
    updateAIToggleState: function() {
        var aiCheck = document.getElementById('lisesca-ai-enabled');
        var aiLabel = aiCheck ? aiCheck.closest('.lisesca-checkbox-label') : null;
        var fullAIRow = document.getElementById('lisesca-full-ai-row');
        var fullAICheck = document.getElementById('lisesca-full-ai-enabled');

        if (!aiCheck || !aiLabel) {
            return;
        }

        var isConfigured = CONFIG.isAIConfigured();
        aiCheck.disabled = !isConfigured;

        if (isConfigured) {
            aiLabel.classList.remove('lisesca-disabled');
        } else {
            aiLabel.classList.add('lisesca-disabled');
            aiCheck.checked = false;
            State.saveAIEnabled(false);
        }

        // Update Full AI toggle state
        if (fullAIRow && fullAICheck) {
            if (isConfigured && aiCheck.checked) {
                fullAIRow.style.display = 'flex';
                fullAICheck.disabled = false;
            } else {
                fullAIRow.style.display = 'none';
                fullAICheck.checked = false;
                fullAICheck.disabled = true;
                State.saveFullAIEnabled(false);
            }
        }
    },

    /**
     * Update the People AI toggle checkbox state based on configuration.
     * Disables the checkbox if AI is not configured.
     */
    updatePeopleAIToggleState: function() {
        var aiCheck = document.getElementById('lisesca-people-ai-enabled');
        var aiLabel = aiCheck ? aiCheck.closest('.lisesca-checkbox-label') : null;

        if (!aiCheck || !aiLabel) {
            return;
        }

        var isConfigured = CONFIG.isPeopleAIConfigured();
        aiCheck.disabled = !isConfigured;

        if (isConfigured) {
            aiLabel.classList.remove('lisesca-disabled');
        } else {
            aiLabel.classList.add('lisesca-disabled');
            aiCheck.checked = false;
            State.savePeopleAIEnabled(false);
        }
    },

    // --- SPA Navigation Support ---

    /**
     * Check if the main panel currently exists in the DOM.
     * @returns {boolean}
     */
    isPanelActive: function() {
        return this.panel !== null && document.body.contains(this.panel);
    },

    /**
     * Remove the main floating panel from the DOM.
     */
    removePanel: function() {
        if (this.panel && this.panel.parentNode) {
            this.panel.parentNode.removeChild(this.panel);
            console.log('[LiSeSca] UI panel removed.');
        }
        this.panel = null;
        this.menu = null;
        this.statusArea = null;
        this.noResultsArea = null;
        this.isMenuOpen = false;
    },

    /**
     * Remove the configuration overlay from the DOM.
     */
    removeConfigPanel: function() {
        if (this.configOverlay && this.configOverlay.parentNode) {
            this.configOverlay.parentNode.removeChild(this.configOverlay);
            console.log('[LiSeSca] Config panel removed.');
        }
        this.configOverlay = null;
    },

    /**
     * Remove the AI configuration overlay from the DOM.
     */
    removeAIConfigPanel: function() {
        if (this.aiConfigOverlay && this.aiConfigOverlay.parentNode) {
            this.aiConfigOverlay.parentNode.removeChild(this.aiConfigOverlay);
            console.log('[LiSeSca] AI config panel removed.');
        }
        this.aiConfigOverlay = null;
    },

    /**
     * Remove existing panels and create fresh ones for the current page type.
     * Used when SPA navigation changes the page type.
     */
    rebuildPanel: function() {
        this.removePanel();
        this.removeConfigPanel();
        this.removeAIConfigPanel();
        this.createPanel();
        this.createConfigPanel();
        this.createAIConfigPanel();
        console.log('[LiSeSca] UI panels rebuilt for new page.');
    }
};
