# LiSeSca - LinkedIn Search Scraper

A [Tampermonkey](https://www.tampermonkey.net/) userscript that scrapes LinkedIn people search results and job postings across multiple pages while emulating human browsing behavior to avoid bot detection.

## What It Does

LiSeSca injects a floating control panel into LinkedIn search pages, letting you scrape structured data from:

- **People search results** — name, connection degree, description, location, profile URL
- **Job search results** — 15+ fields including job title, company, location, full job description (converted to Markdown), premium insights, job state (Viewed/Applied), and more

Scraped data can be exported in **XLSX**, **CSV** (people only), and **Markdown** formats.

### AI Filtering (Optional)

LiSeSca supports two AI providers for automatic filtering of search results:

- **Anthropic Claude** (Claude Sonnet and other models)
- **Moonshot Kimi** (Kimi K2 and other models)

You can configure API keys for one or both providers and select which model to use from a dropdown that fetches available models from the provider's API.

#### AI Job Filtering

For job searches, LiSeSca offers two AI filtering modes:

**Basic mode** — the AI evaluates each job card (title, company, location) against your criteria and makes a binary keep/skip decision. Jobs deemed irrelevant are skipped without downloading their full details. The AI errs on the side of inclusion — when uncertain, it keeps the job.

**Full AI evaluation mode** — a three-tier process for more precise filtering:

1. **Triage** — the AI examines each job card and decides: *reject* (clearly irrelevant), *keep* (clearly relevant), or *maybe* (uncertain).
2. Rejected jobs are skipped immediately. Kept jobs are downloaded directly.
3. **Full evaluation** — "maybe" jobs have their complete details downloaded, then the AI evaluates the full job description for a final accept/reject decision.

This two-stage approach saves API costs by only downloading full details for jobs that need closer inspection.

#### AI People Filtering

For people searches, the AI scores each profile on a 0–5 scale based on your criteria. Only profiles scoring 3 or higher are saved. The AI sees the profile card info (name, headline, location, connection degree) and rates relevance against your described criteria.

If the AI service becomes unresponsive (3 consecutive failures), it is automatically disabled for the remainder of that page, and remaining profiles are saved without a rating (fail-open design).

### Human Emulation

To avoid LinkedIn's bot detection, LiSeSca simulates human browsing behavior:
- Random scrolling with variable speed
- Synthetic mouse movement events
- Configurable reading pauses between pages and between individual job reviews
- Random timing delays throughout the process

## Prerequisites

- **Chrome** or **Chromium**-based browser
- **[Tampermonkey](https://www.tampermonkey.net/)** browser extension ([Chrome Web Store](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo))

### Enabling User Scripts in Tampermonkey

By default, Tampermonkey only allows scripts installed from its online repositories (Greasy Fork, etc.). To install LiSeSca from a local file or from this GitHub repository, you need to enable user scripts. [Follow steps described in Tampermonkey's FAQ here](https://www.tampermonkey.net/faq.php#Q209). Without this, Tampermonkey will refuse to install the script.

## Installation

1. Make sure your Tampermonkey would allow this script to run (see above).
2. Open the raw `lisesca.user.js` file (from this repository or your local copy).
3. Tampermonkey should automatically detect the userscript and offer to install it. Click **Install**.
4. Alternatively, open the Tampermonkey Dashboard, go to the **Utilities** tab, and paste the URL to the raw script file under **Install from URL**.

## Usage

1. Navigate to any LinkedIn page — the script loads on all LinkedIn pages.
2. When you navigate to a **People Search** page (`linkedin.com/search/results/people/...`) or a **Jobs Search** page (`linkedin.com/jobs/search/...` or `linkedin.com/jobs/collections/...`), a floating panel appears near the top-right corner. The panel automatically appears/disappears as you navigate within LinkedIn (SPA navigation is supported — if you arrive from a non-search page like `/feed/`, the page will automatically reload once to ensure correct operation).
3. Click the **SCRAPE** button to reveal options.
4. Choose how many pages to scrape:
   - **People search:** 1, 10, 50, or All pages
   - **Jobs search:** 1, 3, 5, 10, or All pages (All calculates the total from LinkedIn's result count, up to 25 pages)
5. Select output formats (XLSX is selected by default; CSV is available for people only).
6. For jobs, additional options appear:
   - **Include viewed** — uncheck to skip jobs you have already viewed or applied to
   - **AI job selection** — enable to use basic AI filtering (requires AI setup, see below)
   - **Full AI evaluation** — enable for three-tier AI filtering instead of basic mode
7. For people, if AI is configured:
   - **Include AI filtering for people** — enable to use AI scoring (only profiles with score ≥ 3 are saved)
8. Click **GO** to start scraping.
9. The script will emulate human browsing on each page, then automatically navigate to the next page.
10. When finished (or when you press **STOP**), a **summary window** appears showing:
    - Pages scanned, total jobs/profiles processed, and how many were saved
    - AI filtering stats (if enabled): triaged, fully evaluated, and accepted counts
    - A prominent notice if the session was stopped early
11. Use **Download Results** to export your data. You can download multiple times if needed.
12. Use **Clear Data & Close** when done to dismiss the summary and clear the session.

**Tip:** If you press **STOP** mid-scrape, the summary window still appears so you can download any partial results collected so far.

### Timing Configuration

Click the gear icon next to the SCRAPE button to adjust timing parameters:
- **Page time** — how long (in seconds) the script lingers on each search results page
- **Job review time** — how long spent on each individual job detail (jobs mode)
- **Job pause time** — delay between switching job cards (jobs mode)

### AI Filtering Setup

To use AI-powered filtering, you need an API key from at least one supported provider:

1. Get an API key:
   - **Anthropic:** Sign up at [console.anthropic.com](https://console.anthropic.com) and create an API key (starts with `sk-ant-`)
   - **Moonshot:** Sign up at [platform.moonshot.cn](https://platform.moonshot.cn) and create an API key
2. In LiSeSca, click the **gear icon** to open Configuration.
3. Click the **AI Filtering...** button to open the AI configuration panel.
4. Enter your API key(s) — you can configure one or both providers.
5. **Select a model** from the dropdown. Click **Refresh** to fetch the latest available models from the provider APIs.
6. In the **Job Criteria** textarea, describe the job you are looking for. Be specific about what you want and what you do not want.
7. In the **People Criteria** textarea, describe what kind of profiles you are interested in.
8. Click **Save**.

**Example job criteria:**
```
I am looking for Senior Software Engineering Manager roles.
I have 15 years of experience in software development and team leadership.
I prefer remote or hybrid positions in the tech industry.

I am NOT interested in:
- Manufacturing, industrial, or non-tech positions
- Roles requiring domain expertise I don't have (e.g., healthcare, finance compliance)
- Junior or mid-level positions
```

**Note:** AI filtering uses external APIs, which have associated costs. Basic job filtering is economical — the AI only sees brief job card summaries. Full AI evaluation uses more tokens for "maybe" jobs that require a second evaluation of the complete job description. If the API is unavailable or returns errors, jobs are kept rather than discarded (fail-open design).

### Crash Recovery

LiSeSca persists its state using Tampermonkey's storage. If the browser crashes or the page is accidentally closed mid-scrape, reopening the LinkedIn search page will resume the scrape from where it left off.

## Building from Source

The source code is split into ES modules under `src/` and bundled using [Rollup](https://rollupjs.org/).

```bash
npm install        # Install dependencies (first time only)
npm run build      # Bundle into lisesca.user.js
```

The build output is `lisesca.user.js` in the project root.

## Disclaimer

This tool is intended for personal use to assist with job searching and networking. Use responsibly and in accordance with LinkedIn's Terms of Service. Excessive or abusive scraping may result in account restrictions.

## License

This project is provided as-is for personal use.
