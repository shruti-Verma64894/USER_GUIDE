
const { loginWebsite } = require("../../common/authManager");

async function loginAdmin(page, site, crawlerConfig, outputConfig) {
    console.log("\n========== ADMIN LOGIN ==========");

    await loginWebsite(
        page,
        site,
        crawlerConfig,
        outputConfig
    );

    console.log("Admin login process completed.");
}

module.exports = {
    loginAdmin
};
