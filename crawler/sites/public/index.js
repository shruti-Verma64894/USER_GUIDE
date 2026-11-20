
const {
    loadConfig,
    resolveWebsiteConfig
} = require("../../common/configLoader");

const { createBrowser } = require("../../common/browserManager");
const { crawlWebsite } = require("../../common/crawlerEngine");

async function runPublicCrawler() {
    const config = loadConfig();

    const publicSite = config.websites.find(
        site => site.id === "public"
    );

    if (!publicSite) {
        throw new Error("Public website configuration not found.");
    }

    const site = resolveWebsiteConfig(publicSite);

    let browser;

    try {
        console.log("\n========== PUBLIC CRAWLER ==========");

        const browserData = await createBrowser(
            config.browser,
            site.parsedStartUrl.origin
        );

        browser = browserData.browser;

        await crawlWebsite({
            page: browserData.page,
            site,
            crawlerConfig: config.crawler,
            outputConfig: config.output
        });

    } finally {
        if (browser) {
            await browser.close();
            console.log("Public browser closed.");
        }
    }
}

module.exports = {
    runPublicCrawler
};
