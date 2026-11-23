
const {
    loadConfig,
    resolveWebsiteConfig
} = require("../../common/configLoader");

const { createBrowser } = require("../../common/browserManager");
const { loginAdmin } = require("./login");
const path = require("path");
const { extractPageData } = require("../../common/dataExtractor");
const { waitForPageReady, saveScreenshot } = require("../../common/screenshot");
const { savePageOutput } = require("../../common/outputManager");

let adminOutputPageNumber = 1;

async function saveAdminState(
    page,
    site,
    crawlerConfig,
    outputConfig,
    label,
    folderName
) {
    await waitForPageReady(page);
    await page.waitForTimeout(crawlerConfig.waitTime || 0);
    const pageData = await extractPageData(page, {
        excludeSelectors: ["#controlMenu"]
    });
    pageData.captureLabel = label;
    pageData.pageInfo.url = page.url();

    const outputRoot = path.resolve(
        process.cwd(),
        outputConfig.folder || "output"
    );
    const outputPaths = savePageOutput({
        outputRoot,
        siteId: site.id,
        pageNumber: adminOutputPageNumber++,
        pageData,
        folderName
    });
    if (outputConfig.saveScreenshots) {
        await saveScreenshot(page, outputPaths.screenshotPath);
    }
    return pageData;
}

async function openSafeDropdown(page, label) {
    const control = page.getByText(label, { exact: true }).last();
    if (await control.count() && await control.isVisible().catch(() => false)) {
        await control.hover();
        await page.waitForTimeout(500);
        return control;
    }
    return null;
}

async function crawlAdminUrl(page, site, crawlerConfig, outputConfig, url, label) {
    const pathname = new URL(url).pathname.toLowerCase();
    if (
        /(^|\/)(analytics|virtual-assistant-manager)(\/|$)/.test(pathname) ||
        /(^|\/)(logout|log-out|signout|sign-out|logoff)(\/|$)/.test(pathname)
    ) {
        console.log(`Skipping excluded Admin page: ${url}`);
        return;
    }

    await page.goto(url, {
        waitUntil: crawlerConfig.waitUntil,
        timeout: crawlerConfig.timeout
    });
    await waitForPageReady(page);
    await saveAdminState(page, site, crawlerConfig, outputConfig, label);
}

async function clickIfPresent(page, locators) {
    for (const locator of locators) {
        const candidate = typeof locator === "string"
            ? page.locator(locator).first()
            : locator;
        if (await candidate.count() && await candidate.isVisible().catch(() => false)) {
            await candidate.click();
            return candidate;
        }
    }
    return null;
}

async function clickNextAndWait(page, expectedHeading, timeout) {
    const nextButton = page.locator("#globalNextBtn").first();
    await nextButton.waitFor({ state: "visible", timeout });
    if (!await nextButton.isEnabled()) {
        throw new Error(
            `Add New Client: Next is disabled before "${expectedHeading}".`
        );
    }

    await nextButton.click();
    await page.locator("h1, h2, h3")
        .filter({ hasText: expectedHeading })
        .last()
        .waitFor({ state: "visible", timeout });
}

async function selectCustomerContentClient(page, timeout) {
    const clientSelect = page.locator("#SelectClient");
    await clientSelect.waitFor({ state: "attached", timeout });

    const clients = await clientSelect.locator("option").evaluateAll(options =>
        options
            .filter(option => option.value && !option.disabled)
            .map(option => ({
                value: option.value,
                label: option.textContent.trim()
            }))
    );
    if (!clients.length) {
        throw new Error("Customer Content: No selectable clients are available.");
    }

    const wrapper = page.locator(".selectbox_warpper")
        .filter({ has: clientSelect })
        .first();
    const visibleControl = wrapper.locator(".select2-selection--single").first();
    await visibleControl.waitFor({ state: "visible", timeout });
    await visibleControl.click();

    await page.waitForFunction(labels =>
        Array.from(
            document.querySelectorAll(".select2-results__option")
        ).some(option => {
            const style = window.getComputedStyle(option);
            const visible = style.display !== "none" &&
                style.visibility !== "hidden" &&
                option.getClientRects().length > 0;
            return visible && labels.includes(option.innerText.trim());
        }),
    clients.map(client => client.label), { timeout });

    const visibleOptions = page.locator(".select2-results__option:visible");
    const optionCount = await visibleOptions.count();
    let selectedOption = null;
    for (let index = 0; index < optionCount; index++) {
        const option = visibleOptions.nth(index);
        const label = (await option.innerText()).trim();
        const client = clients.find(item => item.label === label);
        if (client) {
            await option.click();
            selectedOption = client;
            break;
        }
    }
    if (!selectedOption) {
        throw new Error(
            "Customer Content: The Select2 menu did not show an available client."
        );
    }

    await page.waitForFunction(
        value => document.querySelector("#SelectClient")?.value === value,
        selectedOption.value,
        { timeout }
    );
    await page.waitForLoadState("load", { timeout });
    await page.waitForTimeout(1000);
    return selectedOption;
}

async function clickPlusAndWait(page, timeout) {
    const previousUrl = page.url();
    const previousFieldCount = await page.locator(
        "input:visible, textarea:visible, select:visible"
    ).count();
    const plusButton = await clickIfPresent(page, [
        "button[aria-label*='add' i]",
        "button[title*='add' i]",
        "button:has-text('+')",
        "button .fa-plus",
        "button[class*='plus' i]"
    ]);

    if (!plusButton) {
        throw new Error("User Administration: Could not find the Plus button.");
    }

    await page.waitForFunction(({ url, fieldCount }) => {
        const dialogIsVisible = Array.from(
            document.querySelectorAll(".modal, [role='dialog']")
        ).some(element => {
            const style = window.getComputedStyle(element);
            return (
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                element.getClientRects().length > 0
            );
        });
        const visibleFieldCount = Array.from(
            document.querySelectorAll("input, textarea, select")
        ).filter(element => {
            const style = window.getComputedStyle(element);
            return (
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                element.getClientRects().length > 0
            );
        }).length;

        return (
            window.location.href !== url ||
            dialogIsVisible ||
            visibleFieldCount > fieldCount
        );
    }, { url: previousUrl, fieldCount: previousFieldCount }, { timeout });

    await waitForPageReady(page);
}

async function selectAvailableIndustry(page, timeout) {
    const industryInput = page.locator("#industry");
    await industryInput.waitFor({ state: "visible", timeout });

    async function waitForSelection(selectionTimeout) {
        await page.waitForFunction(() => {
            const input = document.querySelector("#industry");
            return input && input.value.trim().length > 0;
        }, undefined, { timeout: selectionTimeout });
    }

    const nativeSelect = page.locator("select#industry");
    if (await nativeSelect.count()) {
        const options = await nativeSelect.locator("option").evaluateAll(items =>
            items.map(item => ({ value: item.value, disabled: item.disabled }))
                .filter(item => item.value && !item.disabled)
        );
        if (!options.length) {
            throw new Error("Add New Client: Industry has no available options.");
        }
        await nativeSelect.selectOption(options[0].value);
        return;
    }

    const dropdown = page.locator(".govcon-searchable-dropdown")
        .filter({ has: industryInput })
        .first();
    const toggle = dropdown.locator(".govcon-searchable-dropdown-toggle").first();
    await toggle.waitFor({ state: "visible", timeout });
    const toggleLabel = (await toggle.getAttribute("aria-label") || "")
        .toLowerCase();
    const arrowIsOpen = await toggle.locator(".govcon-searchable-dropdown-arrow")
        .evaluate(element => element.classList.contains("is-open"))
        .catch(() => false);
    const dropdownIsOpen =
        toggleLabel === "close options" || arrowIsOpen;

    if (!dropdownIsOpen) {
        await toggle.click();
        await page.waitForFunction(() => {
            const toggleButton = document.querySelector(
                ".govcon-searchable-dropdown .govcon-searchable-dropdown-toggle"
            );
            return (
                toggleButton?.getAttribute("aria-label")?.toLowerCase() ===
                    "close options" ||
                toggleButton?.querySelector(
                    ".govcon-searchable-dropdown-arrow.is-open"
                )
            );
        }, undefined, { timeout });
    }
    await page.waitForTimeout(300);

    const options = page.locator([
        "[role='option']:visible",
        "[class*='industry-option']:visible",
        ".govcon-searchable-dropdown [class*='option']:visible",
        ".govcon-searchable-dropdown [class*='item']:visible",
        ".govcon-searchable-dropdown li:visible",
        ".govcon-searchable-dropdown .dropdown-item:visible",
        "[role='listbox']:visible > *"
    ].join(", "));

    const optionCount = await options.count();
    for (let index = 0; index < optionCount; index++) {
        const option = options.nth(index);
        const text = (await option.innerText().catch(() => "")).trim();
        if (!text || /select or start typing|open options/i.test(text)) {
            continue;
        }

        await option.click();
        try {
            await waitForSelection(Math.min(timeout, 3000));
            return;
        } catch (error) {
            if (error.name !== "TimeoutError") {
                throw error;
            }
        }
    }

    await industryInput.focus();
    await industryInput.press("ArrowDown");
    await industryInput.press("Enter");
    await waitForSelection(timeout);
}

async function closeVisibleModal(page) {
    await clickIfPresent(page, [
        "button:has-text('Close')",
        "button:has-text('Cancel')",
        "[aria-label='Close']",
        ".modal .btn-close",
        ".modal [data-dismiss='modal']"
    ]);
}

async function crawlVisibleModals(page, site, crawlerConfig, outputConfig, labelPrefix) {
    const controls = page.locator(
        "button:visible, a[role='button']:visible, [role='button']:visible"
    );
    const count = await controls.count();
    const candidates = [];
    for (let i = 0; i < count; i++) {
        const control = controls.nth(i);
        const text = (await control.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
        if (/add|edit|create|new|view|invoice|payment|permission/i.test(text)) {
            candidates.push(text);
        }
    }

    const uniqueCandidates = [...new Set(candidates)].slice(0, 8);
    for (const text of uniqueCandidates) {
        const control = page.getByRole("button", { name: text, exact: false }).first();
        if (!await control.count()) continue;
        if (!await control.isVisible().catch(() => false)) continue;
        await control.click().catch(() => null);
        const modal = page.locator(".modal:visible, [role='dialog']:visible").last();
        if (await modal.count() && await modal.isVisible().catch(() => false)) {
            await modal.waitFor({ state: "visible", timeout: crawlerConfig.timeout }).catch(() => null);
            await page.waitForTimeout(crawlerConfig.waitTime || 500);
            await saveAdminState(page, site, crawlerConfig, outputConfig, `${labelPrefix}-modal-${text}`);
            await closeVisibleModal(page);
        }
    }
}

async function crawlAdminWorkflows(page, site, crawlerConfig, outputConfig) {
    const base = "https://platform.nlproducts.net";

    await crawlAdminUrl(page, site, crawlerConfig, outputConfig, base + "/accounts-home", "accounts-home");
    await clickIfPresent(page, [
        "button:has-text('Add New Client')",
        "a:has-text('Add New Client')"
    ]);
    await page.waitForTimeout(crawlerConfig.waitTime || 500);
    await saveAdminState(page, site, crawlerConfig, outputConfig, "add-new-client-step-1");

    const ueiControl = page.locator(
        "input[name*='uei' i], input[id*='uei' i], input[placeholder*='UEI' i]"
    ).first();
    await ueiControl.waitFor({ state: "visible", timeout: crawlerConfig.timeout });
    await ueiControl.fill("DXJMS3LJLUK1");
    await clickIfPresent(page, [
        "button:has-text('Next')",
        "input[type='submit'][value*='Next']",
        "a:has-text('Next')"
    ]);
    await page.waitForTimeout(crawlerConfig.waitTime || 500);
    await saveAdminState(page, site, crawlerConfig, outputConfig, "point-of-contact");

    await clickIfPresent(page, [
        "button:has-text('Next')",
        "input[type='submit'][value*='Next']",
        "a:has-text('Next')"
    ]);
    await page.waitForTimeout(crawlerConfig.waitTime || 500);
    await saveAdminState(page, site, crawlerConfig, outputConfig, "business-overview");

    await selectAvailableIndustry(page, crawlerConfig.timeout);
    await clickNextAndWait(
        page,
        "Company Details",
        crawlerConfig.timeout
    );
    await saveAdminState(page, site, crawlerConfig, outputConfig, "company-details");

    const legalName = page.locator(
        "input[name*='legal' i], input[id*='legal' i], input[placeholder*='Legal Name' i]"
    ).first();
    if (await legalName.count()) {
        await legalName.fill("BRAVENT LLC");
    }
    await saveAdminState(page, site, crawlerConfig, outputConfig, "company-details-filled");
    await closeVisibleModal(page);

    await page.goto(base + "/customer-content", {
        waitUntil: crawlerConfig.waitUntil,
        timeout: crawlerConfig.timeout
    });
    await waitForPageReady(page);
    await selectCustomerContentClient(page, crawlerConfig.timeout);
    await saveAdminState(
        page,
        site,
        crawlerConfig,
        outputConfig,
        "customer-content"
    );

    await openSafeDropdown(page, "Data Management");
    await saveAdminState(
        page,
        site,
        crawlerConfig,
        outputConfig,
        "data-management-dropdown",
        "Data Management"
    );

    await openSafeDropdown(page, "Commerce");
    await saveAdminState(
        page,
        site,
        crawlerConfig,
        outputConfig,
        "commerce-dropdown",
        "Commerce"
    );
    await crawlAdminUrl(page, site, crawlerConfig, outputConfig, base + "/customer-contract", "customer-contract");
    const contractLink = page.locator("a[href*='customer-contract?id=']").first();
    if (await contractLink.count()) {
        const href = await contractLink.getAttribute("href");
        if (href) {
            await crawlAdminUrl(
                page,
                site,
                crawlerConfig,
                outputConfig,
                new URL(href, base).href,
                "customer-contract-detail"
            );
        }
    }
    await page.goto(base + "/customer-contract", {
        waitUntil: crawlerConfig.waitUntil,
        timeout: crawlerConfig.timeout
    });
    await waitForPageReady(page);
    await crawlVisibleModals(page, site, crawlerConfig, outputConfig, "customer-contract");

    await crawlAdminUrl(page, site, crawlerConfig, outputConfig, base + "/invoices-and-payment", "invoices-and-payment");
    await crawlVisibleModals(page, site, crawlerConfig, outputConfig, "invoices-and-payment");

    await openSafeDropdown(page, "Marketing Management");
    await saveAdminState(
        page,
        site,
        crawlerConfig,
        outputConfig,
        "marketing-management-dropdown",
        "Marketing Management"
    );

    await openSafeDropdown(page, "Administration");
    await saveAdminState(
        page,
        site,
        crawlerConfig,
        outputConfig,
        "administration-dropdown",
        "Administration"
    );
    await openSafeDropdown(page, "User Administration");
    await saveAdminState(
        page,
        site,
        crawlerConfig,
        outputConfig,
        "administration-user-administration-dropdown",
        "User Administration"
    );

    await crawlAdminUrl(
        page,
        site,
        crawlerConfig,
        outputConfig,
        base + "/emails",
        "administration-emails"
    );

    for (const [route, label] of [
        ["/affiliate-requests", "affiliate-requests"],
        ["/demo-requests", "demo-requests"],
        ["/collaboration-requests", "collaboration-requests"],
        ["/contact-request", "contact-request"],
        ["/user-feedback-requests", "user-feedback-requests"]
    ]) {
        await crawlAdminUrl(page, site, crawlerConfig, outputConfig, base + route, label);
        await clickPlusAndWait(page, crawlerConfig.timeout);
        await saveAdminState(
            page,
            site,
            crawlerConfig,
            outputConfig,
            `${label}-plus-form`
        );
        await closeVisibleModal(page);
    }

    await crawlAdminUrl(page, site, crawlerConfig, outputConfig, base + "/notifications", "notifications");
    await crawlAdminUrl(page, site, crawlerConfig, outputConfig, base + "/users?view=profile", "user-profile");
    await crawlAdminUrl(page, site, crawlerConfig, outputConfig, base + "/reset-password", "change-password");
    await crawlAdminUrl(page, site, crawlerConfig, outputConfig, base + "/downloads", "downloads");
    await crawlAdminUrl(page, site, crawlerConfig, outputConfig, base + "/contact-us", "user-feedback");

    const pendingPopups = [];
    const popupHandler = popup => pendingPopups.push(popup);
    const dialogHandler = dialog => dialog.type() === "alert"
        ? dialog.accept()
        : dialog.dismiss();
    let popupNumber = 1;

    page.on("popup", popupHandler);
    page.on("dialog", dialogHandler);
    try {
        for (const [route, label] of [
            ["/naics", "NAICs"],
            ["/pscs", "PSCs"],
            ["/sics", "SICs"],
            ["/sins", "SINs"]
        ]) {
            await crawlAdminUrl(page, site, crawlerConfig, outputConfig, base + route, label);

            await page.waitForTimeout(250);
            while (pendingPopups.length > 0) {
                const popup = pendingPopups.shift();
                await waitForPageReady(popup);
                const popupOrigin = new URL(popup.url()).origin;
                if (popupOrigin !== new URL(base).origin) {
                    console.log(`Ignoring external popup: ${popup.url()}`);
                    continue;
                }

                popup.on("dialog", dialogHandler);
                await saveAdminState(
                    popup,
                    site,
                    crawlerConfig,
                    outputConfig,
                    `${label}-popup-${popupNumber++}`
                );
            }
        }
    } finally {
        page.off("popup", popupHandler);
        page.off("dialog", dialogHandler);
    }
}

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

        // Admin pages are processed in this explicit sequence; do not run the
        // generic link-queue crawler, which would revisit navigation links.
        await crawlAdminWorkflows(
            browserData.page,
            site,
            config.crawler,
            config.output
        );

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
