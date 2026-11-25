
const path = require("path");
const { extractPageData } = require("../../common/dataExtractor");
const { saveScreenshot, waitForPageReady } = require("../../common/screenshot");
const { savePageOutput } = require("../../common/outputManager");
const {
    ADMIN_CHROME_SELECTORS,
    closeAdminProductMenuIfOpen
} = require("./adminChrome");

let initialNavigationPageNumber = 1;

async function saveAdminPage(page, site, outputConfig, label) {
    await closeAdminProductMenuIfOpen(page);
    const outputRoot = path.resolve(
        process.cwd(),
        outputConfig.folder || "output"
    );
    const pageData = await extractPageData(page, {
        excludeSelectors: ADMIN_CHROME_SELECTORS
    });
    pageData.pageInfo.url = page.url();
    pageData.captureLabel = label;

    const outputPaths = savePageOutput({
        outputRoot,
        siteId: site.id,
        pageNumber: initialNavigationPageNumber++,
        pageData,
        folderName: label,
        saveJson: outputConfig.saveIndividualJson,
        outputFolder: "login"
    });

    if (outputConfig.saveScreenshots) {
        await saveScreenshot(page, outputPaths.screenshotPath);
    }
}

async function clickFirst(page, selectors) {
    for (const selector of selectors) {
        const locator = page.locator(selector).first();
        if (await locator.count()) {
            if (await locator.isVisible().catch(() => false)) {
                await locator.click();
                return true;
            }
        }
    }
    return false;
}

async function loginAdmin(page, site, crawlerConfig, outputConfig) {
    console.log("\n========== ADMIN LOGIN ==========");
    await page.goto("https://platform.nlproducts.net/", {
        waitUntil: crawlerConfig.waitUntil,
        timeout: crawlerConfig.timeout
    });
    await waitForPageReady(page);
    await saveAdminPage(page, site, outputConfig, "homepage");

    const signUpClicked = await clickFirst(page, [
        "a[href*='/sign-up']",
        "button:has-text('Sign Up')",
        "a:has-text('Sign Up')"
    ]);
    if (!signUpClicked) {
        throw new Error("Admin: Could not locate the Sign Up control.");
    }
    await page.waitForLoadState("load", { timeout: crawlerConfig.timeout });
    await waitForPageReady(page);
    await saveAdminPage(page, site, outputConfig, "sign-up");

    const loginClicked = await clickFirst(page, [
        "a[href*='/login']",
        "button:has-text('Login')",
        "a:has-text('Login')",
        "button:has-text('Sign In')",
        "a:has-text('Sign In')"
    ]);
    if (!loginClicked) {
        throw new Error("Admin: Could not locate the Login control.");
    }
    await page.waitForLoadState("load", { timeout: crawlerConfig.timeout });
    await waitForPageReady(page);
    await saveAdminPage(page, site, outputConfig, "login");

    const auth = site.auth;
    await page.locator(auth.usernameSelector).waitFor({
        state: "visible",
        timeout: crawlerConfig.timeout
    });
    await page.locator(auth.usernameSelector).fill(auth.username);
    await page.locator(auth.passwordSelector).fill(auth.password);

    await Promise.all([
        page.waitForURL(
            url => url.pathname === auth.successUrlPath,
            { timeout: crawlerConfig.timeout }
        ),
        page.locator(auth.submitSelector).click()
    ]);

    await waitForPageReady(page);
    await saveAdminPage(page, site, outputConfig, "accounts-home");
    console.log("Admin login process completed.");
    return page.url();
}

module.exports = {
    loginAdmin
};
