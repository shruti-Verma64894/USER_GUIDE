
const {
    loadConfig,
    resolveWebsiteConfig
} = require("../../common/configLoader");

const { createBrowser } = require("../../common/browserManager");
const { loginClient } = require("./login");
const { crawlWebsite } = require("../../common/crawlerEngine");

async function runClientCrawler() {
    const config = loadConfig();

    const clientSite = config.websites.find(
        site => site.id === "client"
    );

    if (!clientSite) {
        throw new Error("Client website configuration not found.");
    }

    const site = resolveWebsiteConfig(clientSite);

    let browser;

    try {
        console.log("\n========== CLIENT CRAWLER ==========");

        const browserData = await createBrowser(
            config.browser,
            site.parsedStartUrl.origin
        );

        browser = browserData.browser;

        // Step 1: Capture Client login page and log in
        await loginClient(
            browserData.page,
            site,
            config.crawler,
            config.output
        );

        // Step 2: Crawl from the detected post-login URL
        await crawlWebsite({
            page: browserData.page,
            site,
            crawlerConfig: config.crawler,
            outputConfig: config.output
        });

    } finally {
        if (browser) {
            await browser.close();
            console.log("Client browser closed.");
        }
    }
}

module.exports = {
    runClientCrawler
};
