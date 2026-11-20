
const path = require("path");

const config = require(path.resolve(__dirname, "../../config.json"));

function getEnvValue(variableName, websiteName) {
    const value = process.env[variableName];

    if (!value) {
        throw new Error(
            `${websiteName}: Missing environment variable ${variableName} in .env`
        );
    }

    return value;
}

function validateUrl(value, description) {
    let parsedUrl;

    try {
        parsedUrl = new URL(value);
    } catch {
        throw new Error(`Invalid URL configured for ${description}.`);
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        throw new Error(`${description} must use HTTP or HTTPS.`);
    }

    return parsedUrl;
}

function resolveWebsiteConfig(site) {
    const auth = site.auth || { enabled: false };

    if (typeof auth.enabled !== "boolean") {
        throw new Error(`${site.name}: auth.enabled must be true or false.`);
    }

    if (auth.enabled) {
        const loginUrl = getEnvValue(site.loginUrlEnv, site.name);

        const username = getEnvValue(auth.usernameEnv, site.name);
        const password = getEnvValue(auth.passwordEnv, site.name);

        const parsedLoginUrl = validateUrl(
            loginUrl,
            `${site.name} login URL`
        );

        const requiredSelectors = [
            auth.usernameSelector,
            auth.passwordSelector,
            auth.submitSelector
        ];

        if (requiredSelectors.some(
            selector => typeof selector !== "string" || !selector.trim()
        )) {
            throw new Error(
                `${site.name}: Login selectors are missing in config.json.`
            );
        }

        return {
            ...site,
            loginUrl,
            crawlStartUrl: null,
            parsedStartUrl: parsedLoginUrl,
            auth: {
                ...auth,
                username,
                password
            }
        };
    }

    const crawlStartUrl = getEnvValue(site.startUrlEnv, site.name);

    const parsedStartUrl = validateUrl(
        crawlStartUrl,
        `${site.name} start URL`
    );

    return {
        ...site,
        loginUrl: null,
        crawlStartUrl,
        parsedStartUrl,
        auth
    };
}

function loadConfig() {
    if (!Array.isArray(config.websites) || config.websites.length === 0) {
        throw new Error("config.json must contain a non-empty websites array.");
    }

    const crawler = config.crawler || {};
    const browser = config.browser || {};
    const output = config.output || {};

    const validWaitUntil = [
        "domcontentloaded",
        "load",
        "networkidle",
        "commit"
    ];

    if (!validWaitUntil.includes(crawler.waitUntil)) {
        throw new Error("Invalid crawler.waitUntil value.");
    }

    if (
        !Number.isInteger(crawler.maxPages) ||
        crawler.maxPages < 0
    ) {
        throw new Error("crawler.maxPages must be a non-negative integer.");
    }

    return {
        browser,
        crawler,
        output,
        websites: config.websites
    };
}

module.exports = {
    loadConfig,
    resolveWebsiteConfig
};
