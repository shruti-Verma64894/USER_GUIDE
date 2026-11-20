
const fs = require("fs");
const path = require("path");

const { extractPageData } = require("./dataExtractor");
const { saveScreenshot } = require("./screenshot");

async function captureLoginPage(page, site, outputConfig) {
    console.log(`${site.name}: Capturing login page...`);

    const outputRoot = path.resolve(
        process.cwd(),
        outputConfig.folder || "output"
    );

    const loginFolder = path.join(
        outputRoot,
        site.id,
        "login-page"
    );

    fs.mkdirSync(loginFolder, { recursive: true });

    // Extract login page information
    const pageData = await extractPageData(page);

    pageData.pageInfo.url = page.url();

    // Save login page JSON
    if (outputConfig.saveIndividualJson) {
        const jsonPath = path.join(loginFolder, "page.json");

        fs.writeFileSync(
            jsonPath,
            JSON.stringify(pageData, null, 2),
            "utf8"
        );

        console.log(`Login page JSON saved: ${jsonPath}`);
    }

    // Save login page screenshot
    if (outputConfig.saveScreenshots) {
        const screenshotPath = path.join(
            loginFolder,
            "screenshot.png"
        );

        await saveScreenshot(page, screenshotPath);
    }
}

async function loginWebsite(page, site, crawlerConfig, outputConfig) {
    const auth = site.auth;

    if (!auth.enabled) {
        console.log(`${site.name}: Authentication not required.`);

        await page.goto(site.crawlStartUrl, {
            waitUntil: crawlerConfig.waitUntil,
            timeout: crawlerConfig.timeout
        });

        return;
    }

    console.log(`${site.name}: Opening login page...`);

    await page.goto(site.loginUrl, {
        waitUntil: crawlerConfig.waitUntil,
        timeout: crawlerConfig.timeout
    });

    await page.locator(auth.usernameSelector).waitFor({
        state: "visible",
        timeout: crawlerConfig.timeout
    });

    // Capture login page before entering credentials
    await captureLoginPage(page, site, outputConfig);

    const initialUrl = page.url();

    console.log(`${site.name}: Entering login credentials...`);

    await page.locator(auth.usernameSelector).fill(auth.username);
    await page.locator(auth.passwordSelector).fill(auth.password);

    if (auth.successUrlPath) {
        // Admin: wait for the expected post-login URL
        await Promise.all([
            page.waitForURL(
                url => url.pathname === auth.successUrlPath,
                { timeout: crawlerConfig.timeout }
            ),
            page.locator(auth.submitSelector).click()
        ]);
    } else {
        // Client: wait for URL change or login form disappearance
        await Promise.all([
            Promise.any([
                page.waitForURL(
                    url => url.href !== initialUrl,
                    { timeout: crawlerConfig.timeout }
                ),
                page.locator(auth.usernameSelector).waitFor({
                    state: "hidden",
                    timeout: crawlerConfig.timeout
                })
            ]),
            page.locator(auth.submitSelector).click()
        ]);
    }

    console.log(`${site.name}: Login successful.`);
    console.log(`${site.name}: Post-login URL: ${page.url()}`);

    // Automatically use the post-login URL as the crawl start URL
    site.crawlStartUrl = page.url();
    site.parsedStartUrl = new URL(site.crawlStartUrl);

    console.log(`${site.name}: Ready to start crawling.`);
}

module.exports = {
    loginWebsite
};
