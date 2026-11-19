
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });

// ======================================
// 1. READ CONFIGURATION
// ======================================

const config = require("./config.json");

if (!Array.isArray(config.websites) || config.websites.length === 0) {
    throw new Error("config.json must contain a non-empty websites array.");
}

const crawlerConfig = config.crawler;
const browserConfig = config.browser;
const outputConfig = config.output;

const OUTPUT_ROOT = path.resolve(
    __dirname,
    outputConfig.folder || "output"
);

const VALID_WAIT_UNTIL = [
    "domcontentloaded",
    "load",
    "networkidle",
    "commit"
];

if (!VALID_WAIT_UNTIL.includes(crawlerConfig.waitUntil)) {
    throw new Error("Invalid crawler.waitUntil value in config.json");
}

if (
    !Number.isInteger(crawlerConfig.maxEntryLinksPerPage) ||
    crawlerConfig.maxEntryLinksPerPage < 0
) {
    throw new Error(
        "crawler.maxEntryLinksPerPage must be a non-negative integer."
    );
}

// Optional page limit. 0 means unlimited.
const MAX_PAGES = crawlerConfig.maxPages || 0;

if (!Number.isInteger(MAX_PAGES) || MAX_PAGES < 0) {
    throw new Error("crawler.maxPages must be a non-negative integer.");
}

// ======================================
// 2. RESOLVE WEBSITE CONFIGURATION
// ======================================

function resolveWebsiteConfig(site) {
    const startUrl = process.env[site.startUrlEnv];

    if (!startUrl) {
        throw new Error(
            `Missing environment variable: ${site.startUrlEnv}`
        );
    }

    let parsedStartUrl;

    try {
        parsedStartUrl = new URL(startUrl);
    } catch {
        throw new Error(`Invalid URL for website: ${site.name}`);
    }

    if (!["http:", "https:"].includes(parsedStartUrl.protocol)) {
        throw new Error(
            `${site.name} URL must use HTTP or HTTPS.`
        );
    }

    const auth = site.auth || { enabled: false };

    if (typeof auth.enabled !== "boolean") {
        throw new Error(
            `${site.name}: auth.enabled must be true or false.`
        );
    }

    let resolvedAuth = { ...auth };

    if (auth.enabled) {
        const username = process.env[site.usernameEnv];
        const password = process.env[site.passwordEnv];

        if (!username || !password) {
            throw new Error(
                `${site.name}: Missing username or password. ` +
                `Check ${site.usernameEnv} and ${site.passwordEnv} in .env.`
            );
        }

        const requiredSelectors = [
            auth.usernameSelector,
            auth.passwordSelector,
            auth.submitSelector
        ];

        if (
            requiredSelectors.some(
                selector =>
                    typeof selector !== "string" || !selector.trim()
            )
        ) {
            throw new Error(
                `${site.name}: Configure usernameSelector, ` +
                "passwordSelector and submitSelector."
            );
        }

        if (
            auth.successUrl &&
            !auth.successUrl.trim()
        ) {
            throw new Error(
                `${site.name}: successUrl cannot be an empty string.`
            );
        }

        if (
            !auth.successUrl &&
            !auth.successSelector
        ) {
            console.log(
                `${site.name}: Login success will be checked by ` +
                "verifying that the login fields disappear."
            );
        }

        resolvedAuth = {
            ...auth,
            username,
            password
        };
    }

    return {
        ...site,
        startUrl,
        parsedStartUrl,
        auth: resolvedAuth
    };
}

// ======================================
// 3. GENERATE READABLE FOLDER NAMES
// ======================================

function slugify(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .substring(0, 80);
}

function generateFolderName(pageData, pageNumber) {
    const url = new URL(pageData.pageUrl);

    let pageName = slugify(url.pathname);

    if (!pageName) {
        pageName = slugify(pageData.pageTitle) || "home";
    }

    const number = String(pageNumber).padStart(2, "0");

    return `${number}-${pageName}`;
}

// ======================================
// 4. NORMALIZE WEBSITE URLS
// ======================================

function normalizeUrl(url, site) {
    try {
        const parsedUrl = new URL(url);

        // Allow only HTTP and HTTPS.
        if (!["http:", "https:"].includes(parsedUrl.protocol)) {
            return null;
        }

        // Restrict crawling to the starting domain.
        if (
            crawlerConfig.sameDomainOnly &&
            parsedUrl.hostname !== site.parsedStartUrl.hostname
        ) {
            return null;
        }

        // Remove URL fragments.
        parsedUrl.hash = "";

        // Remove query parameters if configured.
        if (crawlerConfig.removeQueryParameters) {
            parsedUrl.search = "";
        }

        // Remove trailing slash except homepage.
        if (parsedUrl.pathname !== "/") {
            parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/, "");
        }

        return parsedUrl.href;

    } catch {
        return null;
    }
}

// ======================================
// 5. EXTRACT WEBPAGE INFORMATION
// ======================================

async function extractPageData(page) {
    return await page.evaluate(() => {

        // Exclude footer and contentinfo elements.
        const getElements = (selector, root = document) =>
            Array.from(root.querySelectorAll(selector))
                .filter(element =>
                    !element.closest("footer, [role='contentinfo']")
                );

        const getContentText = (element) => {
            const content = element.cloneNode(true);

            content
                .querySelectorAll("footer, [role='contentinfo']")
                .forEach(element => element.remove());

            const container = document.createElement("div");

            container.style.position = "fixed";
            container.style.left = "-10000px";

            container.appendChild(content);
            document.body.appendChild(container);

            const text = content.innerText.trim();

            container.remove();

            return text;
        };

        const getText = (selector) => {
            return getElements(selector)
                .map(element => element.innerText.trim())
                .filter(Boolean);
        };

        const getAttributes = (element) => ({
            id: element.id || "",

            className:
                typeof element.className === "string"
                    ? element.className
                    : "",

            ariaLabel: element.getAttribute("aria-label"),

            role: element.getAttribute("role")
        });

        return {

            // 1. Basic page information

            pageTitle: document.title,

            pageUrl: window.location.href,

            pageLanguage: document.documentElement.lang || "",

            pageCharset: document.characterSet,

            pageDescription: document.body
                ? getContentText(document.body)
                : "",

            viewport: {
                width: window.innerWidth,
                height: window.innerHeight
            },

            // 2. SEO information

            seo: {
                title: document.title,

                description:
                    document.querySelector('meta[name="description"]')
                        ?.content || "",

                keywords:
                    document.querySelector('meta[name="keywords"]')
                        ?.content || "",

                author:
                    document.querySelector('meta[name="author"]')
                        ?.content || "",

                canonical:
                    document.querySelector('link[rel="canonical"]')
                        ?.href || "",

                robots:
                    document.querySelector('meta[name="robots"]')
                        ?.content || "",

                openGraph: Array.from(
                    document.querySelectorAll('meta[property^="og:"]')
                ).map(meta => ({
                    property: meta.getAttribute("property"),
                    content: meta.content
                })),

                twitter: Array.from(
                    document.querySelectorAll('meta[name^="twitter:"]')
                ).map(meta => ({
                    name: meta.name,
                    content: meta.content
                }))
            },

            // 3. Headings

            headings: {
                h1: getText("h1"),
                h2: getText("h2"),
                h3: getText("h3"),
                h4: getText("h4"),
                h5: getText("h5"),
                h6: getText("h6")
            },

            // 4. Paragraphs

            paragraphs: getText("p"),

            // 5. Navigation

            navigation: getElements("nav").map(nav => ({
                text: getContentText(nav),

                links: getElements("a", nav).map(link => ({
                    text: link.innerText.trim(),
                    href: link.href,
                    ...getAttributes(link)
                }))
            })),

            // 6. Page sections

            sections: getElements(
                "main section, main article, body > section, body > article"
            ).map((section, index) => ({
                sectionNumber: index + 1,

                tag: section.tagName.toLowerCase(),

                heading: getElements(
                    "h1, h2, h3, h4, h5, h6",
                    section
                )[0]?.innerText.trim() || "",

                text: getContentText(section),

                ...getAttributes(section)
            })),

            // 7. Links

            links: getElements("a").map(link => ({
                text: link.innerText.trim(),
                href: link.href,
                target: link.target,
                title: link.title,
                ...getAttributes(link)
            })),

            // 8. Clickable elements

            clickableElements: getElements(
                "button, [role='button'], [onclick], " +
                "input[type='button'], input[type='submit']"
            ).map(element => ({
                tag: element.tagName.toLowerCase(),

                text:
                    element.innerText?.trim() ||
                    element.value ||
                    "",

                type: element.type || "",
                title: element.title || "",

                ...getAttributes(element)
            })),

            // 9. Forms

            forms: getElements("form").map((form, index) => ({
                formNumber: index + 1,

                action: form.action,

                method: form.method,

                fields: getElements(
                    "input, textarea, select, button",
                    form
                ).map(field => ({
                    tag: field.tagName.toLowerCase(),

                    type: field.type || "",

                    name: field.name || "",

                    id: field.id || "",

                    placeholder: field.placeholder || "",

                    required: field.required,

                    // Do not store password values.
                    value:
                        field.type === "password"
                            ? ""
                            : field.value || "",

                    ...getAttributes(field)
                }))
            })),

            // 10. Input elements

            inputs: getElements(
                "input, textarea, select"
            ).map(input => ({
                tag: input.tagName.toLowerCase(),

                type: input.type || "",

                name: input.name || "",

                id: input.id || "",

                placeholder: input.placeholder || "",

                required: input.required,

                ...getAttributes(input)
            })),

            // 11. Images

            images: getElements("img").map(image => ({
                src: image.src,

                alt: image.alt || "",

                title: image.title || "",

                width: image.naturalWidth,

                height: image.naturalHeight,

                loading: image.loading
            })),

            // 12. Tables

            tables: getElements("table").map((table, index) => ({
                tableNumber: index + 1,

                headers: getElements("thead th", table)
                    .map(th => th.innerText.trim()),

                rows: getElements("tbody tr", table).map(row =>
                    getElements("th, td", row)
                        .map(cell => cell.innerText.trim())
                )
            })),

            // 13. Accessibility

            accessibility: {
                landmarks: getElements(
                    "header, nav, main, aside, [role]"
                ).map(element => ({
                    tag: element.tagName.toLowerCase(),

                    role: element.getAttribute("role"),

                    ariaLabel: element.getAttribute("aria-label")
                })),

                elementsWithoutAlt:
                    getElements("img:not([alt])").length,

                buttonsWithoutLabel:
                    getElements("button").filter(button =>
                        !button.innerText.trim() &&
                        !button.getAttribute("aria-label")
                    ).length
            },

            // 14. Structured data

            structuredData: getElements(
                'script[type="application/ld+json"]'
            ).map(script => {
                try {
                    return JSON.parse(script.textContent);
                } catch {
                    return script.textContent;
                }
            })
        };
    });
}

// ======================================
// 6. LOGIN HANDLING
// ======================================

async function loginIfEnabled(page, site) {

    const auth = site.auth;

    if (!auth.enabled) {
        console.log(`${site.name}: Login not required.`);
        return;
    }

    console.log(`${site.name}: Opening login page...`);

    // Admin and Client URLs directly open their login forms.
    const response = await page.goto(site.startUrl, {
        waitUntil: crawlerConfig.waitUntil,
        timeout: crawlerConfig.timeout
    });

    if (!response || response.status() >= 400) {
        throw new Error(
            `${site.name}: Unable to load the login page.`
        );
    }

    console.log(`${site.name}: Entering login credentials...`);

    await page.locator(auth.usernameSelector).fill(auth.username);

    await page.locator(auth.passwordSelector).fill(auth.password);

    await page.locator(auth.submitSelector).click();

    // Option 1: Wait for a configured success URL.
    if (auth.successUrl) {
        await page.waitForURL(auth.successUrl, {
            timeout: crawlerConfig.timeout
        });
    }

    // Option 2: Wait for a configured element after login.
    else if (auth.successSelector) {
        await page.locator(auth.successSelector).waitFor({
            state: "visible",
            timeout: crawlerConfig.timeout
        });
    }

    // Option 3: Check that the login form disappears.
    else {
        await page.locator(auth.usernameSelector).waitFor({
            state: "hidden",
            timeout: crawlerConfig.timeout
        });

        await page.locator(auth.passwordSelector).waitFor({
            state: "hidden",
            timeout: crawlerConfig.timeout
        });
    }

    console.log(`${site.name}: Login successful.`);
}

// ======================================
// 7. CRAWL ONE WEBSITE
// ======================================

function isLogoutLink(link) {
    const text = [
        link.text,
        link.label,
        link.href,
        link.url,
        link.title,
        link.ariaLabel
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

    return (
        /\b(logout|log out|signout|sign out|logoff|log off|signoff|sign off)\b/i.test(text) ||
        /\/(logout|log-out|signout|sign-out|logoff|log-off|signoff|sign-off)(\/|$|\?)/i.test(text)
    );
}

function isCoveredByTablePage(url, tablePageUrls) {
    const candidate = new URL(url);

    for (const tablePageUrl of tablePageUrls) {
        const tablePage = new URL(tablePageUrl);

        if (
            candidate.origin === tablePage.origin &&
            tablePage.pathname !== "/" &&
            candidate.pathname.startsWith(`${tablePage.pathname}/`)
        ) {
            return true;
        }
    }

    return false;
}

async function crawlWebsite(siteConfig) {

    // Resolve this website's URL and credentials.
    const site = resolveWebsiteConfig(siteConfig);

    console.log("\n================================");
    console.log("STARTING WEBSITE CRAWL");
    console.log("Website:", site.name);
    console.log("URL:", site.startUrl);
    console.log("================================\n");

    // Separate storage for every website.
    const OUTPUT_FOLDER = path.join(
        OUTPUT_ROOT,
        site.id
    );

    const PAGES_FOLDER = path.join(
        OUTPUT_FOLDER,
        "pages"
    );

    // Separate crawler state for every website.
    const visitedUrls = new Set();

    const urlQueue = [site.startUrl];
    const queuedUrls = new Set([
        normalizeUrl(site.startUrl, site)
    ]);
    const tablePageUrls = new Set();

    const websiteData = {
        websiteName: site.name,

        website: site.startUrl,

        crawledAt: new Date().toISOString(),

        totalPages: 0,

        failedPages: [],

        pages: []
    };

    const browser = await chromium.launch({
        headless: browserConfig.headless
    });

    const page = await browser.newPage({
        viewport: {
            width: browserConfig.width,
            height: browserConfig.height
        }
    });

    try {

        // Login if required.
        await loginIfEnabled(page, site);

        // Create output directories automatically.
        fs.mkdirSync(OUTPUT_FOLDER, {
            recursive: true
        });

        if (
            outputConfig.saveIndividualJson ||
            outputConfig.saveScreenshots
        ) {
            fs.mkdirSync(PAGES_FOLDER, {
                recursive: true
            });
        }

        // ======================================
        // CRAWL PAGES
        // ======================================

        while (urlQueue.length > 0) {

            urlQueue.sort((left, right) =>
                new URL(left).pathname.split("/").filter(Boolean).length -
                new URL(right).pathname.split("/").filter(Boolean).length
            );

            // Stop when the configured page limit is reached.
            if (
                MAX_PAGES > 0 &&
                websiteData.totalPages >= MAX_PAGES
            ) {
                console.log(
                    `${site.name}: Maximum page limit reached.`
                );
                break;
            }

            const currentUrl = urlQueue.shift();

            const normalizedUrl = normalizeUrl(
                currentUrl,
                site
            );
            queuedUrls.delete(normalizedUrl);

            // Skip invalid or already visited URLs.
            if (
                !normalizedUrl ||
                visitedUrls.has(normalizedUrl)
            ) {
                continue;
            }

            visitedUrls.add(normalizedUrl);

            console.log("\nCrawling:", normalizedUrl);

            try {

                // Open webpage.
                const response = await page.goto(normalizedUrl, {
                    waitUntil: crawlerConfig.waitUntil,
                    timeout: crawlerConfig.timeout
                });

                // Wait for dynamic content.
                await page.waitForTimeout(
                    crawlerConfig.waitTime
                );

                // Check HTTP response.
                if (!response || response.status() >= 400) {

                    websiteData.failedPages.push({
                        url: normalizedUrl,

                        status: response
                            ? response.status()
                            : null,

                        error: "Page returned an unsuccessful response"
                    });

                    continue;
                }

                // Check final redirected URL.
                const finalUrl = new URL(page.url());

                if (
                    crawlerConfig.sameDomainOnly &&
                    finalUrl.hostname !== site.parsedStartUrl.hostname
                ) {
                    websiteData.failedPages.push({
                        url: normalizedUrl,

                        status: response.status(),

                        error:
                            "Page redirected outside the allowed domain."
                    });

                    continue;
                }

                const landedUrl = normalizeUrl(page.url(), site);
                if (landedUrl) {
                    visitedUrls.add(landedUrl);
                }

                // ======================================
                // EXTRACT PAGE INFORMATION
                // ======================================

                const pageData = await extractPageData(page);

                pageData.httpStatus = response.status();

                pageData.crawledAt = new Date().toISOString();

                const tableRows = await page.locator("table").evaluateAll(
                    tables => tables
                        .filter(table =>
                            !table.closest("footer, [role='contentinfo']")
                        )
                        .map((table, tableIndex) => ({
                            tableIndex,
                            allLinkHrefs: Array.from(
                                table.querySelectorAll("a[href]")
                            ).map(anchor => anchor.href),
                            rows: Array.from(
                                table.querySelectorAll("tbody tr")
                            )
                                .map((row, rowIndex) => ({
                                    rowIndex,
                                    cells: Array.from(
                                        row.querySelectorAll("th, td")
                                    ).map(cell => cell.innerText.trim()),
                                    uniqueValue:
                                        row.getAttribute("data-id") ||
                                        row.innerText.trim().replace(/\s+/g, " ") ||
                                        `row-${rowIndex + 1}`,
                                    links: Array.from(
                                        row.querySelectorAll("a[href]")
                                    ).map(anchor => ({
                                        text: anchor.innerText.trim(),
                                        href: anchor.href,
                                        title: anchor.title,
                                        ariaLabel: anchor.getAttribute("aria-label")
                                    }))
                                }))
                                .filter(row =>
                                    row.cells.some(Boolean) ||
                                    row.links.length > 0
                                )
                        }))
                );

                const selectedTableRows = [];

                for (const table of tableRows) {
                    if (table.rows.length === 0) {
                        continue;
                    }

                    const selectedRow =
                        table.rows[
                            Math.floor(Math.random() * table.rows.length)
                        ];

                    if (pageData.tables[table.tableIndex]) {
                        pageData.tables[table.tableIndex].rows = [
                            selectedRow.cells
                        ];
                    }

                    selectedTableRows.push({
                        tableIndex: table.tableIndex,
                        rowIndex: selectedRow.rowIndex,
                        uniqueValue: selectedRow.uniqueValue,
                        links: selectedRow.links
                    });
                }

                const tableLinkHrefs = new Set(
                    tableRows.flatMap(table => table.allLinkHrefs)
                );
                const selectedTableLinkHrefs = new Set(
                    selectedTableRows.flatMap(row =>
                        row.links.map(link => link.href)
                    )
                );
                pageData.links = pageData.links.filter(link =>
                    !tableLinkHrefs.has(link.href) ||
                    selectedTableLinkHrefs.has(link.href)
                );

                // Generate page folder name.
                const pageNumber = websiteData.pages.length + 1;

                const folderName = generateFolderName(
                    pageData,
                    pageNumber
                );

                const pageFolder = path.join(
                    PAGES_FOLDER,
                    folderName
                );

                if (
                    outputConfig.saveIndividualJson ||
                    outputConfig.saveScreenshots
                ) {
                    fs.mkdirSync(pageFolder, {
                        recursive: true
                    });
                }

                // ======================================
                // SAVE SCREENSHOT
                // ======================================

                let screenshotRelativePath = null;

                if (outputConfig.saveScreenshots) {

                    const screenshotPath = path.join(
                        pageFolder,
                        "screenshot.png"
                    );

                    try {

                        await page.screenshot({
                            path: screenshotPath,

                            fullPage:
                                outputConfig.fullPageScreenshot,

                            animations: "disabled"
                        });

                        pageData.screenshot = "screenshot.png";

                        screenshotRelativePath =
                            `pages/${folderName}/screenshot.png`;

                        console.log(
                            "Screenshot saved:",
                            folderName
                        );

                    } catch (screenshotError) {

                        pageData.screenshot = null;

                        pageData.screenshotError =
                            screenshotError.message;
                    }

                } else {
                    pageData.screenshot = null;
                }

                // ======================================
                // SAVE INDIVIDUAL JSON
                // ======================================

                let jsonRelativePath = null;

                if (outputConfig.saveIndividualJson) {

                    const jsonPath = path.join(
                        pageFolder,
                        "page.json"
                    );

                    fs.writeFileSync(
                        jsonPath,
                        JSON.stringify(pageData, null, 2),
                        "utf8"
                    );

                    jsonRelativePath =
                        `pages/${folderName}/page.json`;
                }

                // ======================================
                // ADD PAGE TO SUMMARY
                // ======================================

                websiteData.pages.push({
                    pageNumber,

                    pageTitle: pageData.pageTitle,

                    pageUrl: pageData.pageUrl,

                    httpStatus: pageData.httpStatus,

                    folder: folderName,

                    json: jsonRelativePath,

                    screenshot: screenshotRelativePath
                });

                websiteData.totalPages =
                    websiteData.pages.length;

                console.log(
                    "Completed:",
                    pageData.pageTitle
                );

                // ======================================
                // DISCOVER INTERNAL LINKS
                // ======================================

                const selectedRowUrls = new Set();

                for (const selectedRow of selectedTableRows) {
                    console.log(
                        `Selected random row ${selectedRow.rowIndex + 1} ` +
                        `from table ${selectedRow.tableIndex + 1}:`,
                        selectedRow.uniqueValue
                    );

                    for (const link of selectedRow.links) {
                        if (isLogoutLink(link)) {
                            continue;
                        }

                        const discoveredUrl = normalizeUrl(link.href, site);
                        if (discoveredUrl) {
                            selectedRowUrls.add(discoveredUrl);
                        }
                    }
                }

                const nonTableLinks = await page.locator("a[href]").evaluateAll(
                    anchors => anchors
                        .filter(anchor => !anchor.closest("table"))
                        .map(anchor => ({
                            text: anchor.innerText.trim(),
                            href: anchor.href,
                            title: anchor.title,
                            ariaLabel: anchor.getAttribute("aria-label")
                        }))
                );

                // A table endpoint covers its deeper record URLs.
                const hasTableRows = selectedTableRows.length > 0;
                if (hasTableRows && landedUrl) {
                    tablePageUrls.add(landedUrl);

                    for (const queuedUrl of Array.from(queuedUrls)) {
                        if (isCoveredByTablePage(queuedUrl, tablePageUrls)) {
                            queuedUrls.delete(queuedUrl);
                        }
                    }

                    for (let index = urlQueue.length - 1; index >= 0; index--) {
                        if (isCoveredByTablePage(urlQueue[index], tablePageUrls)) {
                            urlQueue.splice(index, 1);
                        }
                    }
                }

                const discoveredUrls = new Set(selectedRowUrls);

                for (const link of nonTableLinks) {
                    if (isLogoutLink(link)) {
                        continue;
                    }

                    const discoveredUrl = normalizeUrl(link.href, site);
                    if (discoveredUrl) {
                        discoveredUrls.add(discoveredUrl);
                    }
                }

                for (const discoveredUrl of discoveredUrls) {
                    if (
                        !visitedUrls.has(discoveredUrl) &&
                        !queuedUrls.has(discoveredUrl) &&
                        !isCoveredByTablePage(discoveredUrl, tablePageUrls)
                    ) {
                        urlQueue.push(discoveredUrl);
                        queuedUrls.add(discoveredUrl);
                    }
                }

                await page.waitForTimeout(
                    crawlerConfig.delayBetweenPages
                );

            } catch (error) {

                console.log(
                    "Error crawling:",
                    normalizedUrl
                );

                websiteData.failedPages.push({
                    url: normalizedUrl,
                    error: error.message
                });
            }
        }

        // ======================================
        // 8. SAVE CRAWL SUMMARY
        // ======================================

        if (outputConfig.saveSummary) {

            const summaryPath = path.join(
                OUTPUT_FOLDER,
                "crawl-summary.json"
            );

            fs.writeFileSync(
                summaryPath,
                JSON.stringify(websiteData, null, 2),
                "utf8"
            );

            console.log(
                "\nSummary JSON:",
                summaryPath
            );
        }

        // ======================================
        // 9. FINAL REPORT
        // ======================================

        console.log("\n--------------------------------");

        console.log("Website crawling completed!");

        console.log("Website:", site.name);

        console.log(
            "Total successful pages:",
            websiteData.totalPages
        );

        console.log(
            "Failed pages:",
            websiteData.failedPages.length
        );

        console.log(
            "Pages remaining in queue:",
            urlQueue.length
        );

        console.log("Output folder:", OUTPUT_FOLDER);

        console.log("--------------------------------\n");

    } finally {

        await browser.close();
    }
}

// ======================================
// 10. RUN ALL WEBSITES
// ======================================

async function runAllWebsites() {

    const results = [];

    for (const site of config.websites) {

        try {

            await crawlWebsite(site);

            results.push({
                website: site.name,
                status: "Completed"
            });

        } catch (error) {

            console.error(
                `\n${site.name} crawling failed:`,
                error.message
            );

            results.push({
                website: site.name,
                status: "Failed",
                error: error.message
            });

            // Continue with the remaining websites.
        }
    }

    // ======================================
    // FINAL OVERALL REPORT
    // ======================================

    console.log("\n================================");
    console.log("ALL WEBSITE CRAWLS FINISHED");
    console.log("================================");

    console.table(results);
}

// ======================================
// 11. EXECUTE CRAWLER
// ======================================

const selectedWebsite = process.argv[2];

if (selectedWebsite) {
  const website = config.websites.find(
    site => site.id.toLowerCase() === selectedWebsite.toLowerCase()
  );

  if (!website) {
    console.log(`Website "${selectedWebsite}" not found.`);
    console.log(
      "Available websites:",
      config.websites.map(site => site.id).join(", ")
    );
    process.exit(1);
  }

  crawlWebsite(resolveWebsiteConfig(website));
} else {
  runAllWebsites();
}