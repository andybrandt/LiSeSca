    // ===== USER INTERFACE =====
    // Creates and manages the floating overlay panel with scrape controls.
    // Adapts to the current page type: green SCRAPE button for people search,
    // blue SCRAPE button for jobs search, with different page count options.
    const UI = {
        /** References to key DOM elements */
        panel: null,
        menu: null,
        statusArea: null,
        isMenuOpen: false,

        /**
         * Inject all LiSeSca styles into the page.
         */
        injectStyles: function() {
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

            // GO button — dispatches to the correct controller
            var goBtn = document.createElement('button');
            goBtn.className = 'lisesca-go-btn';
            goBtn.textContent = 'GO';
            goBtn.addEventListener('click', function() {
                var pageSelect = document.getElementById('lisesca-page-select');
                var selectedValue = pageSelect.value;
                console.log('[LiSeSca] GO pressed, pages=' + selectedValue + ', pageType=' + pageType);

                if (isJobs) {
                    JobController.startScraping(selectedValue);
                } else {
                    Controller.startScraping(selectedValue);
                }
            });

            this.menu.appendChild(label);
            this.menu.appendChild(select);
            this.menu.appendChild(fmtLabel);
            this.menu.appendChild(fmtRow);
            this.menu.appendChild(goBtn);

            // --- Status area ---
            this.statusArea = document.createElement('div');
            this.statusArea.className = 'lisesca-status';

            var progressText = document.createElement('div');
            progressText.id = 'lisesca-status-progress';
            progressText.className = 'lisesca-status-progress';
            progressText.textContent = '';

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
            this.statusArea.appendChild(statusText);
            this.statusArea.appendChild(stopBtn);

            // --- Assemble panel ---
            this.panel.appendChild(topbar);
            this.panel.appendChild(this.menu);
            this.panel.appendChild(this.statusArea);

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
            this.menu.classList.remove('lisesca-open');
            this.isMenuOpen = false;
        },

        // --- Configuration panel ---
        configOverlay: null,

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
            panel.appendChild(pageSectionLabel);
            panel.appendChild(minRow);
            panel.appendChild(maxRow);
            panel.appendChild(jobSectionLabel);
            panel.appendChild(jobReviewMinRow);
            panel.appendChild(jobReviewMaxRow);
            panel.appendChild(jobPauseMinRow);
            panel.appendChild(jobPauseMaxRow);
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
        }
    };


