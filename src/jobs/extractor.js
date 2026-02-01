// ===== JOB DATA EXTRACTION =====
// Extracts job data from the left-panel cards and right-panel detail view.
// The flow is: click a card → wait for detail panel → extract all fields.
import { JobSelectors } from '../selectors/jobs.js';
import { Emulator } from '../people/emulator.js';
import { htmlToMarkdown } from '../shared/turndown.js';

export const JobExtractor = {
    /**
     * Ensure a job card is rendered and return it along with its shell.
     * @param {string} jobId - The job ID to locate.
     * @returns {Promise<Object>} { card: HTMLElement|null, shell: HTMLElement|null }
     */
    getRenderedCard: function(jobId) {
        var card = document.querySelector('div[data-job-id="' + jobId + '"]');
        if (card) {
            return Promise.resolve({ card: card, shell: null });
        }

        var shell = document.querySelector('li[data-occludable-job-id="' + jobId + '"]');
        if (!shell) {
            return Promise.resolve({ card: null, shell: null });
        }

        shell.scrollIntoView({ behavior: 'smooth', block: 'center' });

        var maxAttempts = 20;  // 20 * 200ms = 4 seconds max wait
        var attempt = 0;

        function waitForRender() {
            attempt++;
            return Emulator.randomDelay(150, 250).then(function() {
                var rendered = document.querySelector('div[data-job-id="' + jobId + '"]');
                if (rendered) {
                    return rendered;
                }
                if (attempt >= maxAttempts) {
                    console.warn('[LiSeSca] Card ' + jobId + ' did not render after ' + attempt + ' attempts.');
                    return null;
                }
                return waitForRender();
            });
        }

        return waitForRender().then(function(renderedCard) {
            return { card: renderedCard, shell: shell };
        });
    },

    /**
     * Check if a job card is marked as "Viewed" or "Applied".
     * @param {string} jobId - The job ID to check.
     * @returns {Promise<boolean>} True if the card shows "Viewed" or "Applied".
     */
    isJobViewed: function(jobId) {
        var self = this;
        return self.getRenderedCard(jobId).then(function(result) {
            if (!result.card) {
                return false;
            }
            var stateEl = result.card.querySelector(JobSelectors.CARD_FOOTER_JOB_STATE);
            if (!stateEl) {
                return false;
            }
            var stateText = (stateEl.textContent || '').trim();
            return stateText.match(/viewed|applied/i) ? true : false;
        });
    },

    /**
     * Wait for job cards to appear in the DOM.
     * Polls for up to 10 seconds.
     * @returns {Promise<NodeList>} The list of job card elements.
     */
    waitForJobCards: function() {
        return new Promise(function(resolve, reject) {
            var maxWaitMs = 10000;
            var pollIntervalMs = 500;
            var elapsed = 0;

            var poll = setInterval(function() {
                var cards = document.querySelectorAll(JobSelectors.JOB_CARD);
                if (cards.length > 0) {
                    clearInterval(poll);
                    console.log('[LiSeSca] Found ' + cards.length + ' job cards.');
                    resolve(cards);
                    return;
                }
                elapsed += pollIntervalMs;
                if (elapsed >= maxWaitMs) {
                    clearInterval(poll);
                    console.warn('[LiSeSca] No job cards found after ' + maxWaitMs + 'ms.');
                    reject(new Error('No job cards found on this page.'));
                }
            }, pollIntervalMs);
        });
    },

    /**
     * Get job IDs from fully-rendered cards in the DOM (snapshot).
     * LinkedIn virtualizes the job list — only ~7-8 cards have inner content
     * at a time. This method only finds those rendered cards.
     * Use discoverAllJobIds() to get ALL job IDs from the shell <li> elements.
     * @returns {Array<string>} Array of job ID strings from rendered cards only.
     */
    getJobIds: function() {
        var cards = document.querySelectorAll(JobSelectors.JOB_CARD);
        var ids = [];
        cards.forEach(function(card) {
            var jobId = card.getAttribute('data-job-id');
            if (jobId) {
                ids.push(jobId);
            }
        });
        return ids;
    },

    /**
     * Discover all job IDs on the page using the outer <li> shell elements.
     * LinkedIn virtualizes the job list — only ~7 cards have fully rendered
     * inner content at a time, but ALL jobs have lightweight <li> shells
     * with data-occludable-job-id attributes present in the DOM from the start.
     *
     * After a page navigation, Ember may not have inserted all shells yet
     * when the first rendered cards appear. So we poll until the shell count
     * stabilizes (same count for 3 consecutive checks).
     * @returns {Promise<Array<string>>} Array of all discovered job ID strings.
     */
    discoverAllJobIds: function() {
        var self = this;
        var previousCount = 0;
        var stableChecks = 0;
        var requiredStable = 3;  // Must see same count 3 times in a row
        var maxAttempts = 20;    // 20 * 300ms = 6 seconds max
        var attempt = 0;

        /**
         * Collect IDs from shell elements and check if count has stabilized.
         * @returns {Promise<Array<string>>} Resolved when stable.
         */
        function pollUntilStable() {
            attempt++;
            var listItems = document.querySelectorAll(JobSelectors.JOB_LIST_ITEM);
            var currentCount = listItems.length;

            if (currentCount === previousCount && currentCount > 0) {
                stableChecks++;
            } else {
                stableChecks = 0;
                previousCount = currentCount;
            }

            if (stableChecks >= requiredStable || attempt >= maxAttempts) {
                // Collect the final set of IDs
                var allIds = [];
                listItems.forEach(function(li) {
                    var jobId = li.getAttribute('data-occludable-job-id');
                    if (jobId && allIds.indexOf(jobId) === -1) {
                        allIds.push(jobId);
                    }
                });

                console.log('[LiSeSca] Discovered ' + allIds.length + ' job IDs from list item shells'
                    + ' (stabilized after ' + attempt + ' checks).');

                // Fallback: if no occludable shells found, try rendered cards directly
                if (allIds.length === 0) {
                    allIds = self.getJobIds();
                    console.log('[LiSeSca] Fallback: found ' + allIds.length + ' job IDs from rendered cards.');
                }

                return Promise.resolve(allIds);
            }

            return Emulator.randomDelay(250, 350).then(function() {
                return pollUntilStable();
            });
        }

        return pollUntilStable();
    },

    /**
     * Extract basic data from a job card element (left panel only).
     * @param {HTMLElement} card - The job card div with data-job-id.
     * @returns {Object} Basic job data: jobId, jobTitle, company, location, directLink.
     */
    extractCardBasics: function(card) {
        var jobId = card.getAttribute('data-job-id') || '';

        // Job title from the card's title link
        var titleLink = card.querySelector(JobSelectors.CARD_TITLE_LINK);
        var jobTitle = '';
        var directLink = '';
        if (titleLink) {
            // The aria-label often has the cleanest title text
            jobTitle = (titleLink.getAttribute('aria-label') || '').trim();
            // Remove " with verification" suffix that LinkedIn adds
            jobTitle = jobTitle.replace(/\s+with verification\s*$/i, '').trim();
            // Fall back to text content if aria-label is empty
            if (!jobTitle) {
                // Get just the strong/text content, avoiding SVG text
                var strongEl = titleLink.querySelector('strong');
                jobTitle = strongEl ? (strongEl.textContent || '').trim() : (titleLink.textContent || '').trim();
            }
            // Build clean job link
            directLink = 'https://www.linkedin.com/jobs/view/' + jobId + '/';
        }

        // Company name from the subtitle span
        var companyEl = card.querySelector(JobSelectors.CARD_COMPANY);
        var company = companyEl ? (companyEl.textContent || '').trim() : '';

        // Location from the metadata list
        var metadataEl = card.querySelector(JobSelectors.CARD_METADATA);
        var location = metadataEl ? (metadataEl.textContent || '').trim() : '';

        // Insight text (e.g. "3 connections work here", "You'd be a top applicant")
        var insightEl = card.querySelector(JobSelectors.CARD_INSIGHT);
        var insight = insightEl ? (insightEl.textContent || '').trim() : '';

        // Viewed state from the card footer (if present)
        var viewedEl = card.querySelector(JobSelectors.CARD_FOOTER_JOB_STATE);
        var stateText = viewedEl ? (viewedEl.textContent || '').trim() : '';
        var viewed = stateText.match(/viewed|applied/i) ? true : false;

        return {
            jobId: jobId,
            jobTitle: jobTitle,
            company: company,
            location: location,
            directLink: directLink,
            cardInsight: insight,
            viewed: viewed,
            jobState: stateText
        };
    },

    /**
     * Format job card basics as Markdown for AI evaluation.
     * Produces a concise summary for the AI to evaluate relevance.
     * @param {Object} cardData - The card data from extractCardBasics.
     * @returns {string} Markdown-formatted job card summary.
     */
    formatCardForAI: function(cardData) {
        var lines = [
            '## ' + (cardData.jobTitle || 'Unknown Title'),
            '**Company:** ' + (cardData.company || 'Unknown'),
            '**Location:** ' + (cardData.location || 'Not specified')
        ];

        if (cardData.cardInsight) {
            lines.push('**Insight:** ' + cardData.cardInsight);
        }

        return lines.join('\n');
    },

    /**
     * Click a job card to load its detail panel on the right.
     * LinkedIn virtualizes the job list — only ~7-8 cards have rendered
     * inner content at a time. The rest are empty <li> shells with
     * data-occludable-job-id. To click a non-rendered card, we first
     * scroll its <li> shell into view to trigger Ember.js rendering,
     * then wait for the inner div[data-job-id] to appear, then click.
     * @param {string} jobId - The job ID to click.
     * @returns {Promise<void>}
     */
    clickJobCard: function(jobId) {
        return this.getRenderedCard(jobId).then(function(result) {
            if (!result.card && result.shell) {
                console.log('[LiSeSca] Clicking shell <li> as fallback for ' + jobId);
                result.shell.click();
                return;
            }

            if (!result.card) {
                console.warn('[LiSeSca] No card rendered for job ' + jobId);
                return;
            }

            var titleLink = result.card.querySelector(JobSelectors.CARD_TITLE_LINK);
            if (titleLink) {
                titleLink.click();
            } else {
                result.card.click();
            }

            console.log('[LiSeSca] Clicked job card: ' + jobId);
        });
    },

    /**
     * Wait for the detail panel to load content for a specific job.
     * Polls until the detail panel title matches the expected job, or times out.
     * @param {string} jobId - The job ID we expect to see in the detail panel.
     * @returns {Promise<boolean>} True if detail loaded, false if timed out.
     */
    waitForDetailPanel: function(jobId) {
        return new Promise(function(resolve) {
            var maxWaitMs = 8000;
            var pollIntervalMs = 400;
            var elapsed = 0;

            var poll = setInterval(function() {
                // Check if the detail container has content referencing this job.
                // The detail container's parent element has a data-job-details-events-trigger
                // attribute, and the URL in the detail title link contains the job ID.
                var detailTitle = document.querySelector(JobSelectors.DETAIL_TITLE);
                if (detailTitle) {
                    // Check if there's a link inside the title that contains our job ID
                    var titleLink = detailTitle.querySelector('a');
                    if (titleLink) {
                        var href = titleLink.getAttribute('href') || '';
                        if (href.indexOf(jobId) !== -1) {
                            clearInterval(poll);
                            console.log('[LiSeSca] Detail panel loaded for job: ' + jobId);
                            resolve(true);
                            return;
                        }
                    }
                    // If we can see any title and enough time has passed, accept it
                    // (some job cards may not have matching links)
                    if (elapsed >= 2000) {
                        clearInterval(poll);
                        console.log('[LiSeSca] Detail panel has content (accepting after delay).');
                        resolve(true);
                        return;
                    }
                }

                elapsed += pollIntervalMs;
                if (elapsed >= maxWaitMs) {
                    clearInterval(poll);
                    console.warn('[LiSeSca] Detail panel did not load for job ' + jobId + ' after ' + maxWaitMs + 'ms.');
                    resolve(false);
                }
            }, pollIntervalMs);
        });
    },

    /**
     * Click "Show more" or "show more" buttons in the detail panel
     * to expand collapsed content sections.
     * @returns {Promise<void>}
     */
    clickShowMore: function() {
        var buttons = document.querySelectorAll(JobSelectors.DETAIL_SHOW_MORE);
        var clicked = false;
        buttons.forEach(function(btn) {
            var text = (btn.textContent || '').trim().toLowerCase();
            if (text.indexOf('show more') !== -1 || text.indexOf('see more') !== -1) {
                btn.click();
                clicked = true;
            }
        });
        if (clicked) {
            // Wait briefly for content to expand
            return new Promise(function(resolve) {
                setTimeout(resolve, 600);
            });
        }
        return Promise.resolve();
    },

    /**
     * Extract the job title from the detail panel.
     * @returns {string} The job title text.
     */
    extractDetailTitle: function() {
        var el = document.querySelector(JobSelectors.DETAIL_TITLE);
        if (!el) {
            return '';
        }
        // Get the text from the link inside h1, or fall back to h1 text
        var link = el.querySelector('a');
        if (link) {
            return (link.textContent || '').trim();
        }
        return (el.textContent || '').trim();
    },

    /**
     * Extract the company name from the detail panel.
     * @returns {string} The company name.
     */
    extractDetailCompany: function() {
        var el = document.querySelector(JobSelectors.DETAIL_COMPANY_NAME);
        return el ? (el.textContent || '').trim() : '';
    },

    /**
     * Extract location, posted date, and applicant count from the tertiary description.
     * The tertiary description container has spans with tvm__text class containing
     * location, posted date, and applicant info separated by " · ".
     * @returns {Object} { location, postedDate, applicants }
     */
    extractDetailTertiaryInfo: function() {
        var result = { location: '', postedDate: '', applicants: '' };
        var container = document.querySelector(JobSelectors.DETAIL_TERTIARY_DESC);
        if (!container) {
            return result;
        }

        // Get all the tvm__text spans
        var spans = container.querySelectorAll('.tvm__text');
        var textParts = [];
        spans.forEach(function(span) {
            var text = (span.textContent || '').trim();
            // Skip separator dots and whitespace-only spans
            if (text && text !== '·' && text.length > 1) {
                textParts.push(text);
            }
        });

        // Parse the parts — LinkedIn typically arranges as:
        // Location · Posted date · Applicant count
        // (and sometimes additional lines like "Promoted by hirer")
        textParts.forEach(function(part) {
            if (part.match(/\d+\s*(people|applicant)/i) || part.match(/clicked apply/i)) {
                result.applicants = part;
            } else if (part.match(/ago|Reposted|week|day|hour|month/i)) {
                result.postedDate = part;
            } else if (part.match(/,/) && !part.match(/Promoted|managed|Responses/i)) {
                // Location usually has a comma (e.g. "City, Country")
                if (!result.location) {
                    result.location = part;
                }
            }
        });

        return result;
    },

    /**
     * Extract workplace type and employment type from the fit preferences buttons.
     * These are buttons like "✓ Hybrid" and "✓ Full-time".
     * @returns {Object} { workplaceType, employmentType }
     */
    extractDetailJobTypes: function() {
        var result = { workplaceType: '', employmentType: '' };
        var buttons = document.querySelectorAll(JobSelectors.DETAIL_FIT_PREFS);

        buttons.forEach(function(btn) {
            var text = (btn.textContent || '').trim();
            // Extract just the type keywords
            if (text.match(/Hybrid|Remote|On-site|Onsite/i)) {
                var match = text.match(/(Hybrid|Remote|On-site|Onsite)/i);
                if (match) {
                    result.workplaceType = match[1];
                }
            }
            if (text.match(/Full-time|Part-time|Contract|Temporary|Internship|Volunteer/i)) {
                var match2 = text.match(/(Full-time|Part-time|Contract|Temporary|Internship|Volunteer)/i);
                if (match2) {
                    result.employmentType = match2[1];
                }
            }
        });

        return result;
    },

    /**
     * Extract the apply link or determine if it's Easy Apply.
     * @returns {string} The apply URL or "Easy Apply" indication.
     */
    extractDetailApplyLink: function() {
        var applyBtn = document.querySelector(JobSelectors.DETAIL_APPLY_BUTTON);
        if (!applyBtn) {
            return '';
        }

        // Check if it's an external apply (has link-external icon)
        var externalIcon = applyBtn.querySelector('[data-test-icon="link-external-small"]');
        if (externalIcon) {
            // External apply — the actual URL is not directly visible,
            // so we note it as "External Apply"
            return 'External Apply';
        }

        // Check the button text for "Easy Apply"
        var btnText = (applyBtn.textContent || '').trim();
        if (btnText.match(/Easy Apply/i)) {
            return 'Easy Apply';
        }

        return 'Apply';
    },

    /**
     * Extract network connection information.
     * @returns {string} e.g. "3 connections work here" or empty.
     */
    extractDetailNetworkInfo: function() {
        var el = document.querySelector(JobSelectors.DETAIL_CONNECTIONS);
        return el ? (el.textContent || '').trim() : '';
    },

    /**
     * Extract the full job description and convert HTML to Markdown.
     * @returns {string} The job description in Markdown format.
     */
    extractDetailJobDescription: function() {
        var el = document.querySelector(JobSelectors.DETAIL_JOB_DESCRIPTION);
        if (!el) {
            return '';
        }

        // Get the content div inside #job-details (skip the "About the job" heading)
        var contentDiv = el.querySelector('.mt4');
        return htmlToMarkdown(contentDiv || el);
    },

    /**
     * Extract premium applicant insights section as Markdown.
     * @returns {string} Premium insights in Markdown, or empty.
     */
    extractDetailPremiumInsights: function() {
        var el = document.querySelector(JobSelectors.DETAIL_PREMIUM_INSIGHTS);
        if (!el) {
            return '';
        }

        return htmlToMarkdown(el);
    },

    /**
     * Extract the "About the company" section as Markdown.
     * @returns {Object} { description, industry, employeeCount }
     */
    extractDetailAboutCompany: function() {
        var result = { description: '', industry: '', employeeCount: '' };

        var companySection = document.querySelector(JobSelectors.DETAIL_ABOUT_COMPANY);
        if (!companySection) {
            return result;
        }

        // Industry and employee count from inline information spans
        var infoSpans = companySection.querySelectorAll(JobSelectors.DETAIL_COMPANY_INFO);
        infoSpans.forEach(function(span) {
            var text = (span.textContent || '').trim();
            if (text.match(/employees/i)) {
                result.employeeCount = text;
            }
        });

        // The industry is the first text node in the t-14 mt5 div,
        // before the inline-information spans
        var infoDiv = companySection.querySelector('.t-14.mt5');
        if (infoDiv) {
            // Get the first text content before any child elements
            var firstText = '';
            for (var i = 0; i < infoDiv.childNodes.length; i++) {
                var node = infoDiv.childNodes[i];
                if (node.nodeType === Node.TEXT_NODE) {
                    var trimmed = node.textContent.trim();
                    if (trimmed) {
                        firstText = trimmed;
                        break;
                    }
                }
            }
            result.industry = firstText;
        }

        // Company description
        var descEl = companySection.querySelector(JobSelectors.DETAIL_COMPANY_DESC);
        if (descEl) {
            result.description = htmlToMarkdown(descEl);
        }

        return result;
    },

    /**
     * Extract all data for a single job: click card → wait → expand → extract.
     * This is the main orchestration method for per-job extraction.
     * @param {string} jobId - The job ID to extract.
     * @returns {Promise<Object|null>} Complete job data object, or null on failure.
     */
    extractFullJob: function(jobId) {
        var self = this;

        return self.clickJobCard(jobId).then(function() {
            return self.waitForDetailPanel(jobId);
        }).then(function(loaded) {
            if (!loaded) {
                console.warn('[LiSeSca] Skipping job ' + jobId + ' — detail panel did not load.');
                return null;
            }

            // Click "Show more" buttons to expand collapsed sections
            return self.clickShowMore();
        }).then(function(result) {
            // If previous step returned null (from skipped job), propagate
            if (result === null) {
                return null;
            }

            // Scroll the detail panel to the bottom to trigger lazy-loading
            // of sections like "Premium Insights" and "About the Company"
            // that only render when scrolled into view.
            var detailPanel = document.querySelector('.jobs-search__job-details--container')
                || document.querySelector('.scaffold-layout__detail');
            if (detailPanel) {
                var maxScroll = detailPanel.scrollHeight - detailPanel.clientHeight;
                if (maxScroll > 0) {
                    detailPanel.scrollTo({ top: maxScroll, behavior: 'smooth' });
                }
            }

            // Brief wait for lazy-loaded bottom sections to render,
            // then click any additional "Show more" buttons that appeared
            return Emulator.randomDelay(600, 1000).then(function() {
                return self.clickShowMore();
            }).then(function() {
                return 'ok';  // Signal that we should proceed with extraction
            });
        }).then(function(signal) {
            if (signal === null) {
                return null;
            }

            // Extract card basics first (some data is only in the card)
            var card = document.querySelector('div[data-job-id="' + jobId + '"]');
            var cardData = card ? self.extractCardBasics(card) : { jobId: jobId };

            // Extract detail panel data
            var detailTitle = self.extractDetailTitle();
            var detailCompany = self.extractDetailCompany();
            var tertiaryInfo = self.extractDetailTertiaryInfo();
            var jobTypes = self.extractDetailJobTypes();
            var applyLink = self.extractDetailApplyLink();
            var networkInfo = self.extractDetailNetworkInfo();
            var jobDescription = self.extractDetailJobDescription();
            var premiumInsights = self.extractDetailPremiumInsights();
            var aboutCompany = self.extractDetailAboutCompany();

            // Merge card data with detail data (detail takes precedence)
            var job = {
                jobId: jobId,
                jobTitle: detailTitle || cardData.jobTitle || '',
                company: detailCompany || cardData.company || '',
                location: tertiaryInfo.location || cardData.location || '',
                postedDate: tertiaryInfo.postedDate || '',
                applicants: tertiaryInfo.applicants || '',
                workplaceType: jobTypes.workplaceType || '',
                employmentType: jobTypes.employmentType || '',
                applyLink: applyLink || '',
                jobLink: cardData.directLink || ('https://www.linkedin.com/jobs/view/' + jobId + '/'),
                networkConnections: networkInfo || cardData.cardInsight || '',
                industry: aboutCompany.industry || '',
                employeeCount: aboutCompany.employeeCount || '',
                viewed: cardData.viewed === true,
                jobState: cardData.jobState || '',
                jobDescription: jobDescription || '',
                premiumInsights: premiumInsights || '',
                aboutCompany: aboutCompany.description || ''
            };

            console.log('[LiSeSca] Extracted job: ' + job.jobTitle + ' at ' + job.company);
            return job;
        });
    }
};
