
const path = require("path");

const {
    normalizeUrl,
    getDataDetailEndpoint,
    getClientIdDetailEndpoint,
    isWageDeterminationDetailUrl,
    isLogoutLink,
    isLoginLink
} = require("./urlManager");
const { extractPageData } = require("./dataExtractor");
const {
    waitForPageReady,
    saveScreenshot
} = require("./screenshot");
const { savePageOutput } = require("./outputManager");
const {
    ADMIN_CHROME_SELECTORS,
    closeAdminProductMenuIfOpen
} = require("../sites/admin/adminChrome");

const CLIENT_FILTER_PAGE_PATHS = new Set([
    "/find-and-nurture",
    "/procurement-notices",
    "/sam.gov-leads",
    "/recompetes"
]);

const DATA_DETAIL_SIDEBARS = [
    "aside",
    "[role='complementary']",
    "[class*='sidebar' i]",
    "[id*='sidebar' i]",
    "[aria-label*='sidebar' i]",
    "[class*='side-nav' i]",
    "[class*='sidenav' i]",
    "nav[aria-orientation='vertical']",
    "[role='tablist'][aria-orientation='vertical']"
].join(", ");

const DATA_DETAIL_SIDEBAR_CONTROLS = [
    "button",
    "[role='button']",
    "[role='tab']",
    "[role='menuitem']",
    "a[href]",
    "[onclick]",
    "[data-toggle='tab']",
    "[data-bs-toggle='tab']",
    "input[type='button']",
    "summary",
    "[tabindex]:not([tabindex='-1'])"
].join(", ");

function isSupportedDataDetailSidebarPage(site, url) {
    let parsedUrl;
    try {
        parsedUrl = new URL(url);
    } catch {
        return false;
    }

    const expectedHost = site.id === "public"
        ? "www.nlproducts.net"
        : site.id === "client"
            ? "asponte-stg.nlproducts.net"
            : null;

    return (
        expectedHost !== null &&
        parsedUrl.hostname === expectedHost &&
        getDataDetailEndpoint(parsedUrl.href) !== null
    );
}

function getSidebarControlLabel(control, index) {
    return (
        control.text ||
        control.ariaLabel ||
        control.title ||
        `sidebar-control-${index + 1}`
    );
}

async function crawlDataDetailSidebarStates({
    page,
    site,
    crawlerConfig,
    outputConfig,
    outputRoot,
    pageUrl,
    pageCount,
    maxPages
}) {
    if (!isSupportedDataDetailSidebarPage(site, pageUrl)) {
        return pageCount;
    }

    const sidebars = page.locator(DATA_DETAIL_SIDEBARS);
    const sidebarCount = await sidebars.count();
    const controlsToClick = [];
    const seenControls = new Set();

    for (let sidebarIndex = 0; sidebarIndex < sidebarCount; sidebarIndex++) {
        const controls = sidebars.nth(sidebarIndex)
            .locator(DATA_DETAIL_SIDEBAR_CONTROLS);
        const controlCount = await controls.count();

        for (let controlIndex = 0; controlIndex < controlCount; controlIndex++) {
            const control = controls.nth(controlIndex);
            if (!await control.isVisible()) {
                continue;
            }

            const details = await control.evaluate((element, currentUrl) => {
                const tagName = element.tagName.toLowerCase();
                const text = (element.innerText || "").replace(/\s+/g, " ").trim();
                const ariaLabel = element.getAttribute("aria-label") || "";
                const title = element.getAttribute("title") || "";
                const href = element.getAttribute("href");
                const buttonType = element.getAttribute("type") || "";

                if (
                    (tagName === "button" && buttonType.toLowerCase() === "submit") ||
                    element.closest("form") &&
                        tagName === "input" &&
                        element.type === "submit"
                ) {
                    return null;
                }

                if (tagName === "a" && href) {
                    if (
                        !href.startsWith("#") &&
                        href !== "#" &&
                        !/^javascript:/i.test(href)
                    ) {
                        let target;
                        try {
                            target = new URL(href, window.location.href);
                        } catch {
                            return null;
                        }

                        const current = new URL(currentUrl);
                        if (
                            target.origin !== current.origin ||
                            target.pathname !== current.pathname ||
                            target.search !== current.search
                        ) {
                            return null;
                        }
                    }
                }

                const className = typeof element.className === "string"
                    ? element.className
                    : "";
                const parentClassName =
                    typeof element.parentElement?.className === "string"
                        ? element.parentElement.className
                        : "";
                const isActive =
                    element.getAttribute("aria-selected") === "true" ||
                    element.getAttribute("aria-current") === "page" ||
                    element.getAttribute("aria-pressed") === "true" ||
                    /\b(active|selected|current)\b/i.test(className) ||
                    /\b(active|selected|current)\b/i.test(parentClassName);

                return {
                    tagName,
                    text,
                    ariaLabel,
                    title,
                    href,
                    className,
                    isActive
                };
            }, pageUrl);

            if (!details || details.isActive) {
                continue;
            }

            const key = [
                details.tagName,
                details.href || "",
                details.ariaLabel,
                details.title,
                details.text,
                details.className
            ].join("|");
            if (seenControls.has(key)) {
                continue;
            }
            seenControls.add(key);
            controlsToClick.push({
                sidebarIndex,
                controlIndex,
                label: getSidebarControlLabel(details, controlsToClick.length)
            });
        }
    }

    for (const controlInfo of controlsToClick) {
        if (maxPages > 0 && pageCount >= maxPages) {
            break;
        }

        const control = sidebars
            .nth(controlInfo.sidebarIndex)
            .locator(DATA_DETAIL_SIDEBAR_CONTROLS)
            .nth(controlInfo.controlIndex);
        if (!await control.isVisible()) {
            continue;
        }

        await control.click();

        const currentUrl = new URL(page.url());
        const originalUrl = new URL(pageUrl);
        if (
            currentUrl.origin !== originalUrl.origin ||
            currentUrl.pathname !== originalUrl.pathname ||
            currentUrl.search !== originalUrl.search
        ) {
            await page.goto(pageUrl, {
                waitUntil: crawlerConfig.waitUntil,
                timeout: crawlerConfig.timeout
            });
            await waitForPageReady(page);
            continue;
        }

        if (currentUrl.hash !== originalUrl.hash) {
            await page.evaluate(url => {
                window.history.replaceState(
                    window.history.state,
                    "",
                    url
                );
            }, pageUrl);
        }

        if (crawlerConfig.waitTime > 0) {
            await page.waitForTimeout(crawlerConfig.waitTime);
        }
        await waitForPageReady(page);

        const pageData = await extractPageData(page);
        pageData.captureLabel = `data-sidebar-${controlInfo.label
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")}`;
        pageData.pageInfo.url = pageUrl;

        const outputPaths = savePageOutput({
            outputRoot,
            siteId: site.id,
            pageNumber: pageCount + 1,
            pageData
        });
        if (outputConfig.saveScreenshots) {
            await saveScreenshot(page, outputPaths.screenshotPath);
        }

        pageCount++;
        console.log(
            `${site.name}: Sidebar state ${pageCount} saved successfully.`
        );
    }

    return pageCount;
}

async function waitForClientFilterPageReady(page, site, pageUrl) {
    if (site.id !== "client") {
        return;
    }

    const pathname = new URL(pageUrl).pathname;

    if (!CLIENT_FILTER_PAGE_PATHS.has(pathname)) {
        return;
    }

    console.log("Waiting for Client filter data to finish loading...");

    await page.waitForFunction(() => {
        const filterContainer = document.querySelector(
            ".main-section-area.find-nurture " +
            ".tab-pane.active.show #filter-container"
        );

        if (!filterContainer) {
            return false;
        }

        const rows = Array.from(
            filterContainer.querySelectorAll(".filter-row")
        );

        if (rows.length === 0) {
            return false;
        }

        const hasVisibleControl = row =>
            Array.from(
                row.querySelectorAll(
                    "input, select, .select2-container"
                )
            ).some(control => {
                const style = window.getComputedStyle(control);

                return (
                    style.display !== "none" &&
                    style.visibility !== "hidden" &&
                    control.getClientRects().length > 0
                );
            });

        return rows.every(hasVisibleControl);
    }, {
        timeout: 45000
    });

    console.log("Client filter data loaded successfully.");
}

async function crawlWebsite({
    page,
    site,
    crawlerConfig,
    outputConfig
}) {
    console.log("\n======================================");
    console.log(`STARTING CRAWL: ${site.name}`);
    console.log("======================================\n");

    // Resolve the output directory.
    const outputRoot = path.resolve(
        process.cwd(),
        outputConfig.folder || "output"
    );

    // Starting URL for this website.
    const startUrl = normalizeUrl(
        site.crawlStartUrl,
        site,
        crawlerConfig
    );

    if (!startUrl) {
        throw new Error(`${site.name}: Invalid crawling start URL.`);
    }

    // Do not allow the crawler to revisit the login page.
    const loginUrl = site.loginUrl
        ? normalizeUrl(site.loginUrl, site, crawlerConfig)
        : null;

    // URLs waiting to be crawled.
    const queue = [startUrl];

    // URLs already added to the queue.
    const queuedUrls = new Set([startUrl]);

    // URLs already visited.
    const visitedUrls = new Set();

    // Keep at most one queued or successfully crawled detail page per endpoint.
    const crawledDetailEndpoints = new Set();
    const queuedDetailEndpoints = new Map();
    const startDetailEndpoint = getDataDetailEndpoint(startUrl);
    const crawledClientIdEndpoints = new Set();
    const queuedClientIdEndpoints = new Map();
    const startClientIdEndpoint = site.id === "client"
        ? getClientIdDetailEndpoint(startUrl)
        : null;
    // Wage determinations share one detail-page allowance across all IDs.
    let crawledWageDeterminationDetail = false;
    let queuedWageDeterminationDetailUrl = null;

    if (startDetailEndpoint) {
        queuedDetailEndpoints.set(startDetailEndpoint, startUrl);
    }

    if (startClientIdEndpoint) {
        queuedClientIdEndpoints.set(startClientIdEndpoint, startUrl);
    }

    if (isWageDeterminationDetailUrl(startUrl)) {
        queuedWageDeterminationDetailUrl = startUrl;
    }

    let pageCount = 0;

    const maxPages = crawlerConfig.maxPages;

    // Continue while there are URLs left to crawl.
    while (queue.length > 0) {

        // Stop if the configured page limit is reached.
        // A value of 0 means unlimited crawling.
        if (maxPages > 0 && pageCount >= maxPages) {
            console.log(
                `${site.name}: Maximum page limit (${maxPages}) reached.`
            );
            break;
        }

        const currentUrl = queue.shift();

        // Skip URLs already visited.
        if (visitedUrls.has(currentUrl)) {
            continue;
        }

        // Mark the URL as visited.
        visitedUrls.add(currentUrl);

        const currentDetailEndpoint = getDataDetailEndpoint(currentUrl);
        const currentClientIdEndpoint = site.id === "client"
            ? getClientIdDetailEndpoint(currentUrl)
            : null;
        const currentIsWageDeterminationDetail =
            isWageDeterminationDetailUrl(currentUrl);

        console.log("\n--------------------------------------");
        console.log(`Crawling page: ${currentUrl}`);
        console.log("--------------------------------------");

        try {
            // Open the page.
            await page.goto(currentUrl, {
                waitUntil: crawlerConfig.waitUntil,
                timeout: crawlerConfig.timeout
            });

            // Get the actual URL after redirects.
            const finalUrl = normalizeUrl(
                page.url(),
                site,
                crawlerConfig
            );

            if (!finalUrl) {
                console.log("Skipping page because its final URL is invalid.");
                continue;
            }

            // Avoid saving the same final page twice.
            if (finalUrl !== currentUrl && visitedUrls.has(finalUrl)) {
                console.log("Page already visited after redirect. Skipping.");
                continue;
            }

            visitedUrls.add(finalUrl);

            // Do not crawl a login page as normal content.
            if (loginUrl && finalUrl === loginUrl) {
                console.log("Login page detected. Skipping.");
                continue;
            }

            const isDataListingPage =
                /^\/data\/[^/]+\/?$/.test(new URL(finalUrl).pathname);

            // Data listings wait on their actual table-ready condition instead.
            if (crawlerConfig.waitTime > 0 && !isDataListingPage) {
                await page.waitForTimeout(crawlerConfig.waitTime);
            }

            await waitForPageReady(page);
            await waitForClientFilterPageReady(page, site, finalUrl);
            if (site.id === "admin") {
                await closeAdminProductMenuIfOpen(page);
            }

            // Extract information from the current page.
            console.log("Extracting page information...");

            const pageData = await extractPageData(
                page,
                site.id === "admin"
                    ? { excludeSelectors: ADMIN_CHROME_SELECTORS }
                    : {}
            );

            // Save JSON and prepare the screenshot path.
            const nextPageNumber = pageCount + 1;

            const outputPaths = savePageOutput({
                outputRoot,
                siteId: site.id,
                pageNumber: nextPageNumber,
                pageData
            });

            // Save viewport screenshot.
            if (outputConfig.saveScreenshots) {
                await saveScreenshot(
                    page,
                    outputPaths.screenshotPath
                );
            }

            pageCount++;

            const successfulDetailEndpoint =
                getDataDetailEndpoint(finalUrl) || currentDetailEndpoint;

            if (successfulDetailEndpoint) {
                crawledDetailEndpoints.add(successfulDetailEndpoint);
            }

            const successfulClientIdEndpoint = site.id === "client"
                ? (
                    getClientIdDetailEndpoint(finalUrl) ||
                    currentClientIdEndpoint
                )
                : null;

            if (successfulClientIdEndpoint) {
                crawledClientIdEndpoints.add(successfulClientIdEndpoint);
            }

            if (isWageDeterminationDetailUrl(finalUrl)) {
                crawledWageDeterminationDetail = true;
            }

            console.log(
                `${site.name}: Page ${pageCount} saved successfully.`
            );

            pageCount = await crawlDataDetailSidebarStates({
                page,
                site,
                crawlerConfig,
                outputConfig,
                outputRoot,
                pageUrl: finalUrl,
                pageCount,
                maxPages
            });

            // Find links for the next crawling cycle.
            const links = pageData.links || [];

            for (const link of links) {
                if (site.id === "admin") {
                    const lowerHref = String(link.href || "").toLowerCase();
                    const lowerText = String(link.text || "").toLowerCase();
                    const urlPath = (() => {
                        try {
                            return new URL(link.href).pathname.toLowerCase();
                        } catch {
                            return "";
                        }
                    })();

                    if (
                        lowerText.includes("b2c") ||
                        lowerHref.includes("logout") ||
                        /(?:\/|=)(?:analytics|virtual-assistant-manager)(?:\/|$|\?|#)/i.test(lowerHref)
                    ) {
                        continue;
                    }

                    if ([
                        "/data-dashboard",
                        "/schedule",
                        "/queue-manager",
                        "/email-viewer",
                        "/grid-management",
                        "/marketing-accelerator",
                        "/small-business-data",
                        "/resource-center",
                        "/blogs"
                    ].includes(urlPath)) {
                        continue;
                    }

                    if (
                        urlPath.endsWith("/logout") ||
                        lowerText.includes("logout")
                    ) {
                        continue;
                    }
                }

                // Public-site login links must not enter the crawl queue.
                if (site.id === "public" && isLoginLink(link)) {
                    continue;
                }

                // Ignore logout links.
                if (isLogoutLink(link)) {
                    continue;
                }

                // Normalize and validate the link.
                const normalizedLink = normalizeUrl(
                    link.href,
                    site,
                    crawlerConfig
                );

                if (!normalizedLink) {
                    continue;
                }

                const detailEndpoint =
                    getDataDetailEndpoint(normalizedLink);
                const clientIdEndpoint = site.id === "client"
                    ? getClientIdDetailEndpoint(normalizedLink)
                    : null;
                const isWageDeterminationDetail =
                    isWageDeterminationDetailUrl(normalizedLink);

                if (
                    clientIdEndpoint &&
                    (
                        crawledClientIdEndpoints.has(clientIdEndpoint) ||
                        queuedClientIdEndpoints.has(clientIdEndpoint)
                    )
                ) {
                    continue;
                }

                if (
                    isWageDeterminationDetail &&
                    (
                        crawledWageDeterminationDetail ||
                        queuedWageDeterminationDetailUrl !== null
                    )
                ) {
                    continue;
                }

                if (
                    detailEndpoint &&
                    (
                        crawledDetailEndpoints.has(detailEndpoint) ||
                        queuedDetailEndpoints.has(detailEndpoint)
                    )
                ) {
                    continue;
                }

                // Never add the login page to the crawl queue.
                if (loginUrl && normalizedLink === loginUrl) {
                    continue;
                }

                // Skip duplicate or already visited URLs.
                if (
                    visitedUrls.has(normalizedLink) ||
                    queuedUrls.has(normalizedLink)
                ) {
                    continue;
                }

                // Add the new URL to the queue.
                queue.push(normalizedLink);
                queuedUrls.add(normalizedLink);

                if (detailEndpoint) {
                    queuedDetailEndpoints.set(
                        detailEndpoint,
                        normalizedLink
                    );
                }

                if (clientIdEndpoint) {
                    queuedClientIdEndpoints.set(
                        clientIdEndpoint,
                        normalizedLink
                    );
                }

                if (isWageDeterminationDetail) {
                    queuedWageDeterminationDetailUrl = normalizedLink;
                }
            }

            console.log(`New links in queue: ${queue.length}`);

        } catch (error) {
            console.error(
                `Error crawling ${currentUrl}:`,
                error.message
            );
        } finally {
            if (currentDetailEndpoint) {
                const queuedUrl =
                    queuedDetailEndpoints.get(currentDetailEndpoint);

                if (queuedUrl === currentUrl) {
                    queuedDetailEndpoints.delete(currentDetailEndpoint);
                }
            }

            if (currentClientIdEndpoint) {
                const queuedUrl =
                    queuedClientIdEndpoints.get(currentClientIdEndpoint);

                if (queuedUrl === currentUrl) {
                    queuedClientIdEndpoints.delete(currentClientIdEndpoint);
                }
            }

            if (
                currentIsWageDeterminationDetail &&
                queuedWageDeterminationDetailUrl === currentUrl
            ) {
                queuedWageDeterminationDetailUrl = null;
            }
        }

        // Wait before opening the next page.
        if (
            queue.length > 0 &&
            crawlerConfig.delayBetweenPages > 0
        ) {
            await page.waitForTimeout(
                crawlerConfig.delayBetweenPages
            );
        }
    }

    console.log("\n======================================");
    console.log(`CRAWLING FINISHED: ${site.name}`);
    console.log(`Pages saved: ${pageCount}`);
    console.log("======================================\n");

    return {
        siteId: site.id,
        pagesSaved: pageCount
    };
}

module.exports = {
    crawlWebsite
};
