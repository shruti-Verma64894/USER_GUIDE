
const { chromium } = require("playwright");

async function createBrowser(browserConfig, permissionOrigin) {
    const browser = await chromium.launch({
        headless: browserConfig.headless ?? true
    });

    const context = await browser.newContext({
        viewport: {
            width: browserConfig.width || 1440,
            height: browserConfig.height || 900
        }
    });

    await context.grantPermissions(
        ["local-network-access"],
        { origin: permissionOrigin }
    );

    const page = await context.newPage();

    return {
        browser,
        context,
        page
    };
}

module.exports = {
    createBrowser
};
