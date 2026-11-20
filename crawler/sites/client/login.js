
const { loginWebsite } = require("../../common/authManager");

async function loginClient(page, site, crawlerConfig, outputConfig) {
    console.log("\n========== CLIENT LOGIN ==========");

    await loginWebsite(
        page,
        site,
        crawlerConfig,
        outputConfig
    );

    console.log("Client login process completed.");
}

module.exports = {
    loginClient
};
