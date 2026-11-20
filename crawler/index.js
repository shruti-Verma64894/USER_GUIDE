
const { runPublicCrawler } = require("./sites/public");
const { runAdminCrawler } = require("./sites/admin");
const { runClientCrawler } = require("./sites/client");

async function runCrawler(siteName) {
    const crawlers = {
        public: runPublicCrawler,
        admin: runAdminCrawler,
        client: runClientCrawler
    };

    const selectedSite = siteName && siteName.toLowerCase();

    if (
        selectedSite &&
        !Object.prototype.hasOwnProperty.call(crawlers, selectedSite)
    ) {
        throw new Error(
            `Unknown site "${siteName}". Choose public, admin, or client.`
        );
    }

    console.log("========== CRAWLER STARTED ==========");

    if (selectedSite) {
        await crawlers[selectedSite]();
    } else {
        await runPublicCrawler();
        await runAdminCrawler();
        await runClientCrawler();
    }

    console.log("========== CRAWLER COMPLETED ==========");
}

module.exports = {
    runCrawler
};
