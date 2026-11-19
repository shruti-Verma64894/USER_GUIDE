const { chromium } = require("playwright");

const fs = require("fs");

const path = require("path");

// ======================================

// 1. READ CONFIGURATION

// ======================================

const config = require("./config.json");

const START_URL = config.website.startUrl;
const MAX_ENTRY_LINKS_PER_PAGE = config.crawler.maxEntryLinksPerPage;
const auth = config.auth || { enabled: false };

const OUTPUT_FOLDER = path.resolve(
    __dirname,
    process.env.CRAWL_OUTPUT || config.output.folder
);

const PAGES_FOLDER = path.join(

    OUTPUT_FOLDER,

    "pages"

);

// Validate configuration

if (!START_URL) {

    throw new Error("Invalid website URL in config.json");

}

if (
    !Number.isInteger(MAX_ENTRY_LINKS_PER_PAGE) ||
    MAX_ENTRY_LINKS_PER_PAGE < 0
) {

    throw new Error("crawler.maxEntryLinksPerPage must be a non-negative integer in config.json");

}

const parsedStartUrl = new URL(START_URL);

if (!["http:", "https:"].includes(parsedStartUrl.protocol)) {

    throw new Error("startUrl must use HTTP or HTTPS");

}

if (!["domcontentloaded", "load", "networkidle", "commit"].includes(config.crawler.waitUntil)) {

    throw new Error("Invalid waitUntil value in config.json");

}

if (typeof auth.enabled !== "boolean") {

    throw new Error("auth.enabled must be true or false in config.json");

}

if (auth.enabled) {

    const requiredAuthSettings = [
        auth.loginUrl,
        auth.usernameSelector,
        auth.passwordSelector,
        auth.submitSelector
    ];

    if (requiredAuthSettings.some(value =>
        typeof value !== "string" || !value.trim()
    )) {

        throw new Error("All auth login settings must be configured when auth.enabled is true");

    }

    if (
        !(typeof auth.successUrl === "string" && auth.successUrl.trim()) &&
        !(typeof auth.successSelector === "string" && auth.successSelector.trim())
    ) {

        throw new Error("Configure auth.successUrl or auth.successSelector when auth.enabled is true");

    }

    const parsedLoginUrl = new URL(auth.loginUrl);

    if (!["http:", "https:"].includes(parsedLoginUrl.protocol)) {

        throw new Error("auth.loginUrl must use HTTP or HTTPS");

    }

    if (auth.successUrl) {

        const successUrl = auth.successUrl.replace(/\/\*\*$/, "/");
        const parsedSuccessUrl = new URL(successUrl);

        if (!["http:", "https:"].includes(parsedSuccessUrl.protocol)) {

            throw new Error("auth.successUrl must use HTTP or HTTPS");

        }

    }

    if (!process.env.CRAWLER_USERNAME || !process.env.CRAWLER_PASSWORD) {

        throw new Error("Set CRAWLER_USERNAME and CRAWLER_PASSWORD environment variables when auth.enabled is true");

    }

}

// ======================================

// 2. CRAWLER STORAGE

// ======================================

const visitedUrls = new Set();

const urlQueue = [START_URL];

const websiteData = {

    websiteName: config.website.name,

    website: START_URL,

    crawledAt: new Date().toISOString(),

    totalPages: 0,

    failedPages: [],

    pages: []

};

// ======================================

// 3. GENERATE READABLE FOLDER NAMES

// ======================================

function slugify(text) {

    return text

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

function normalizeUrl(url) {

    try {

        const parsedUrl = new URL(url);

        // Allow only HTTP and HTTPS

        if (!["http:", "https:"].includes(parsedUrl.protocol)) {

            return null;

        }

        // Restrict crawling to the starting domain if enabled

        if (

            config.crawler.sameDomainOnly &&

            parsedUrl.hostname !== parsedStartUrl.hostname

        ) {

            return null;

        }

        // Remove URL fragments

        parsedUrl.hash = "";

        // Remove query parameters if configured

        if (config.crawler.removeQueryParameters) {

            parsedUrl.search = "";

        }

        // Remove trailing slash except homepage

        if (parsedUrl.pathname !== "/") {

            parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/, "");

        }

        return parsedUrl.href;

    } catch (error) {

        return null;

    }

}

// ======================================

// 5. EXTRACT WEBPAGE INFORMATION

// ======================================

async function extractPageData(page) {

    return await page.evaluate(() => {

        const getElements = (selector, root = document) =>
            Array.from(root.querySelectorAll(selector))
                .filter(element => !element.closest("footer, [role='contentinfo']"));

        const getContentText = (element) => {
            const content = element.cloneNode(true);
            content.querySelectorAll("footer, [role='contentinfo']")
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

        // Extract text from elements
        const getText = (selector) => {

            return getElements(selector)
                .map(element => element.innerText.trim())
                .filter(Boolean);

        };

        // Extract common attributes

        const getAttributes = (element) => ({

            id: element.id || "",

            className: typeof element.className === "string"

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
                "button, [role='button'], [onclick], input[type='button'], input[type='submit']"
            ).map(element => ({

                tag: element.tagName.toLowerCase(),

                text: element.innerText?.trim() || element.value || "",

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

                    // Do not store password values

                    value: field.type === "password"

                        ? ""

                        : field.value || "",

                    ...getAttributes(field)

                }))

            })),

            // 10. Input elements

            inputs: getElements("input, textarea, select").map(input => ({

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


            // 14. Accessibility

            accessibility: {

                landmarks: getElements(
                    "header, nav, main, aside, [role]"
                ).map(element => ({

                    tag: element.tagName.toLowerCase(),

                    role: element.getAttribute("role"),

                    ariaLabel: element.getAttribute("aria-label")

                })),

                elementsWithoutAlt: getElements("img:not([alt])").length,

                buttonsWithoutLabel: getElements("button").filter(button =>

                    !button.innerText.trim() &&

                    !button.getAttribute("aria-label")

                ).length

            },

            // 15. Structured data

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

async function loginIfEnabled(page) {

    if (!auth.enabled) {

        return;

    }

    const response = await page.goto(auth.loginUrl, {

        waitUntil: config.crawler.waitUntil,

        timeout: config.crawler.timeout

    });

    if (!response || response.status() >= 400) {

        throw new Error("Unable to load the configured login page");

    }

    await page.locator(auth.usernameSelector)
        .fill(process.env.CRAWLER_USERNAME);

    await page.locator(auth.passwordSelector)
        .fill(process.env.CRAWLER_PASSWORD);

    await page.locator(auth.submitSelector).click();

    if (auth.successUrl) {

        await page.waitForURL(auth.successUrl, {

            timeout: config.crawler.timeout

        });

    } else {

        await page.locator(auth.successSelector).waitFor({

            state: "visible",

            timeout: config.crawler.timeout

        });

    }

}

// ======================================

// 6. MAIN CRAWLER

// ======================================

async function crawlWebsite() {

    const browser = await chromium.launch({

        headless: config.browser.headless

    });

    const page = await browser.newPage({

        viewport: {

            width: config.browser.width,

            height: config.browser.height

        }

    });

    try {

        await loginIfEnabled(page);

        // Create output directory

        fs.mkdirSync(OUTPUT_FOLDER, {

            recursive: true

        });

        if (

            config.output.saveIndividualJson ||

            config.output.saveScreenshots

        ) {

            fs.mkdirSync(PAGES_FOLDER, {

                recursive: true

            });

        }

        // Crawl pages

        while (urlQueue.length > 0) {

            const currentUrl = urlQueue.shift();

            const normalizedUrl = normalizeUrl(currentUrl);

            // Skip invalid or visited URLs

            if (

                !normalizedUrl ||

                visitedUrls.has(normalizedUrl)

            ) {

                continue;

            }

            visitedUrls.add(normalizedUrl);

            console.log("Crawling:", normalizedUrl);

            try {

                // Open webpage

                const response = await page.goto(normalizedUrl, {

                    waitUntil: config.crawler.waitUntil,

                    timeout: config.crawler.timeout

                });

                // Wait for dynamic content

                await page.waitForTimeout(

                    config.crawler.waitTime

                );

                // Check HTTP response

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

                const finalUrl = new URL(page.url());

                if (
                    config.crawler.sameDomainOnly &&
                    finalUrl.hostname !== parsedStartUrl.hostname
                ) {

                    websiteData.failedPages.push({

                        url: normalizedUrl,

                        status: response.status(),

                        error: "Page redirected outside the allowed domain and was skipped"

                    });

                    continue;

                }

                // Extract webpage data

                const pageData = await extractPageData(page);

                pageData.httpStatus = response.status();

                pageData.crawledAt = new Date().toISOString();

                // Generate page folder name

                const pageNumber = websiteData.pages.length + 1;

                const folderName = generateFolderName(

                    pageData,

                    pageNumber

                );

                const pageFolder = path.join(

                    PAGES_FOLDER,

                    folderName

                );

                // Create individual page folder

                if (

                    config.output.saveIndividualJson ||

                    config.output.saveScreenshots

                ) {

                    fs.mkdirSync(pageFolder, {

                        recursive: true

                    });

                }

                // Screenshot

                let screenshotRelativePath = null;

                if (config.output.saveScreenshots) {

                    const screenshotPath = path.join(

                        pageFolder,

                        "screenshot.png"

                    );

                    try {

                        await page.screenshot({

                            path: screenshotPath,

                            fullPage: config.output.fullPageScreenshot,

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

                // Save individual JSON

                let jsonRelativePath = null;

                if (config.output.saveIndividualJson) {

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

                // Add page to summary

                websiteData.pages.push({

                    pageNumber,

                    pageTitle: pageData.pageTitle,

                    pageUrl: pageData.pageUrl,

                    httpStatus: pageData.httpStatus,

                    folder: folderName,

                    json: jsonRelativePath,

                    screenshot: screenshotRelativePath

                });

                websiteData.totalPages = websiteData.pages.length;

                console.log(

                    "Completed:",

                    pageData.pageTitle

                );

                // Discover internal links

                const tableEntryUrls = new Set(
                    (await page.locator("table a[href]").evaluateAll(anchors =>
                        anchors.map(anchor => anchor.href)
                    ))
                        .map(normalizeUrl)
                        .filter(Boolean)
                );
                const dataEntryGroups = new Map();

                for (const link of pageData.links) {

                    const discoveredUrl = normalizeUrl(link.href);

                    if (!discoveredUrl) {

                        continue;

                    }

                    const segments = new URL(discoveredUrl).pathname
                        .split("/")
                        .filter(Boolean);

                    if (segments.length >= 3 && segments[0].toLowerCase() === "data") {

                        const groupKey = `/data/${segments[1].toLowerCase()}`;

                        if (!dataEntryGroups.has(groupKey)) {

                            dataEntryGroups.set(groupKey, new Set());

                        }

                        dataEntryGroups.get(groupKey).add(discoveredUrl);

                    }

                }

                const entryLinkUrls = new Set(tableEntryUrls);

                for (const urls of dataEntryGroups.values()) {

                    if (urls.size > 1) {

                        for (const url of urls) {

                            entryLinkUrls.add(url);

                        }

                    }

                }

                let queuedEntryLinks = 0;

                for (const link of pageData.links) {

                    const discoveredUrl = normalizeUrl(link.href);

                    if (!discoveredUrl) {

                        continue;

                    }

                    const isEntryLink = entryLinkUrls.has(discoveredUrl);

                    if (
                        isEntryLink &&
                        queuedEntryLinks >= MAX_ENTRY_LINKS_PER_PAGE
                    ) {

                        continue;

                    }

                    if (
                        !visitedUrls.has(discoveredUrl) &&
                        !urlQueue.includes(discoveredUrl)
                    ) {

                        urlQueue.push(discoveredUrl);

                        if (isEntryLink) {

                            queuedEntryLinks += 1;

                        }

                    }
                }

                // Delay between pages

                await page.waitForTimeout(

                    config.crawler.delayBetweenPages

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

        // 7. SAVE CRAWL SUMMARY

        // ======================================

        if (config.output.saveSummary) {

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

                "Summary JSON:",

                summaryPath

            );

        }

        // ======================================

        // 8. FINAL REPORT

        // ======================================

        console.log("--------------------------------");

        console.log("Website crawling completed!");

        console.log(

            "Website:",

            config.website.name

        );

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

        console.log(

            "Output folder:",

            OUTPUT_FOLDER

        );

        console.log("--------------------------------");

    } finally {

        await browser.close();

    }

}

// ======================================

// 9. EXECUTE CRAWLER

// ======================================

crawlWebsite()
    .then(() => {
        console.log("Crawler finished successfully!");
    })
    .catch(error => {
        console.error("Crawler failed:", error);
        process.exitCode = 1;
    });