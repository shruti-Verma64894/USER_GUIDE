
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

            // Extract information from the current page.
            console.log("Extracting page information...");

            const pageData = await extractPageData(page);

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

            // Find links for the next crawling cycle.
            const links = pageData.links || [];

            for (const link of links) {

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
