import assert from 'node:assert/strict';

import { AIClient } from '../src/shared/ai-client.js';
import { CONFIG } from '../src/shared/config.js';

function createForcedToolRequest(model) {
    CONFIG.AI_MODEL = model;

    var provider = AIClient.getProvider();
    return provider.formatRequest(
        [{ role: 'user', content: 'Score this item.' }],
        [
            {
                name: 'score_item',
                description: 'Score an item',
                input_schema: {
                    type: 'object',
                    properties: {
                        score: { type: 'number' }
                    },
                    required: ['score']
                }
            }
        ],
        { type: 'tool', name: 'score_item' },
        'Use the scoring tool.',
        100,
        model
    );
}

function testKimiThinkingDisabledForForcedTools() {
    var k25Request = createForcedToolRequest('kimi-k2.5');
    var k26Request = createForcedToolRequest('kimi-k2.6');

    assert.deepEqual(k25Request.thinking, { type: 'disabled' });
    assert.deepEqual(k26Request.thinking, { type: 'disabled' });
}

testKimiThinkingDisabledForForcedTools();
