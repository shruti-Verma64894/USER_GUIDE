
const {
    loadConfig,
    resolveWebsiteConfig
} = require("../../common/configLoader");

const { createBrowser } = require("../../common/browserManager");
const { loginAdmin } = require("./login");
const { crawlWebsite } = require("../../common/crawlerEngine");

async function runAdminCrawler() {
    const config = loadConfig();

    const adminSite = config.websites.find(
        site => site.id === "admin"
    );

    if (!adminSite) {
        throw new Error("Admin website configuration not found.");
    }

    const site = resolveWebsiteConfig(adminSite);

    let browser;

    try {
        console.log("\n========== ADMIN CRAWLER ==========");

        const browserData = await createBrowser(
            config.browser,
            site.parsedStartUrl.origin
        );

        browser = browserData.browser;

        // Step 1: Open and capture Admin login page, then log in
        await loginAdmin(
            browserData.page,
            site,
            config.crawler,
            config.output
        );

        // Step 2: Crawl from the post-login URL
        await crawlWebsite({
            page: browserData.page,
            site,
            crawlerConfig: config.crawler,
            outputConfig: config.output
        });

    } finally {
        if (browser) {
            await browser.close();
            console.log("Admin browser closed.");
        }
    }
}

module.exports = {
    runAdminCrawler
};
