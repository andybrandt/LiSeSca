// ===== CSS SELECTORS (PROFILE PAGE) =====
// Resilient selectors for LinkedIn profile pages.
// Uses multiple fallbacks to handle DOM changes and variants.
export const ProfileSelectors = {
    MAIN: 'main',
    NAME: [
        'main h1',
        'h1.text-heading-xlarge',
        'h1.inline.t-24.v-align-middle.break-words'
    ],
    HEADLINE: [
        'main .text-body-medium.break-words',
        'main .text-body-medium'
    ],
    LOCATION: [
        'main .text-body-small.inline.t-black--light.break-words',
        'main span.text-body-small'
    ],
    // About section - may or may not have id="about"
    ABOUT_SECTION: [
        'section#about',
        'section[id*="about"]',
        'div[data-generated-suggestion-target*="profileActionDelegate"]'
    ],
    // About text is inside inline-show-more-text div, within a span[aria-hidden="true"]
    ABOUT_TEXT: [
        '.inline-show-more-text--is-collapsed span[aria-hidden="true"]',
        '[class*="inline-show-more-text"] span[aria-hidden="true"]',
        '.inline-show-more-text span[aria-hidden="true"]',
        '.pv-about__summary-text'
    ],
    EXPERIENCE_SECTION: [
        'section#experience',
        'section[id*="experience"]',
        'section[data-section="experience"]'
    ],
    // Top-level experience items (companies or single-role entries)
    EXPERIENCE_ITEM: [
        'li.artdeco-list__item[class*="pXbLhQQkFNcNGwsNCWApKbulZKgFfyPVWU"]',
        'li.artdeco-list__item div[data-view-name="profile-component-entity"]'
    ],
    // Role title - look for bold text with hoverable-link-text
    EXPERIENCE_ROLE_TITLE: [
        '.mr1.hoverable-link-text.t-bold span[aria-hidden="true"]',
        '.mr1.t-bold span[aria-hidden="true"]',
        'div.display-flex.align-items-center.mr1 span[aria-hidden="true"]'
    ],
    // Company name - in t-14 t-normal (not t-black--light which is dates/location)
    EXPERIENCE_COMPANY: [
        'span.t-14.t-normal:not(.t-black--light) span[aria-hidden="true"]',
        '.t-14.t-normal:not(.t-black--light) span[aria-hidden="true"]'
    ],
    // Dates/duration in caption wrapper or t-black--light spans
    EXPERIENCE_DATES: [
        '.pvs-entity__caption-wrapper[aria-hidden="true"]',
        'span.t-14.t-normal.t-black--light span.pvs-entity__caption-wrapper',
        'span.t-14.t-normal.t-black--light span[aria-hidden="true"]'
    ],
    // Location is also in t-black--light but usually second occurrence
    EXPERIENCE_LOCATION: [
        'span.t-14.t-normal.t-black--light span[aria-hidden="true"]'
    ],
    EXPERIENCE_DESCRIPTION: [
        '.inline-show-more-text',
        '.pv-shared-text-with-see-more'
    ],
    // Nested roles within a company entry
    EXPERIENCE_SUB_ROLES: [
        '.pvs-entity__sub-components li',
        'div[class*="pvs-entity__sub-components"] li'
    ],
    SHOW_MORE_BUTTON: [
        'button[aria-expanded="false"]',
        'button[aria-label*="more"]',
        'button[aria-label="See more"]',
        'button[aria-label="Show more"]'
    ]
};
