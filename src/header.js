// ==UserScript==
// @name         LiSeSca - LinkedIn Search Scraper
// @namespace    https://github.com/andybrandt/lisesca
// @version      0.3.8
// @description  Scrapes LinkedIn people search and job search results with human emulation
// @author       Andy Brandt
// @match        https://www.linkedin.com/search/results/people/*
// @match        https://www.linkedin.com/jobs/search/*
// @match        https://www.linkedin.com/jobs/collections/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @require      https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js
// @require      https://cdn.jsdelivr.net/npm/turndown@7.2.0/dist/turndown.js
// @run-at       document-idle
// ==/UserScript==
