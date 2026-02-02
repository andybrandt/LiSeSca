// ===== AI CLIENT =====
// Handles communication with Anthropic's Claude API for job filtering.
// Uses GM_xmlhttpRequest for cross-origin API calls (Tampermonkey requirement).
// Maintains conversation history per page to reduce token usage.

import { CONFIG } from './config.js';

/** System prompt that instructs Claude how to evaluate jobs (basic mode) */
const SYSTEM_PROMPT = `You are a job relevance filter. Your task is to quickly decide whether a job posting is worth downloading for detailed review, based on the user's job search criteria.

DECISION RULES:
- Return download: true if the job COULD be relevant based on the limited card information shown
- Return download: false ONLY if the job is CLEARLY irrelevant (e.g., completely wrong industry, wrong role type, obviously unrelated field)
- When uncertain, return true — it's better to review an extra job than miss a good one

You will receive the user's criteria first, then job cards one at a time. Each card has only basic info: title, company, location. Make quick decisions based on this limited information.`;

/** System prompt for Full AI mode with three-tier evaluation */
const FULL_AI_SYSTEM_PROMPT = `You are a job relevance filter with two-stage evaluation.

STAGE 1 - CARD TRIAGE (limited info: title, company, location):
Use the card_triage tool to make one of three decisions:
- "reject" - Job is CLEARLY irrelevant (wrong industry, completely wrong role type, obviously unrelated field)
- "keep" - Job CLEARLY matches criteria (strong title match, relevant company, good fit)
- "maybe" - Uncertain from card info alone, need to see full job description to decide

Be CONSERVATIVE with "reject" - only use when truly certain the job is irrelevant. When in doubt, use "maybe" to request full details.

STAGE 2 - FULL EVALUATION (complete job description):
When you receive full job details after a "maybe" decision, use the full_evaluation tool to make a final accept/reject based on comprehensive analysis of requirements, responsibilities, qualifications, and company info.

You will receive the user's criteria first, then job cards one at a time.`;

/** Tool definition that forces structured boolean response (basic mode) */
const JOB_EVALUATION_TOOL = {
    name: 'job_evaluation',
    description: 'Indicate whether this job should be downloaded for detailed review',
    input_schema: {
        type: 'object',
        properties: {
            download: {
                type: 'boolean',
                description: 'true if job matches criteria, false if clearly irrelevant'
            }
        },
        required: ['download']
    }
};

/** Tool for three-tier card triage (Full AI mode) */
const CARD_TRIAGE_TOOL = {
    name: 'card_triage',
    description: 'Triage a job card based on limited information (title, company, location)',
    input_schema: {
        type: 'object',
        properties: {
            decision: {
                type: 'string',
                enum: ['reject', 'keep', 'maybe'],
                description: 'reject=clearly irrelevant, keep=clearly relevant, maybe=need full details to decide'
            }
        },
        required: ['decision']
    }
};

/** Tool for final decision after full job review (Full AI mode) */
const FULL_EVALUATION_TOOL = {
    name: 'full_evaluation',
    description: 'Final decision after reviewing full job details',
    input_schema: {
        type: 'object',
        properties: {
            accept: {
                type: 'boolean',
                description: 'true to accept and save the job, false to reject'
            }
        },
        required: ['accept']
    }
};

export const AIClient = {
    /** Conversation history for the current page */
    conversationHistory: [],

    /** Flag indicating if the conversation has been initialized with criteria */
    isInitialized: false,

    /** Flag indicating if Full AI mode (three-tier) is active for this session */
    fullAIMode: false,

    /**
     * Check if the AI client is properly configured with API key and criteria.
     * @returns {boolean} True if both API key and criteria are set.
     */
    isConfigured: function() {
        return !!(CONFIG.ANTHROPIC_API_KEY && CONFIG.JOB_CRITERIA);
    },

    /**
     * Reset the conversation history. Called at the start of each page.
     */
    resetConversation: function() {
        this.conversationHistory = [];
        this.isInitialized = false;
        // Note: fullAIMode is set during initConversation, not reset here
        console.log('[LiSeSca] AI conversation reset for new page.');
    },

    /**
     * Initialize the conversation with user criteria.
     * Creates the initial message exchange that sets up the context.
     * @param {boolean} fullAIMode - If true, use three-tier evaluation mode.
     * @returns {Promise<void>}
     */
    initConversation: function(fullAIMode) {
        if (this.isInitialized) {
            return Promise.resolve();
        }

        this.fullAIMode = fullAIMode === true;

        if (this.fullAIMode) {
            // Full AI mode: three-tier evaluation (reject/keep/maybe)
            this.conversationHistory = [
                {
                    role: 'user',
                    content: 'My job search criteria:\n\n' + CONFIG.JOB_CRITERIA + '\n\nI will send you job cards one at a time. Use the card_triage tool to decide: reject (clearly irrelevant), keep (clearly relevant), or maybe (need full details).'
                },
                {
                    role: 'assistant',
                    content: [
                        {
                            type: 'tool_use',
                            id: 'init_ack',
                            name: 'card_triage',
                            input: { decision: 'maybe' }
                        }
                    ]
                },
                {
                    role: 'user',
                    content: [
                        {
                            type: 'tool_result',
                            tool_use_id: 'init_ack',
                            content: 'Ready to evaluate jobs using three-tier triage.'
                        }
                    ]
                }
            ];
            console.log('[LiSeSca] AI conversation initialized (fullAI=true).');
        } else {
            // Basic mode: binary evaluation (download/skip)
            this.conversationHistory = [
                {
                    role: 'user',
                    content: 'My job search criteria:\n\n' + CONFIG.JOB_CRITERIA + '\n\nI will send you job cards one at a time. Evaluate each one using the job_evaluation tool.'
                },
                {
                    role: 'assistant',
                    content: [
                        {
                            type: 'tool_use',
                            id: 'init_ack',
                            name: 'job_evaluation',
                            input: { download: true }
                        }
                    ]
                },
                {
                    role: 'user',
                    content: [
                        {
                            type: 'tool_result',
                            tool_use_id: 'init_ack',
                            content: 'Ready to evaluate jobs.'
                        }
                    ]
                }
            ];
            console.log('[LiSeSca] AI conversation initialized (fullAI=false).');
        }

        this.isInitialized = true;
        return Promise.resolve();
    },

    /**
     * Evaluate a job card to determine if it should be downloaded.
     * @param {string} cardMarkdown - The job card formatted as Markdown.
     * @returns {Promise<boolean>} True if the job should be downloaded, false to skip.
     */
    evaluateJob: function(cardMarkdown) {
        var self = this;

        if (!this.isConfigured()) {
            console.warn('[LiSeSca] AI client not configured, allowing job.');
            return Promise.resolve(true);
        }

        return this.initConversation().then(function() {
            return self.sendJobForEvaluation(cardMarkdown);
        }).catch(function(error) {
            console.error('[LiSeSca] AI evaluation error, allowing job:', error);
            return true; // Fail-open: download the job on error
        });
    },

    /**
     * Send a job card to Claude for evaluation.
     * @param {string} cardMarkdown - The job card formatted as Markdown.
     * @returns {Promise<boolean>} True if the job should be downloaded.
     */
    sendJobForEvaluation: function(cardMarkdown) {
        var self = this;

        // Add the job card to the conversation
        var messagesWithJob = this.conversationHistory.concat([
            { role: 'user', content: cardMarkdown }
        ]);

        var requestBody = {
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 100,
            system: SYSTEM_PROMPT,
            tools: [JOB_EVALUATION_TOOL],
            tool_choice: { type: 'tool', name: 'job_evaluation' },
            messages: messagesWithJob
        };

        return new Promise(function(resolve, reject) {
            GM_xmlhttpRequest({
                method: 'POST',
                url: 'https://api.anthropic.com/v1/messages',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': CONFIG.ANTHROPIC_API_KEY,
                    'anthropic-version': '2023-06-01'
                },
                data: JSON.stringify(requestBody),
                onload: function(response) {
                    self.handleApiResponse(response, cardMarkdown, resolve, reject);
                },
                onerror: function(error) {
                    console.error('[LiSeSca] AI API request failed:', error);
                    reject(new Error('Network error'));
                },
                ontimeout: function() {
                    console.error('[LiSeSca] AI API request timed out');
                    reject(new Error('Request timeout'));
                },
                timeout: 30000 // 30 second timeout
            });
        });
    },

    /**
     * Handle the API response and extract the evaluation result.
     * @param {Object} response - The GM_xmlhttpRequest response object.
     * @param {string} cardMarkdown - The original job card (for logging).
     * @param {Function} resolve - Promise resolve function.
     * @param {Function} reject - Promise reject function.
     */
    handleApiResponse: function(response, cardMarkdown, resolve, reject) {
        if (response.status !== 200) {
            console.error('[LiSeSca] AI API error:', response.status, response.responseText);
            // Fail-open: allow the job on API errors
            resolve(true);
            return;
        }

        try {
            var data = JSON.parse(response.responseText);

            // Find the tool_use content block
            var toolUse = null;
            if (data.content && Array.isArray(data.content)) {
                for (var i = 0; i < data.content.length; i++) {
                    if (data.content[i].type === 'tool_use') {
                        toolUse = data.content[i];
                        break;
                    }
                }
            }

            if (!toolUse || toolUse.name !== 'job_evaluation') {
                console.warn('[LiSeSca] Unexpected AI response format, allowing job.');
                resolve(true);
                return;
            }

            var shouldDownload = toolUse.input.download === true;

            // Update conversation history with this exchange
            this.conversationHistory.push({ role: 'user', content: cardMarkdown });
            this.conversationHistory.push({
                role: 'assistant',
                content: [toolUse]
            });
            // Add tool result to complete the exchange
            this.conversationHistory.push({
                role: 'user',
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: toolUse.id,
                        content: shouldDownload ? 'Job queued for download.' : 'Job skipped.'
                    }
                ]
            });

            console.log('[LiSeSca] AI evaluation: ' + (shouldDownload ? 'DOWNLOAD' : 'SKIP'));
            resolve(shouldDownload);

        } catch (error) {
            console.error('[LiSeSca] Failed to parse AI response:', error);
            resolve(true); // Fail-open
        }
    },

    // ===== FULL AI MODE (Three-tier evaluation) =====

    /**
     * Triage a job card using three-tier evaluation (reject/keep/maybe).
     * Only used in Full AI mode.
     * @param {string} cardMarkdown - The job card formatted as Markdown.
     * @returns {Promise<string>} One of: 'reject', 'keep', or 'maybe'.
     */
    triageCard: function(cardMarkdown) {
        var self = this;

        if (!this.isConfigured()) {
            console.warn('[LiSeSca] AI client not configured, returning "keep".');
            return Promise.resolve('keep');
        }

        return this.initConversation(true).then(function() {
            return self.sendCardForTriage(cardMarkdown);
        }).catch(function(error) {
            console.error('[LiSeSca] AI triage error, returning "keep":', error);
            return 'keep'; // Fail-open: keep the job on error
        });
    },

    /**
     * Send a job card to Claude for three-tier triage.
     * @param {string} cardMarkdown - The job card formatted as Markdown.
     * @returns {Promise<string>} One of: 'reject', 'keep', or 'maybe'.
     */
    sendCardForTriage: function(cardMarkdown) {
        var self = this;

        var messagesWithJob = this.conversationHistory.concat([
            { role: 'user', content: cardMarkdown }
        ]);

        var requestBody = {
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 100,
            system: FULL_AI_SYSTEM_PROMPT,
            tools: [CARD_TRIAGE_TOOL, FULL_EVALUATION_TOOL],
            tool_choice: { type: 'tool', name: 'card_triage' },
            messages: messagesWithJob
        };

        return new Promise(function(resolve, reject) {
            GM_xmlhttpRequest({
                method: 'POST',
                url: 'https://api.anthropic.com/v1/messages',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': CONFIG.ANTHROPIC_API_KEY,
                    'anthropic-version': '2023-06-01'
                },
                data: JSON.stringify(requestBody),
                onload: function(response) {
                    self.handleTriageResponse(response, cardMarkdown, resolve, reject);
                },
                onerror: function(error) {
                    console.error('[LiSeSca] AI triage request failed:', error);
                    reject(new Error('Network error'));
                },
                ontimeout: function() {
                    console.error('[LiSeSca] AI triage request timed out');
                    reject(new Error('Request timeout'));
                },
                timeout: 30000
            });
        });
    },

    /**
     * Handle the triage API response and extract the decision.
     * @param {Object} response - The GM_xmlhttpRequest response object.
     * @param {string} cardMarkdown - The original job card.
     * @param {Function} resolve - Promise resolve function.
     * @param {Function} reject - Promise reject function.
     */
    handleTriageResponse: function(response, cardMarkdown, resolve, reject) {
        if (response.status !== 200) {
            console.error('[LiSeSca] AI triage API error:', response.status, response.responseText);
            resolve('keep'); // Fail-open
            return;
        }

        try {
            var data = JSON.parse(response.responseText);

            var toolUse = null;
            if (data.content && Array.isArray(data.content)) {
                for (var i = 0; i < data.content.length; i++) {
                    if (data.content[i].type === 'tool_use') {
                        toolUse = data.content[i];
                        break;
                    }
                }
            }

            if (!toolUse || toolUse.name !== 'card_triage') {
                console.warn('[LiSeSca] Unexpected triage response format, returning "keep".');
                resolve('keep');
                return;
            }

            var decision = toolUse.input.decision;
            if (decision !== 'reject' && decision !== 'keep' && decision !== 'maybe') {
                console.warn('[LiSeSca] Invalid triage decision "' + decision + '", returning "keep".');
                decision = 'keep';
            }

            // Update conversation history
            this.conversationHistory.push({ role: 'user', content: cardMarkdown });
            this.conversationHistory.push({
                role: 'assistant',
                content: [toolUse]
            });

            var resultMessage = '';
            if (decision === 'reject') {
                resultMessage = 'Job rejected and skipped.';
            } else if (decision === 'keep') {
                resultMessage = 'Job accepted. Fetching full details for output.';
            } else {
                resultMessage = 'Need more information. Full job details will follow.';
            }

            this.conversationHistory.push({
                role: 'user',
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: toolUse.id,
                        content: resultMessage
                    }
                ]
            });

            console.log('[LiSeSca] AI triage: ' + decision.toUpperCase());
            resolve(decision);

        } catch (error) {
            console.error('[LiSeSca] Failed to parse triage response:', error);
            resolve('keep'); // Fail-open
        }
    },

    /**
     * Evaluate a full job description after a "maybe" triage decision.
     * @param {string} fullJobMarkdown - The complete job formatted as Markdown.
     * @returns {Promise<boolean>} True to accept the job, false to reject.
     */
    evaluateFullJob: function(fullJobMarkdown) {
        var self = this;

        if (!this.isConfigured()) {
            console.warn('[LiSeSca] AI client not configured, accepting job.');
            return Promise.resolve(true);
        }

        return this.sendFullJobForEvaluation(fullJobMarkdown).catch(function(error) {
            console.error('[LiSeSca] AI full evaluation error, accepting job:', error);
            return true; // Fail-open
        });
    },

    /**
     * Send full job details to Claude for final evaluation.
     * @param {string} fullJobMarkdown - The complete job formatted as Markdown.
     * @returns {Promise<boolean>} True to accept, false to reject.
     */
    sendFullJobForEvaluation: function(fullJobMarkdown) {
        var self = this;

        var contextMessage = 'Here are the full job details for your final decision:\n\n' + fullJobMarkdown;

        var messagesWithJob = this.conversationHistory.concat([
            { role: 'user', content: contextMessage }
        ]);

        var requestBody = {
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 100,
            system: FULL_AI_SYSTEM_PROMPT,
            tools: [CARD_TRIAGE_TOOL, FULL_EVALUATION_TOOL],
            tool_choice: { type: 'tool', name: 'full_evaluation' },
            messages: messagesWithJob
        };

        return new Promise(function(resolve, reject) {
            GM_xmlhttpRequest({
                method: 'POST',
                url: 'https://api.anthropic.com/v1/messages',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': CONFIG.ANTHROPIC_API_KEY,
                    'anthropic-version': '2023-06-01'
                },
                data: JSON.stringify(requestBody),
                onload: function(response) {
                    self.handleFullEvaluationResponse(response, contextMessage, resolve, reject);
                },
                onerror: function(error) {
                    console.error('[LiSeSca] AI full evaluation request failed:', error);
                    reject(new Error('Network error'));
                },
                ontimeout: function() {
                    console.error('[LiSeSca] AI full evaluation request timed out');
                    reject(new Error('Request timeout'));
                },
                timeout: 60000 // 60 second timeout for full job evaluation
            });
        });
    },

    /**
     * Handle the full evaluation API response.
     * @param {Object} response - The GM_xmlhttpRequest response object.
     * @param {string} contextMessage - The message sent with full job details.
     * @param {Function} resolve - Promise resolve function.
     * @param {Function} reject - Promise reject function.
     */
    handleFullEvaluationResponse: function(response, contextMessage, resolve, reject) {
        if (response.status !== 200) {
            console.error('[LiSeSca] AI full evaluation API error:', response.status, response.responseText);
            resolve(true); // Fail-open
            return;
        }

        try {
            var data = JSON.parse(response.responseText);

            var toolUse = null;
            if (data.content && Array.isArray(data.content)) {
                for (var i = 0; i < data.content.length; i++) {
                    if (data.content[i].type === 'tool_use') {
                        toolUse = data.content[i];
                        break;
                    }
                }
            }

            if (!toolUse || toolUse.name !== 'full_evaluation') {
                console.warn('[LiSeSca] Unexpected full evaluation response, accepting job.');
                resolve(true);
                return;
            }

            var accept = toolUse.input.accept === true;

            // Update conversation history
            this.conversationHistory.push({ role: 'user', content: contextMessage });
            this.conversationHistory.push({
                role: 'assistant',
                content: [toolUse]
            });
            this.conversationHistory.push({
                role: 'user',
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: toolUse.id,
                        content: accept ? 'Job accepted and saved.' : 'Job rejected after full review.'
                    }
                ]
            });

            console.log('[LiSeSca] AI full evaluation: ' + (accept ? 'ACCEPT' : 'REJECT'));
            resolve(accept);

        } catch (error) {
            console.error('[LiSeSca] Failed to parse full evaluation response:', error);
            resolve(true); // Fail-open
        }
    }
};
