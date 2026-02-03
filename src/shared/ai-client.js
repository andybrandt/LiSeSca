// ===== AI CLIENT =====
// Handles communication with AI providers (Anthropic Claude and Moonshot Kimi) for job/people filtering.
// Uses GM_xmlhttpRequest for cross-origin API calls (Tampermonkey requirement).
// Maintains conversation history per page to reduce token usage.
// Supports multiple providers through a unified abstraction layer.

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

/** System prompt for people scoring (0-5 scale) */
const PEOPLE_SCORE_SYSTEM_PROMPT = `You are a LinkedIn profile scorer. Rate each profile on a 0-5 scale based on the criteria below.

You only see LIMITED info: name, headline, location, connection degree. Use the people_score tool with:
- 0 = Irrelevant (clearly doesn't match criteria)
- 1 = Low interest (unlikely to be useful)
- 2 = Some interest (slight potential)
- 3 = Moderate interest (could be valuable)
- 4 = Good match (likely valuable)
- 5 = Strong match (excellent fit for criteria)

When uncertain, lean toward higher scores — false positives are easy to filter, false negatives lose opportunities.
Always provide a brief reason for your score.

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
                maxLength: 100,
                description: 'Very brief reason, max 100 chars (e.g. "wrong industry" or "good title match")'
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
                maxLength: 150,
                description: 'Concise reason, max 150 chars (e.g. "requires 10+ years Java, I have 5")'
            }
        },
        required: ['accept', 'reason']
    }
};

/** Tool for people scoring (0-5 scale) */
const PEOPLE_SCORE_TOOL = {
    name: 'people_score',
    description: 'Rate a LinkedIn profile based on limited card information',
    input_schema: {
        type: 'object',
        properties: {
            score: {
                type: 'integer',
                minimum: 0,
                maximum: 5,
                description: '0=irrelevant, 1=low interest, 2=some interest, 3=moderate, 4=good match, 5=strong match'
            },
            reason: {
                type: 'string',
                maxLength: 200,
                description: 'Brief reason for the score, max 200 chars. This is saved in output.'
            }
        },
        required: ['score', 'reason']
    }
};

// ===== PROVIDER CONFIGURATIONS =====
// Each provider has its own API format, authentication, and response parsing.

const PROVIDERS = {
    anthropic: {
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        chatEndpoint: '/messages',
        modelsEndpoint: '/models',
        defaultModel: 'claude-sonnet-4-5-20250929',

        /**
         * Generate authentication headers for Anthropic API.
         * @param {string} apiKey - The Anthropic API key.
         * @returns {Object} Headers object.
         */
        authHeader: function(apiKey) {
            return {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            };
        },

        /**
         * Format a chat completion request for Anthropic API.
         * @param {Array} messages - The conversation messages.
         * @param {Array} tools - Tool definitions.
         * @param {Object} toolChoice - Tool choice specification.
         * @param {string} systemPrompt - System prompt.
         * @param {number} maxTokens - Maximum tokens.
         * @param {string} model - Model ID.
         * @returns {Object} Request body.
         */
        formatRequest: function(messages, tools, toolChoice, systemPrompt, maxTokens, model) {
            return {
                model: model,
                max_tokens: maxTokens,
                system: systemPrompt,
                tools: tools,
                tool_choice: toolChoice,
                messages: messages
            };
        },

        /**
         * Parse tool call from Anthropic response.
         * @param {Object} data - Response data.
         * @returns {Object|null} Tool call info {toolName, toolId, input} or null.
         */
        parseToolResponse: function(data) {
            if (data.content && Array.isArray(data.content)) {
                for (var i = 0; i < data.content.length; i++) {
                    if (data.content[i].type === 'tool_use') {
                        return {
                            toolName: data.content[i].name,
                            toolId: data.content[i].id,
                            input: data.content[i].input
                        };
                    }
                }
            }
            return null;
        },

        /**
         * Format tool result message for Anthropic.
         * @param {string} toolId - The tool call ID.
         * @param {string} content - The result content.
         * @returns {Object} Message object.
         */
        formatToolResult: function(toolId, content) {
            return {
                role: 'user',
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: toolId,
                        content: content
                    }
                ]
            };
        },

        /**
         * Format assistant message with tool use for history.
         * @param {Object} toolCall - The tool call info.
         * @returns {Object} Message object.
         */
        formatAssistantToolUse: function(toolCall) {
            return {
                role: 'assistant',
                content: [
                    {
                        type: 'tool_use',
                        id: toolCall.toolId,
                        name: toolCall.toolName,
                        input: toolCall.input
                    }
                ]
            };
        },

        /**
         * Parse models from Anthropic API response.
         * @param {Object} data - Response data.
         * @returns {Array} Array of {id, name} objects.
         */
        parseModels: function(data) {
            if (data.data && Array.isArray(data.data)) {
                return data.data.map(function(m) {
                    return { id: m.id, name: m.display_name || m.id };
                });
            }
            return [];
        }
    },

    moonshot: {
        name: 'Moonshot',
        baseUrl: 'https://api.moonshot.ai/v1',
        chatEndpoint: '/chat/completions',
        modelsEndpoint: '/models',
        defaultModel: 'kimi-k2-turbo-preview',

        /**
         * Generate authentication headers for Moonshot API.
         * @param {string} apiKey - The Moonshot API key.
         * @returns {Object} Headers object.
         */
        authHeader: function(apiKey) {
            return {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiKey
            };
        },

        /**
         * Format a chat completion request for Moonshot API (OpenAI compatible).
         * @param {Array} messages - The conversation messages (Anthropic format).
         * @param {Array} tools - Tool definitions (Anthropic format).
         * @param {Object} toolChoice - Tool choice specification.
         * @param {string} systemPrompt - System prompt.
         * @param {number} maxTokens - Maximum tokens.
         * @param {string} model - Model ID.
         * @returns {Object} Request body.
         */
        formatRequest: function(messages, tools, toolChoice, systemPrompt, maxTokens, model) {
            // Build messages array with system message first
            var formattedMessages = [];
            if (systemPrompt) {
                formattedMessages.push({ role: 'system', content: systemPrompt });
            }

            // Convert each message to OpenAI format
            for (var i = 0; i < messages.length; i++) {
                var converted = convertMessageToOpenAI(messages[i]);
                if (converted) {
                    formattedMessages.push(converted);
                }
            }

            // Convert tools to OpenAI function format
            var functions = tools.map(function(tool) {
                return {
                    type: 'function',
                    function: {
                        name: tool.name,
                        description: tool.description,
                        parameters: tool.input_schema
                    }
                };
            });

            var request = {
                model: model,
                max_tokens: maxTokens,
                messages: formattedMessages,
                tools: functions
                // Temperature omitted - let each model use its API default
            };

            // Tool choice formatting for OpenAI
            if (toolChoice && toolChoice.type === 'tool') {
                request.tool_choice = {
                    type: 'function',
                    function: { name: toolChoice.name }
                };

                // kimi-k2.5 has thinking enabled by default, which is incompatible
                // with tool_choice. Disable thinking when forcing tool use.
                if (model === 'kimi-k2.5') {
                    request.thinking = { type: 'disabled' };
                }
            }

            return request;
        },

        /**
         * Parse tool call from Moonshot/OpenAI response.
         * @param {Object} data - Response data.
         * @returns {Object|null} Tool call info {toolName, toolId, input} or null.
         */
        parseToolResponse: function(data) {
            if (data.choices && data.choices[0] && data.choices[0].message) {
                var msg = data.choices[0].message;
                if (msg.tool_calls && msg.tool_calls.length > 0) {
                    var toolCall = msg.tool_calls[0];
                    var args = {};
                    try {
                        args = JSON.parse(toolCall.function.arguments);
                    } catch (e) {
                        console.warn('[LiSeSca] Failed to parse tool arguments:', e);
                    }
                    return {
                        toolName: toolCall.function.name,
                        toolId: toolCall.id,
                        input: args
                    };
                }
            }
            return null;
        },

        /**
         * Format tool result message for OpenAI/Moonshot.
         * @param {string} toolId - The tool call ID.
         * @param {string} content - The result content.
         * @returns {Object} Message object.
         */
        formatToolResult: function(toolId, content) {
            return {
                role: 'tool',
                tool_call_id: toolId,
                content: content
            };
        },

        /**
         * Format assistant message with tool use for history (OpenAI format).
         * @param {Object} toolCall - The tool call info.
         * @returns {Object} Message object.
         */
        formatAssistantToolUse: function(toolCall) {
            return {
                role: 'assistant',
                content: null,
                tool_calls: [
                    {
                        id: toolCall.toolId,
                        type: 'function',
                        function: {
                            name: toolCall.toolName,
                            arguments: JSON.stringify(toolCall.input)
                        }
                    }
                ]
            };
        },

        /**
         * Parse models from Moonshot/OpenAI API response.
         * @param {Object} data - Response data.
         * @returns {Array} Array of {id, name} objects.
         */
        parseModels: function(data) {
            if (data.data && Array.isArray(data.data)) {
                return data.data.map(function(m) {
                    return { id: m.id, name: m.id };
                });
            }
            return [];
        }
    }
};

/**
 * Convert an Anthropic-format message to OpenAI format.
 * Handles tool_result and tool_use content blocks.
 * @param {Object} msg - Anthropic format message.
 * @returns {Object|null} OpenAI format message or null if conversion fails.
 */
function convertMessageToOpenAI(msg) {
    // Simple text message
    if (typeof msg.content === 'string') {
        return { role: msg.role, content: msg.content };
    }

    // Handle array content (tool_use or tool_result)
    if (Array.isArray(msg.content)) {
        for (var i = 0; i < msg.content.length; i++) {
            var block = msg.content[i];

            // Tool result from user
            if (block.type === 'tool_result') {
                return {
                    role: 'tool',
                    tool_call_id: block.tool_use_id,
                    content: block.content
                };
            }

            // Tool use from assistant
            if (block.type === 'tool_use') {
                return {
                    role: 'assistant',
                    content: null,
                    tool_calls: [
                        {
                            id: block.id,
                            type: 'function',
                            function: {
                                name: block.name,
                                arguments: JSON.stringify(block.input)
                            }
                        }
                    ]
                };
            }
        }
    }

    // Fallback: return as-is (might not work, but better than null)
    return msg;
}

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

    /**
     * Check if the AI client is properly configured with API key and criteria.
     * @returns {boolean} True if configured properly.
     */
    isConfigured: function() {
        return CONFIG.isAIConfigured();
    },

    /**
     * Check if People AI client is properly configured.
     * @returns {boolean} True if configured properly.
     */
    isPeopleConfigured: function() {
        return CONFIG.isPeopleAIConfigured();
    },

    /**
     * Get the current provider configuration based on selected model.
     * @returns {Object} Provider configuration object.
     */
    getProvider: function() {
        var providerName = CONFIG.getProviderForModel(CONFIG.AI_MODEL);
        if (providerName && PROVIDERS[providerName]) {
            return PROVIDERS[providerName];
        }
        // Default to Anthropic for backward compatibility
        return PROVIDERS.anthropic;
    },

    /**
     * Get the model to use for API calls.
     * @returns {string} Model ID.
     */
    getModel: function() {
        if (CONFIG.AI_MODEL) {
            return CONFIG.AI_MODEL;
        }
        // Default model based on which API key is available
        if (CONFIG.ANTHROPIC_API_KEY) {
            return PROVIDERS.anthropic.defaultModel;
        }
        if (CONFIG.MOONSHOT_API_KEY) {
            return PROVIDERS.moonshot.defaultModel;
        }
        return PROVIDERS.anthropic.defaultModel;
    },

    /**
     * Fetch available models from a specific provider.
     * @param {string} providerName - 'anthropic' or 'moonshot'.
     * @param {string} apiKey - The API key for the provider.
     * @returns {Promise<Array>} Array of model objects {id, name}.
     */
    fetchModels: function(providerName, apiKey) {
        var provider = PROVIDERS[providerName];

        if (!provider) {
            return Promise.reject(new Error('Unknown provider: ' + providerName));
        }

        if (!apiKey) {
            return Promise.reject(new Error('API key required'));
        }

        var url = provider.baseUrl + provider.modelsEndpoint;
        var headers = provider.authHeader(apiKey);

        return new Promise(function(resolve, reject) {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                headers: headers,
                onload: function(response) {
                    if (response.status !== 200) {
                        reject(new Error('API error: ' + response.status));
                        return;
                    }
                    try {
                        var data = JSON.parse(response.responseText);
                        var models = provider.parseModels(data);
                        resolve(models);
                    } catch (error) {
                        reject(new Error('Failed to parse models response: ' + error.message));
                    }
                },
                onerror: function(error) {
                    reject(new Error('Network error'));
                },
                ontimeout: function() {
                    reject(new Error('Request timeout'));
                },
                timeout: 15000
            });
        });
    },

    /**
     * Fetch models from all providers with valid API keys.
     * Updates CONFIG.CACHED_MODELS with results.
     * @returns {Promise<Object>} Object with {anthropic: [], moonshot: []} arrays.
     */
    fetchAllModels: function() {
        var self = this;
        var promises = [];
        var results = {
            anthropic: [],
            moonshot: []
        };

        // Fetch from Anthropic if key is present
        if (CONFIG.ANTHROPIC_API_KEY) {
            promises.push(
                self.fetchModels('anthropic', CONFIG.ANTHROPIC_API_KEY)
                    .then(function(models) {
                        results.anthropic = models;
                        CONFIG.CACHED_MODELS.anthropic = models;
                        CONFIG.CACHED_MODELS.lastFetch.anthropic = Date.now();
                    })
                    .catch(function(error) {
                        console.warn('[LiSeSca] Failed to fetch Anthropic models:', error);
                        results.anthropic = [];
                    })
            );
        }

        // Fetch from Moonshot if key is present
        if (CONFIG.MOONSHOT_API_KEY) {
            promises.push(
                self.fetchModels('moonshot', CONFIG.MOONSHOT_API_KEY)
                    .then(function(models) {
                        results.moonshot = models;
                        CONFIG.CACHED_MODELS.moonshot = models;
                        CONFIG.CACHED_MODELS.lastFetch.moonshot = Date.now();
                    })
                    .catch(function(error) {
                        console.warn('[LiSeSca] Failed to fetch Moonshot models:', error);
                        results.moonshot = [];
                    })
            );
        }

        return Promise.all(promises).then(function() {
            return results;
        });
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
     * @returns {Promise<void>}
     */
    initPeopleConversation: function() {
        if (this.peopleInitialized) {
            return Promise.resolve();
        }

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
     * Send a job card for evaluation using the configured provider.
     * @param {string} cardMarkdown - The job card formatted as Markdown.
     * @returns {Promise<boolean>} True if the job should be downloaded.
     */
    sendJobForEvaluation: function(cardMarkdown) {
        var self = this;
        var provider = this.getProvider();
        var model = this.getModel();
        var apiKey = CONFIG.getActiveAPIKey();

        // Add the job card to the conversation
        var messagesWithJob = this.conversationHistory.concat([
            { role: 'user', content: cardMarkdown }
        ]);

        var requestBody = provider.formatRequest(
            messagesWithJob,
            [JOB_EVALUATION_TOOL],
            { type: 'tool', name: 'job_evaluation' },
            SYSTEM_PROMPT,
            100,
            model
        );

        var url = provider.baseUrl + provider.chatEndpoint;
        var headers = provider.authHeader(apiKey);

        return new Promise(function(resolve, reject) {
            GM_xmlhttpRequest({
                method: 'POST',
                url: url,
                headers: headers,
                data: JSON.stringify(requestBody),
                onload: function(response) {
                    self.handleApiResponse(response, cardMarkdown, resolve, reject, provider);
                },
                onerror: function(error) {
                    console.error('[LiSeSca] AI API request failed:', error);
                    reject(new Error('Network error'));
                },
                ontimeout: function() {
                    console.error('[LiSeSca] AI API request timed out');
                    reject(new Error('Request timeout'));
                },
                timeout: 30000
            });
        });
    },

    /**
     * Handle the API response and extract the evaluation result.
     * @param {Object} response - The GM_xmlhttpRequest response object.
     * @param {string} cardMarkdown - The original job card (for logging).
     * @param {Function} resolve - Promise resolve function.
     * @param {Function} reject - Promise reject function.
     * @param {Object} provider - The provider configuration (optional, defaults to current).
     */
    handleApiResponse: function(response, cardMarkdown, resolve, reject, provider) {
        provider = provider || this.getProvider();

        if (response.status !== 200) {
            console.error('[LiSeSca] AI API error:', response.status, response.responseText);
            // Fail-open: allow the job on API errors
            resolve(true);
            return;
        }

        try {
            var data = JSON.parse(response.responseText);

            // Use provider's parsing method
            var toolCall = provider.parseToolResponse(data);

            if (!toolCall || toolCall.toolName !== 'job_evaluation') {
                console.warn('[LiSeSca] Unexpected AI response format, allowing job.');
                resolve(true);
                return;
            }

            var shouldDownload = toolCall.input.download === true;

            // Update conversation history with this exchange (in Anthropic format for internal consistency)
            this.conversationHistory.push({ role: 'user', content: cardMarkdown });
            this.conversationHistory.push({
                role: 'assistant',
                content: [
                    {
                        type: 'tool_use',
                        id: toolCall.toolId,
                        name: toolCall.toolName,
                        input: toolCall.input
                    }
                ]
            });
            // Add tool result to complete the exchange
            this.conversationHistory.push({
                role: 'user',
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: toolCall.toolId,
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
     * Send a job card for three-tier triage using the configured provider.
     * @param {string} cardMarkdown - The job card formatted as Markdown.
     * @returns {Promise<{decision: string, reason: string}>} Decision object with reason.
     */
    sendCardForTriage: function(cardMarkdown) {
        var self = this;
        var provider = this.getProvider();
        var model = this.getModel();
        var apiKey = CONFIG.getActiveAPIKey();

        var messagesWithJob = this.conversationHistory.concat([
            { role: 'user', content: cardMarkdown }
        ]);

        var requestBody = provider.formatRequest(
            messagesWithJob,
            [CARD_TRIAGE_TOOL, FULL_EVALUATION_TOOL],
            { type: 'tool', name: 'card_triage' },
            FULL_AI_SYSTEM_PROMPT,
            200,
            model
        );

        var url = provider.baseUrl + provider.chatEndpoint;
        var headers = provider.authHeader(apiKey);

        return new Promise(function(resolve, reject) {
            GM_xmlhttpRequest({
                method: 'POST',
                url: url,
                headers: headers,
                data: JSON.stringify(requestBody),
                onload: function(response) {
                    self.handleTriageResponse(response, cardMarkdown, resolve, reject, provider);
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
     * @param {Object} provider - The provider configuration.
     */
    handleTriageResponse: function(response, cardMarkdown, resolve, reject, provider) {
        provider = provider || this.getProvider();

        if (response.status !== 200) {
            console.error('[LiSeSca] AI triage API error:', response.status, response.responseText);
            resolve({ decision: 'keep', reason: 'API error ' + response.status }); // Fail-open
            return;
        }

        try {
            var data = JSON.parse(response.responseText);

            // Use provider's parsing method
            var toolCall = provider.parseToolResponse(data);

            if (!toolCall || toolCall.toolName !== 'card_triage') {
                console.warn('[LiSeSca] Unexpected triage response format, returning "keep".');
                resolve({ decision: 'keep', reason: 'Unexpected response format' });
                return;
            }

            var decision = toolCall.input.decision;
            var reason = toolCall.input.reason || '(no reason provided)';

            if (decision !== 'reject' && decision !== 'keep' && decision !== 'maybe') {
                console.warn('[LiSeSca] Invalid triage decision "' + decision + '", returning "keep".');
                decision = 'keep';
                reason = 'Invalid decision value: ' + decision;
            }

            // Update conversation history (in Anthropic format for internal consistency)
            this.conversationHistory.push({ role: 'user', content: cardMarkdown });
            this.conversationHistory.push({
                role: 'assistant',
                content: [
                    {
                        type: 'tool_use',
                        id: toolCall.toolId,
                        name: toolCall.toolName,
                        input: toolCall.input
                    }
                ]
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
                        tool_use_id: toolCall.toolId,
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
     * Send full job details for final evaluation using the configured provider.
     * @param {string} fullJobMarkdown - The complete job formatted as Markdown.
     * @returns {Promise<{accept: boolean, reason: string}>} Decision object with reason.
     */
    sendFullJobForEvaluation: function(fullJobMarkdown) {
        var self = this;
        var provider = this.getProvider();
        var model = this.getModel();
        var apiKey = CONFIG.getActiveAPIKey();

        var contextMessage = 'Here are the full job details for your final decision:\n\n' + fullJobMarkdown;

        var messagesWithJob = this.conversationHistory.concat([
            { role: 'user', content: contextMessage }
        ]);

        var requestBody = provider.formatRequest(
            messagesWithJob,
            [CARD_TRIAGE_TOOL, FULL_EVALUATION_TOOL],
            { type: 'tool', name: 'full_evaluation' },
            FULL_AI_SYSTEM_PROMPT,
            500,
            model
        );

        var url = provider.baseUrl + provider.chatEndpoint;
        var headers = provider.authHeader(apiKey);

        return new Promise(function(resolve, reject) {
            GM_xmlhttpRequest({
                method: 'POST',
                url: url,
                headers: headers,
                data: JSON.stringify(requestBody),
                onload: function(response) {
                    self.handleFullEvaluationResponse(response, contextMessage, resolve, reject, provider);
                },
                onerror: function(error) {
                    console.error('[LiSeSca] AI full evaluation request failed:', error);
                    reject(new Error('Network error'));
                },
                ontimeout: function() {
                    console.error('[LiSeSca] AI full evaluation request timed out');
                    reject(new Error('Request timeout'));
                },
                timeout: 60000
            });
        });
    },

    /**
     * Handle the full evaluation API response.
     * @param {Object} response - The GM_xmlhttpRequest response object.
     * @param {string} contextMessage - The message sent with full job details.
     * @param {Function} resolve - Promise resolve function.
     * @param {Function} reject - Promise reject function.
     * @param {Object} provider - The provider configuration.
     */
    handleFullEvaluationResponse: function(response, contextMessage, resolve, reject, provider) {
        provider = provider || this.getProvider();

        if (response.status !== 200) {
            console.error('[LiSeSca] AI full evaluation API error:', response.status, response.responseText);
            resolve({ accept: true, reason: 'API error ' + response.status }); // Fail-open
            return;
        }

        try {
            var data = JSON.parse(response.responseText);

            // Use provider's parsing method
            var toolCall = provider.parseToolResponse(data);

            if (!toolCall || toolCall.toolName !== 'full_evaluation') {
                console.warn('[LiSeSca] Unexpected full evaluation response, accepting job.');
                resolve({ accept: true, reason: 'Unexpected response format' });
                return;
            }

            var accept = toolCall.input.accept === true;
            var reason = toolCall.input.reason || '(no reason provided)';

            // Update conversation history (in Anthropic format for internal consistency)
            this.conversationHistory.push({ role: 'user', content: contextMessage });
            this.conversationHistory.push({
                role: 'assistant',
                content: [
                    {
                        type: 'tool_use',
                        id: toolCall.toolId,
                        name: toolCall.toolName,
                        input: toolCall.input
                    }
                ]
            });
            this.conversationHistory.push({
                role: 'user',
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: toolCall.toolId,
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
     * Score a person card on a 0-5 scale.
     * @param {string} cardMarkdown - The person card formatted as Markdown.
     * @returns {Promise<{score: number, label: string, reason: string}>}
     */
    scorePeopleCard: function(cardMarkdown) {
        var self = this;

        if (!this.isPeopleConfigured()) {
            console.warn('[LiSeSca] People AI not configured, returning score 3.');
            return Promise.resolve({ score: 3, label: 'Moderate interest', reason: 'AI not configured' });
        }

        return this.initPeopleConversation().then(function() {
            return self.sendPeopleCardForScoring(cardMarkdown);
        }).catch(function(error) {
            console.error('[LiSeSca] People AI scoring error, returning score 3:', error);
            return { score: 3, label: 'Moderate interest', reason: 'Error: ' + error.message };
        });
    },

    /**
     * Convert a numeric score to a label.
     * @param {number} score - The score (0-5).
     * @returns {string} The label.
     */
    scoreToLabel: function(score) {
        var labels = {
            0: 'Irrelevant',
            1: 'Low interest',
            2: 'Some interest',
            3: 'Moderate interest',
            4: 'Good match',
            5: 'Strong match'
        };
        return labels[score] || 'Unknown';
    },

    /**
     * Send a person card for scoring using the configured provider.
     * @param {string} cardMarkdown - The person card formatted as Markdown.
     * @returns {Promise<{score: number, label: string, reason: string}>}
     */
    sendPeopleCardForScoring: function(cardMarkdown) {
        var self = this;
        var provider = this.getProvider();
        var model = this.getModel();
        var apiKey = CONFIG.getActiveAPIKey();

        // Criteria is in the system prompt, conversation history has prior cards
        var messagesWithCard = this.peopleConversationHistory.concat([
            { role: 'user', content: cardMarkdown }
        ]);

        var requestBody = provider.formatRequest(
            messagesWithCard,
            [PEOPLE_SCORE_TOOL],
            { type: 'tool', name: 'people_score' },
            PEOPLE_SCORE_SYSTEM_PROMPT + CONFIG.PEOPLE_CRITERIA,
            300,
            model
        );

        var url = provider.baseUrl + provider.chatEndpoint;
        var headers = provider.authHeader(apiKey);

        return new Promise(function(resolve, reject) {
            GM_xmlhttpRequest({
                method: 'POST',
                url: url,
                headers: headers,
                data: JSON.stringify(requestBody),
                onload: function(response) {
                    self.handlePeopleScoreResponse(response, cardMarkdown, resolve, reject, provider);
                },
                onerror: function(error) {
                    console.error('[LiSeSca] People AI scoring request failed:', error);
                    reject(new Error('Network error'));
                },
                ontimeout: function() {
                    console.error('[LiSeSca] People AI scoring request timed out');
                    reject(new Error('Request timeout'));
                },
                timeout: 30000
            });
        });
    },

    /**
     * Handle the people scoring API response and extract the score.
     * @param {Object} response - The GM_xmlhttpRequest response object.
     * @param {string} cardMarkdown - The original person card.
     * @param {Function} resolve - Promise resolve function.
     * @param {Function} reject - Promise reject function.
     * @param {Object} provider - The provider configuration.
     */
    handlePeopleScoreResponse: function(response, cardMarkdown, resolve, reject, provider) {
        var self = this;
        provider = provider || this.getProvider();

        if (response.status !== 200) {
            console.error('[LiSeSca] People AI scoring API error:', response.status, response.responseText);
            resolve({ score: 3, label: 'Moderate interest', reason: 'API error ' + response.status });
            return;
        }

        try {
            var data = JSON.parse(response.responseText);

            // Use provider's parsing method
            var toolCall = provider.parseToolResponse(data);

            if (!toolCall || toolCall.toolName !== 'people_score') {
                console.warn('[LiSeSca] Unexpected people scoring response format, returning score 3.');
                resolve({ score: 3, label: 'Moderate interest', reason: 'Unexpected response format' });
                return;
            }

            var score = toolCall.input.score;
            var reason = toolCall.input.reason || '(no reason provided)';

            // Validate score is in range
            if (typeof score !== 'number' || score < 0 || score > 5) {
                console.warn('[LiSeSca] Invalid people score "' + score + '", returning 3.');
                score = 3;
                reason = 'Invalid score value: ' + score;
            }

            var label = self.scoreToLabel(score);

            // Update conversation history (in Anthropic format for internal consistency)
            this.peopleConversationHistory.push({ role: 'user', content: cardMarkdown });
            this.peopleConversationHistory.push({
                role: 'assistant',
                content: [
                    {
                        type: 'tool_use',
                        id: toolCall.toolId,
                        name: toolCall.toolName,
                        input: toolCall.input
                    }
                ]
            });

            var resultMessage = score >= 3 ? 'Person scored ' + score + '/5, saved.' : 'Person scored ' + score + '/5, skipped.';

            this.peopleConversationHistory.push({
                role: 'user',
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: toolCall.toolId,
                        content: resultMessage
                    }
                ]
            });

            resolve({ score: score, label: label, reason: reason });
        } catch (error) {
            console.error('[LiSeSca] Failed to parse people scoring response:', error);
            resolve({ score: 3, label: 'Moderate interest', reason: 'Parse error: ' + error.message });
        }
    }
};
