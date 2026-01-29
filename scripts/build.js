/**
 * LiSeSca Build Script
 *
 * Concatenates source files in exact order to produce lisesca.user.js.
 * For Phase A verification, this must produce a byte-for-byte match
 * with lisesca.user.js-reference.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');

/**
 * Files to concatenate, in exact order.
 * Each file's content is concatenated directly without any separator.
 */
const FILES = [
    'header.js',
    'wrapper-start.js',
    'shared/config.js',
    'shared/page-detector.js',
    'selectors/people.js',
    'selectors/jobs.js',
    'shared/turndown.js',
    'shared/state.js',
    'people/extractor.js',
    'jobs/extractor.js',
    'people/emulator.js',
    'jobs/emulator.js',
    'people/paginator.js',
    'jobs/paginator.js',
    'people/output.js',
    'jobs/output.js',
    'ui/ui.js',
    'people/controller.js',
    'jobs/controller.js',
    'entry.js',
    'wrapper-end.js'
];

/**
 * Read all source files and concatenate them.
 * @returns {string} The concatenated content.
 */
function build() {
    const parts = [];

    for (const file of FILES) {
        const filePath = join(SRC, file);
        try {
            const content = readFileSync(filePath, 'utf-8');
            parts.push(content);
        } catch (error) {
            console.error(`ERROR: Could not read ${file}: ${error.message}`);
            process.exit(1);
        }
    }

    return parts.join('');
}

// Run the build
console.log('[build] Concatenating source files...');
const output = build();

const outputPath = join(ROOT, 'lisesca.user.js');
writeFileSync(outputPath, output, 'utf-8');

console.log(`[build] Wrote ${output.length} bytes to lisesca.user.js`);
console.log('[build] Run "npm run verify" to check against reference.');
