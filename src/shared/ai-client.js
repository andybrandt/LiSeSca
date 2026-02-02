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

ALWAYS provide a brief reason explaining your decision. For rejections, explain WHY the job doesn't match (e.g., "Senior management role, user seeks IC positions", "Healthcare industry, user wants tech").

STAGE 2 - FULL EVALUATION (complete job description):
When you receive full job details after a "maybe" decision, use the full_evaluation tool to make a final accept/reject based on comprehensive analysis of requirements, responsibilities, qualifications, and company info.

ALWAYS provide a reason for your decision, especially for rejections. Be specific about what criteria the job fails to meet.

You will receive the user's criteria first, then job cards one at a time.`;

/** System prompt for people card triage (reject/keep/maybe) */
const PEOPLE_TRIAGE_SYSTEM_PROMPT = `You are a LinkedIn profile filter. Evaluate each profile card against the criteria below.

You only see LIMITED info: name, headline, location, connection degree. Use the people_card_triage tool:
- "reject" — CLEARLY irrelevant per criteria (wrong role type, excluded category)
- "keep" — CLEARLY matches criteria
- "maybe" — Uncertain from card alone, need full profile

Be conservative with "reject" — only use when clearly irrelevant. When uncertain, use "maybe".
Always provide a brief reason.

USER'S CRITERIA:
`;

/** System prompt for full profile evaluation (accept/reject) */
const PEOPLE_PROFILE_SYSTEM_PROMPT = `You are a LinkedIn profile filter. Evaluate the full profile against the criteria below.

You have FULL profile data: current role, past roles, company, experience. Use the people_full_evaluation tool:
- "accept" — Person matches criteria (has value for user's goals)
- "reject" — Person doesn't fit OR hits exclusion criteria

When borderline, lean toward "accept". Always provide a specific reason.

USER'S CRITERIA:
`;

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
            },
            reason: {
                type: 'string',
                description: 'Brief explanation for the decision (required for reject, optional for keep/maybe)'
            }
        },
        required: ['decision', 'reason']
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
            },
            reason: {
                type: 'string',
                description: 'Brief explanation for the decision (especially important for rejections)'
            }
        },
        required: ['accept', 'reason']
    }
};

/** Tool for people triage (reject/keep/maybe) */
const PEOPLE_CARD_TRIAGE_TOOL = {
    name: 'people_card_triage',
    description: 'Triage a person card based on limited information (name, headline, location)',
    input_schema: {
        type: 'object',
        properties: {
            decision: {
                type: 'string',
                enum: ['reject', 'keep', 'maybe'],
                description: 'reject=clearly irrelevant, keep=clearly relevant, maybe=need full profile'
            },
            reason: {
                type: 'string',
                description: 'Brief explanation for the decision'
            }
        },
        required: ['decision', 'reason']
    }
};

/** Tool for final decision after full profile review */
const PEOPLE_FULL_EVALUATION_TOOL = {
    name: 'people_full_evaluation',
    description: 'Final decision after reviewing full profile details',
    input_schema: {
        type: 'object',
        properties: {
            accept: {
                type: 'boolean',
                description: 'true to accept and save the person, false to reject'
            },
            reason: {
                type: 'string',
                description: 'Brief explanation for the decision'
            }
        },
        required: ['accept', 'reason']
    }
};

export const AIClient = {
    /** Conversation history for the current page */
    conversationHistory: [],

    /** Flag indicating if the conversation has been initialized with criteria */
    isInitialized: false,

    /** Flag indicating if Full AI mode (three-tier) is active for this session */
    fullAIMode: false,

    /** Conversation history for people evaluation */
    peopleConversationHistory: [],

    /** Flag indicating if the people conversation has been initialized */
    peopleInitialized: false,

    /** Flag indicating if full AI mode is active for people evaluation */
    peopleFullAIMode: false,

    /**
     * Check if the AI client is properly configured with API key and criteria.
     * @returns {boolean} True if both API key and criteria are set.
     */
    isConfigured: function() {
        return !!(CONFIG.ANTHROPIC_API_KEY && CONFIG.JOB_CRITERIA);
    },

    /**
     * Check if People AI client is properly configured.
     * @returns {boolean} True if both API key and people criteria are set.
     */
    isPeopleConfigured: function() {
        return !!(CONFIG.ANTHROPIC_API_KEY && CONFIG.PEOPLE_CRITERIA);
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
     * Reset the people conversation history. Called at the start of each page.
     */
    resetPeopleConversation: function() {
        this.peopleConversationHistory = [];
        this.peopleInitialized = false;
        console.log('[LiSeSca] People AI conversation reset for new page.');
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
     * Initialize the people AI conversation.
     * @param {boolean} fullAIMode - If true, enables full AI mode (two-stage).
     * @returns {Promise<void>}
     */
    initPeopleConversation: function(fullAIMode) {
        if (this.peopleInitialized) {
            return Promise.resolve();
        }

        this.peopleFullAIMode = fullAIMode === true;
        // Conversation history starts empty; criteria is in system prompt
        this.peopleConversationHistory = [];

        this.peopleInitialized = true;
        console.log('[LiSeSca] People AI conversation initialized.');
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
     * @returns {Promise<{decision: string, reason: string}>} Decision object with reason.
     */
    triageCard: function(cardMarkdown) {
        var self = this;

        if (!this.isConfigured()) {
            console.warn('[LiSeSca] AI client not configured, returning "keep".');
            return Promise.resolve({ decision: 'keep', reason: 'AI not configured' });
        }

        return this.initConversation(true).then(function() {
            return self.sendCardForTriage(cardMarkdown);
        }).catch(function(error) {
            console.error('[LiSeSca] AI triage error, returning "keep":', error);
            return { decision: 'keep', reason: 'Error: ' + error.message }; // Fail-open
        });
    },

    /**
     * Send a job card to Claude for three-tier triage.
     * @param {string} cardMarkdown - The job card formatted as Markdown.
     * @returns {Promise<{decision: string, reason: string}>} Decision object with reason.
     */
    sendCardForTriage: function(cardMarkdown) {
        var self = this;

        var messagesWithJob = this.conversationHistory.concat([
            { role: 'user', content: cardMarkdown }
        ]);

        var requestBody = {
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 200,  // Increased for reason text
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
            resolve({ decision: 'keep', reason: 'API error ' + response.status }); // Fail-open
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
                resolve({ decision: 'keep', reason: 'Unexpected response format' });
                return;
            }

            var decision = toolUse.input.decision;
            var reason = toolUse.input.reason || '(no reason provided)';

            if (decision !== 'reject' && decision !== 'keep' && decision !== 'maybe') {
                console.warn('[LiSeSca] Invalid triage decision "' + decision + '", returning "keep".');
                decision = 'keep';
                reason = 'Invalid decision value: ' + decision;
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

            resolve({ decision: decision, reason: reason });

        } catch (error) {
            console.error('[LiSeSca] Failed to parse triage response:', error);
            resolve({ decision: 'keep', reason: 'Parse error: ' + error.message }); // Fail-open
        }
    },

    /**
     * Evaluate a full job description after a "maybe" triage decision.
     * @param {string} fullJobMarkdown - The complete job formatted as Markdown.
     * @returns {Promise<{accept: boolean, reason: string}>} Decision object with reason.
     */
    evaluateFullJob: function(fullJobMarkdown) {
        var self = this;

        if (!this.isConfigured()) {
            console.warn('[LiSeSca] AI client not configured, accepting job.');
            return Promise.resolve({ accept: true, reason: 'AI not configured' });
        }

        return this.sendFullJobForEvaluation(fullJobMarkdown).catch(function(error) {
            console.error('[LiSeSca] AI full evaluation error, accepting job:', error);
            return { accept: true, reason: 'Error: ' + error.message }; // Fail-open
        });
    },

    /**
     * Send full job details to Claude for final evaluation.
     * @param {string} fullJobMarkdown - The complete job formatted as Markdown.
     * @returns {Promise<{accept: boolean, reason: string}>} Decision object with reason.
     */
    sendFullJobForEvaluation: function(fullJobMarkdown) {
        var self = this;

        var contextMessage = 'Here are the full job details for your final decision:\n\n' + fullJobMarkdown;

        var messagesWithJob = this.conversationHistory.concat([
            { role: 'user', content: contextMessage }
        ]);

        var requestBody = {
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 300,  // Increased for detailed reason text
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
            resolve({ accept: true, reason: 'API error ' + response.status }); // Fail-open
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
                resolve({ accept: true, reason: 'Unexpected response format' });
                return;
            }

            var accept = toolUse.input.accept === true;
            var reason = toolUse.input.reason || '(no reason provided)';

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

            resolve({ accept: accept, reason: reason });

        } catch (error) {
            console.error('[LiSeSca] Failed to parse full evaluation response:', error);
            resolve({ accept: true, reason: 'Parse error: ' + error.message }); // Fail-open
        }
    },

    // ===== PEOPLE AI MODE =====

    /**
     * Triage a person card using three-tier evaluation (reject/keep/maybe).
     * @param {string} cardMarkdown - The person card formatted as Markdown.
     * @returns {Promise<{decision: string, reason: string}>}
     */
    triagePeopleCard: function(cardMarkdown) {
        var self = this;

        if (!this.isPeopleConfigured()) {
            console.warn('[LiSeSca] People AI not configured, returning "keep".');
            return Promise.resolve({ decision: 'keep', reason: 'AI not configured' });
        }

        return this.initPeopleConversation(true).then(function() {
            return self.sendPeopleCardForTriage(cardMarkdown);
        }).catch(function(error) {
            console.error('[LiSeSca] People AI triage error, returning "keep":', error);
            return { decision: 'keep', reason: 'Error: ' + error.message };
        });
    },

    /**
     * Send a person card to Claude for triage.
     * @param {string} cardMarkdown - The person card formatted as Markdown.
     * @returns {Promise<{decision: string, reason: string}>}
     */
    sendPeopleCardForTriage: function(cardMarkdown) {
        var self = this;

        // Criteria is in the system prompt, conversation history has prior cards
        var messagesWithCard = this.peopleConversationHistory.concat([
            { role: 'user', content: cardMarkdown }
        ]);

        var requestBody = {
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 200,
            system: PEOPLE_TRIAGE_SYSTEM_PROMPT + CONFIG.PEOPLE_CRITERIA,
            tools: [PEOPLE_CARD_TRIAGE_TOOL],
            tool_choice: { type: 'tool', name: 'people_card_triage' },
            messages: messagesWithCard
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
                    self.handlePeopleTriageResponse(response, cardMarkdown, resolve, reject);
                },
                onerror: function(error) {
                    console.error('[LiSeSca] People AI triage request failed:', error);
                    reject(new Error('Network error'));
                },
                ontimeout: function() {
                    console.error('[LiSeSca] People AI triage request timed out');
                    reject(new Error('Request timeout'));
                },
                timeout: 30000
            });
        });
    },

    /**
     * Handle the people triage API response and extract the decision.
     * @param {Object} response - The GM_xmlhttpRequest response object.
     * @param {string} cardMarkdown - The original person card.
     * @param {Function} resolve - Promise resolve function.
     * @param {Function} reject - Promise reject function.
     */
    handlePeopleTriageResponse: function(response, cardMarkdown, resolve, reject) {
        if (response.status !== 200) {
            console.error('[LiSeSca] People AI triage API error:', response.status, response.responseText);
            resolve({ decision: 'keep', reason: 'API error ' + response.status });
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

            if (!toolUse || toolUse.name !== 'people_card_triage') {
                console.warn('[LiSeSca] Unexpected people triage response format, returning "keep".');
                resolve({ decision: 'keep', reason: 'Unexpected response format' });
                return;
            }

            var decision = toolUse.input.decision;
            var reason = toolUse.input.reason || '(no reason provided)';

            if (decision !== 'reject' && decision !== 'keep' && decision !== 'maybe') {
                console.warn('[LiSeSca] Invalid people triage decision "' + decision + '", returning "keep".');
                decision = 'keep';
                reason = 'Invalid decision value: ' + decision;
            }

            // Update conversation history
            this.peopleConversationHistory.push({ role: 'user', content: cardMarkdown });
            this.peopleConversationHistory.push({
                role: 'assistant',
                content: [toolUse]
            });

            var resultMessage = '';
            if (decision === 'reject') {
                resultMessage = 'Person rejected and skipped.';
            } else if (decision === 'keep') {
                resultMessage = 'Person accepted. Fetching full profile for output.';
            } else {
                resultMessage = 'Need more information. Full profile will follow.';
            }

            this.peopleConversationHistory.push({
                role: 'user',
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: toolUse.id,
                        content: resultMessage
                    }
                ]
            });

            resolve({ decision: decision, reason: reason });
        } catch (error) {
            console.error('[LiSeSca] Failed to parse people triage response:', error);
            resolve({ decision: 'keep', reason: 'Parse error: ' + error.message });
        }
    },

    /**
     * Evaluate a full profile after a "maybe" triage decision.
     * @param {string} fullProfileMarkdown - The complete profile formatted as Markdown.
     * @returns {Promise<{accept: boolean, reason: string}>}
     */
    evaluateFullProfile: function(fullProfileMarkdown) {
        var self = this;

        if (!this.isPeopleConfigured()) {
            console.warn('[LiSeSca] People AI not configured, accepting profile.');
            return Promise.resolve({ accept: true, reason: 'AI not configured' });
        }

        // Full profile evaluation is self-contained (criteria + profile in one call)
        return this.sendFullProfileForEvaluation(fullProfileMarkdown).catch(function(error) {
            console.error('[LiSeSca] People AI full evaluation error, accepting profile:', error);
            return { accept: true, reason: 'Error: ' + error.message };
        });
    },

    /**
     * Send full profile details to Claude for final evaluation.
     * @param {string} fullProfileMarkdown - The complete profile formatted as Markdown.
     * @returns {Promise<{accept: boolean, reason: string}>}
     */
    sendFullProfileForEvaluation: function(fullProfileMarkdown) {
        var self = this;

        // Criteria is in the system prompt, just send the profile data
        var messages = [
            { role: 'user', content: fullProfileMarkdown }
        ];

        var requestBody = {
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 300,
            system: PEOPLE_PROFILE_SYSTEM_PROMPT + CONFIG.PEOPLE_CRITERIA,
            tools: [PEOPLE_FULL_EVALUATION_TOOL],
            tool_choice: { type: 'tool', name: 'people_full_evaluation' },
            messages: messages
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
                    self.handlePeopleFullEvaluationResponse(response, fullProfileMarkdown, resolve, reject);
                },
                onerror: function(error) {
                    console.error('[LiSeSca] People AI full evaluation request failed:', error);
                    reject(new Error('Network error'));
                },
                ontimeout: function() {
                    console.error('[LiSeSca] People AI full evaluation request timed out');
                    reject(new Error('Request timeout'));
                },
                timeout: 60000
            });
        });
    },

    /**
     * Handle the full profile evaluation response.
     * @param {Object} response - The GM_xmlhttpRequest response object.
     * @param {string} profileMarkdown - The profile markdown sent for evaluation.
     * @param {Function} resolve - Promise resolve function.
     * @param {Function} reject - Promise reject function.
     */
    handlePeopleFullEvaluationResponse: function(response, profileMarkdown, resolve, reject) {
        if (response.status !== 200) {
            console.error('[LiSeSca] People AI full evaluation API error:', response.status, response.responseText);
            resolve({ accept: true, reason: 'API error ' + response.status });
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

            if (!toolUse || toolUse.name !== 'people_full_evaluation') {
                console.warn('[LiSeSca] Unexpected people full evaluation response, accepting profile.');
                resolve({ accept: true, reason: 'Unexpected response format' });
                return;
            }

            var accept = toolUse.input.accept === true;
            var reason = toolUse.input.reason || '(no reason provided)';

            // Update conversation history (not really used for full profile, but keeping for consistency)
            this.peopleConversationHistory.push({ role: 'user', content: profileMarkdown });
            this.peopleConversationHistory.push({
                role: 'assistant',
                content: [toolUse]
            });
            this.peopleConversationHistory.push({
                role: 'user',
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: toolUse.id,
                        content: accept ? 'Person accepted and saved.' : 'Person rejected after full review.'
                    }
                ]
            });

            resolve({ accept: accept, reason: reason });

        } catch (error) {
            console.error('[LiSeSca] Failed to parse people full evaluation response:', error);
            resolve({ accept: true, reason: 'Parse error: ' + error.message });
        }
    }
};
