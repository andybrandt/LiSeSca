// ===== AI CLIENT =====
// Handles communication with Anthropic's Claude API for job filtering.
// Uses GM_xmlhttpRequest for cross-origin API calls (Tampermonkey requirement).
// Maintains conversation history per page to reduce token usage.

import { CONFIG } from './config.js';

/** System prompt that instructs Claude how to evaluate jobs */
const SYSTEM_PROMPT = `You are a job relevance filter. Your task is to quickly decide whether a job posting is worth downloading for detailed review, based on the user's job search criteria.

DECISION RULES:
- Return download: true if the job COULD be relevant based on the limited card information shown
- Return download: false ONLY if the job is CLEARLY irrelevant (e.g., completely wrong industry, wrong role type, obviously unrelated field)
- When uncertain, return true — it's better to review an extra job than miss a good one

You will receive the user's criteria first, then job cards one at a time. Each card has only basic info: title, company, location. Make quick decisions based on this limited information.`;

/** Tool definition that forces structured boolean response */
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

export const AIClient = {
    /** Conversation history for the current page */
    conversationHistory: [],

    /** Flag indicating if the conversation has been initialized with criteria */
    isInitialized: false,

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
        console.log('[LiSeSca] AI conversation reset for new page.');
    },

    /**
     * Initialize the conversation with user criteria.
     * Creates the initial message exchange that sets up the context.
     * @returns {Promise<void>}
     */
    initConversation: function() {
        if (this.isInitialized) {
            return Promise.resolve();
        }

        // Set up the initial conversation with criteria
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

        this.isInitialized = true;
        console.log('[LiSeSca] AI conversation initialized with criteria.');
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
    }
};
