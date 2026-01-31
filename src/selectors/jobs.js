// ===== CSS SELECTORS (JOBS) =====
// Selectors for LinkedIn's job search DOM.
// The jobs UI uses a two-panel layout: left panel = job list, right panel = detail view.
// Job cards use data-job-id attributes for identification.
export const JobSelectors = {
    // Left panel — job list
    JOB_CARD: 'div[data-job-id]',
    JOB_LIST_ITEM: '[data-occludable-job-id]',  // Outer <li> shell — always present for all jobs
    CARD_TITLE_LINK: 'a.job-card-container__link',
    CARD_COMPANY: '.artdeco-entity-lockup__subtitle span',
    CARD_METADATA: '.job-card-container__metadata-wrapper li span',
    CARD_INSIGHT: '.job-card-container__job-insight-text',
    CARD_FOOTER_JOB_STATE: '.job-card-container__footer-job-state',

    // Right panel — detail view
    DETAIL_CONTAINER: '.jobs-search__job-details--container',
    DETAIL_TITLE: '.job-details-jobs-unified-top-card__job-title h1',
    DETAIL_COMPANY_NAME: '.job-details-jobs-unified-top-card__company-name a',
    DETAIL_PRIMARY_DESC: '.job-details-jobs-unified-top-card__primary-description-container',
    DETAIL_TERTIARY_DESC: '.job-details-jobs-unified-top-card__tertiary-description-container',
    DETAIL_FIT_PREFS: '.job-details-fit-level-preferences button',
    DETAIL_APPLY_BUTTON: '.jobs-apply-button',
    DETAIL_JOB_DESCRIPTION: '#job-details',
    DETAIL_SHOW_MORE: '.inline-show-more-text__button',

    // Premium sections
    DETAIL_PREMIUM_INSIGHTS: '.jobs-premium-applicant-insights',
    DETAIL_PREMIUM_AI_ASSESSMENT: '.job-details-module h2',

    // About the company
    DETAIL_ABOUT_COMPANY: '.jobs-company',
    DETAIL_COMPANY_INFO: '.jobs-company__inline-information',
    DETAIL_COMPANY_DESC: '.jobs-company__company-description',

    // People connections
    DETAIL_CONNECTIONS: '.job-details-people-who-can-help__connections-card-summary',

    // Pagination (jobs uses different classes than people search)
    PAGINATION: '.jobs-search-pagination__pages',
    PAGINATION_BUTTON: '.jobs-search-pagination__indicator-button'
};
