// Rollup configuration for LiSeSca userscript
// Bundles ES modules into a single IIFE for Tampermonkey

const banner = `// ==UserScript==
// @name         LiSeSca - LinkedIn Search Scraper
// @namespace    https://github.com/andybrandt/lisesca
// @version      0.3.13
// @description  Scrapes LinkedIn people search and job search results with human emulation
// @author       Andy Brandt
// @homepageURL  https://github.com/andybrandt/LiSeSca
// @updateURL    https://github.com/andybrandt/LiSeSca/raw/refs/heads/master/lisesca.user.js
// @downloadURL  https://github.com/andybrandt/LiSeSca/raw/refs/heads/master/lisesca.user.js
// @match        https://www.linkedin.com/*
// @noframes	
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      api.anthropic.com
// @require      https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js
// @require      https://cdn.jsdelivr.net/npm/turndown@7.2.0/dist/turndown.js
// @run-at       document-idle
// ==/UserScript==
`;

export default {
    input: 'src/index.js',
    output: {
        file: 'lisesca.user.js',
        format: 'iife',
        banner: banner,
        indent: '    ',
        strict: true
    }
};
