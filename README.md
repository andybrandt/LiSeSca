# LiSeSca - LinkedIn Search Scraper

A [Tampermonkey](https://www.tampermonkey.net/) userscript that scrapes LinkedIn people search results and job postings across multiple pages while emulating human browsing behavior to avoid bot detection.

## What It Does

LiSeSca injects a floating control panel into LinkedIn search pages, letting you scrape structured data from:

- **People search results** — name, connection degree, description, location, profile URL
- **Job search results** — 15+ fields including job title, company, location, full job description (converted to Markdown), premium insights, job state (Viewed/Applied), and more

Scraped data can be exported in **XLSX**, **CSV** (people only), and **Markdown** formats.

### AI Job Filtering (Optional)

For job searches, LiSeSca can use **Claude AI** (Anthropic's API) to automatically filter out irrelevant job postings before downloading their full details. You describe your ideal job criteria, and the AI evaluates each job card — skipping jobs that clearly don't match (e.g., wrong industry, unrelated role type). This produces a more relevant output file and saves time reviewing unsuitable positions.

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

By default, Tampermonkey only allows scripts installed from its online repositories (Greasy Fork, etc.). To install LiSeSca from a local file or from this GitHub repository, you need to enable user scripts. [Follow steps described in Tampermonkey's FAQ here](https://www.tampermonkey.net/faq.php#Q209). Without this, as installed Tampermonkey will refuse to install the script.

## Installation

1. Make sure your Tampermonkey would allow this script to run (see above).
2. Open the raw `lisesca.user.js` file (from this repository or your local copy).
3. Tampermonkey should automatically detect the userscript and offer to install it. Click **Install**.
4. Alternatively, open the Tampermonkey Dashboard, go to the **Utilities** tab, and paste the URL to the raw script file under **Install from URL**.

## Usage

1. Navigate to any LinkedIn page — the script loads on all LinkedIn pages.
2. When you navigate to a **People Search** page (`linkedin.com/search/results/people/...`) or a **Jobs Search** page (`linkedin.com/jobs/search/...` or `linkedin.com/jobs/collections/...`), a floating panel appears near the top-right corner. The panel automatically appears/disappears as you navigate within LinkedIn (SPA navigation is fully supported).
3. Click the **SCRAPE** button to reveal options.
4. Choose how many pages to scrape:
   - **People search:** 1, 10, 50, or All pages
   - **Jobs search:** 1, 3, 5, or 10 pages
5. For jobs search, you have additional filtering options:
   - **Include viewed** — uncheck to skip jobs marked as "Viewed" or "Applied"
   - **AI job selection** — enable to use AI filtering (requires setup, see below)
6. Click **GO** to start scraping.
7. The script will emulate human browsing on each page, then automatically navigate to the next page.
8. When finished, a download dialog appears with your chosen export format.

### Configuration

Click the gear icon next to the SCRAPE button to adjust timing parameters:
- **Page time** — how long (in seconds) the script lingers on each search results page
- **Job review time** — how long spent on each individual job detail (jobs mode)
- **Job pause time** — delay between switching job cards (jobs mode)

### AI Job Filtering Setup

To use AI-powered job filtering, you need an **Anthropic API key**:

1. Sign up at [console.anthropic.com](https://console.anthropic.com) and create an API key
2. In LiSeSca, click the **gear icon** to open Configuration
3. Click the **AI Filtering...** button to open the AI configuration panel
4. Enter your **API Key** (starts with `sk-ant-`)
5. In the **Job Criteria** textarea, describe the job you're looking for. Be specific about:
   - Your target role and experience level
   - Industries or domains you prefer
   - What you explicitly **don't** want (this helps the AI filter effectively)
6. Click **Save**

**Example criteria:**
```
I am looking for Senior Software Engineering Manager roles.
I have 15 years of experience in software development and team leadership.
I prefer remote or hybrid positions in the tech industry.

I am NOT interested in:
- Manufacturing, industrial, or non-tech positions
- Roles requiring domain expertise I don't have (e.g., healthcare, finance compliance)
- Junior or mid-level positions
```

Once configured, the **AI job selection** checkbox appears in the jobs scrape menu. Enable it to activate AI filtering during scraping. The AI evaluates each job card before downloading details — jobs it deems irrelevant are skipped automatically.

**Note:** AI filtering uses the Claude API, which has associated costs. Each job evaluation uses minimal tokens (the AI only sees the job card summary, not full descriptions). If the API is unavailable or returns an error, the job is downloaded anyway (fail-open design).

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
