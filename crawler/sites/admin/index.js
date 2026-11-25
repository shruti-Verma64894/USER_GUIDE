
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
const { acceptCookieConsent } = require("../../common/cookieConsent");
const {
    ADMIN_CHROME_SELECTORS,
    closeAdminProductMenuIfOpen
} = require("./adminChrome");

const ADMIN_REQUEST_PAGES = [
    ["/affiliate-requests", "affiliate-requests"],
    ["/demo-requests", "demo-requests"],
    ["/collaboration-requests", "collaboration-requests"],
    ["/contact-request", "contact-request"],
    ["/user-feedback-requests", "user-feedback-requests"]
];

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
    await closeAdminProductMenuIfOpen(page);
    await page.waitForTimeout(crawlerConfig.waitTime || 0);
    const pageData = await extractPageData(page, {
        excludeSelectors: ADMIN_CHROME_SELECTORS
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
    await acceptCookieConsent(page);
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

function getActionLocator(page, name) {
    return page.getByRole("button", {
        name: new RegExp(`^${name}$`, "i")
    }).first();
}

async function clickAdminAction(page, name, timeout) {
    await acceptCookieConsent(page);
    const action = getActionLocator(page, name);
    const textAction = page.locator("button, a, [role='button']")
        .filter({ hasText: new RegExp(`^\\s*${name}\\s*$`, "i") })
        .first();
    let selectedAction = null;
    for (const candidate of [action, textAction]) {
        if (
            await candidate.count() &&
            await candidate.isVisible().catch(() => false)
        ) {
            selectedAction = candidate;
            break;
        }
    }
    if (!selectedAction) {
        await textAction.waitFor({ state: "visible", timeout });
        selectedAction = textAction;
    }

    await selectedAction.click();
    await page.waitForLoadState("load", { timeout }).catch(error => {
        if (error.name !== "TimeoutError") {
            throw error;
        }
    });
    await waitForPageReady(page);
}

async function crawlInvoiceWorkflow(page, site, crawlerConfig, outputConfig, base) {
    const timeout = crawlerConfig.timeout;
    await crawlAdminUrl(
        page,
        site,
        crawlerConfig,
        outputConfig,
        base + "/invoices-and-payment",
        "invoices-and-payment"
    );

    await clickAdminAction(page, "Upload Invoice", timeout);
    await page.waitForFunction(() => {
        const modalIsVisible = Array.from(
            document.querySelectorAll(".modal, [role='dialog']")
        ).some(element => {
            const style = window.getComputedStyle(element);
            return (
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                element.getClientRects().length > 0
            );
        });
        const recipientIsVisible = document.querySelector("#recipientName")
            ?.getClientRects().length > 0;
        return modalIsVisible || recipientIsVisible;
    }, undefined, { timeout });
    await saveAdminState(
        page,
        site,
        crawlerConfig,
        outputConfig,
        "invoices-upload-invoice"
    );

    const recipient = page.locator("#recipientName");
    await recipient.waitFor({ state: "visible", timeout });
    const recipientOptions = await recipient.locator("option").evaluateAll(options =>
        options
            .filter(option =>
                option.value &&
                !option.disabled &&
                !/select|choose/i.test(option.textContent || "")
            )
            .map(option => option.value)
    );
    if (recipientOptions.length) {
        await recipient.selectOption(recipientOptions[0]);
    } else {
        await recipient.click();
        const options = page.locator(
            "[role='option']:visible, .dropdown-menu:visible " +
            "[role='menuitem']:visible, .dropdown-menu:visible .dropdown-item"
        );
        const optionCount = await options.count();
        let selected = false;
        for (let index = 0; index < optionCount; index++) {
            const option = options.nth(index);
            const text = (await option.innerText().catch(() => "")).trim();
            if (!text || /select|choose/i.test(text)) {
                continue;
            }
            await option.click();
            selected = true;
            break;
        }
        if (!selected) {
            throw new Error("Invoices: No selectable recipients are available.");
        }
    }
    await page.waitForLoadState("load", { timeout }).catch(error => {
        if (error.name !== "TimeoutError") {
            throw error;
        }
    });
    await waitForPageReady(page);
    await saveAdminState(
        page,
        site,
        crawlerConfig,
        outputConfig,
        "invoices-recipient-selected"
    );

    await clickAdminAction(page, "Continue", timeout);
    await saveAdminState(
        page,
        site,
        crawlerConfig,
        outputConfig,
        "invoices-continue"
    );

    await clickAdminAction(page, "Publish Invoice", timeout);
    await saveAdminState(
        page,
        site,
        crawlerConfig,
        outputConfig,
        "invoices-published"
    );
}

async function crawlUnreadNotifications(page, site, crawlerConfig, outputConfig) {
    const timeout = crawlerConfig.timeout;
    const unreadTab = page.locator("a[href*='tab=unread']").first();
    await unreadTab.waitFor({ state: "visible", timeout });

    const unreadUrl = new URL(
        await unreadTab.getAttribute("href"),
        page.url()
    ).href;
    await Promise.all([
        page.waitForURL(unreadUrl, { timeout }),
        unreadTab.click()
    ]);
    await waitForPageReady(page);
    await page.waitForTimeout(crawlerConfig.waitTime || 0);
    await saveAdminState(
        page,
        site,
        crawlerConfig,
        outputConfig,
        "notifications-unread"
    );
}

async function crawlUserProfileWorkflow(page, site, crawlerConfig, outputConfig, base) {
    const timeout = crawlerConfig.timeout;
    await crawlAdminUrl(
        page,
        site,
        crawlerConfig,
        outputConfig,
        base + "/users?view=profile",
        "user-profile"
    );

    await clickAdminAction(page, "Edit Name", timeout);
    const modal = page.locator(".modal:visible, [role='dialog']:visible").last();
    await modal.waitFor({ state: "visible", timeout });
    await waitForPageReady(page);
    await saveAdminState(
        page,
        site,
        crawlerConfig,
        outputConfig,
        "user-profile-edit-name-modal"
    );

    const cancel = modal.getByRole("button", { name: /^Cancel$/i }).first();
    await cancel.waitFor({ state: "visible", timeout });
    await cancel.click();
    await modal.waitFor({ state: "hidden", timeout });

    await crawlAdminUrl(
        page,
        site,
        crawlerConfig,
        outputConfig,
        base + "/reset-password",
        "change-password"
    );
}

async function crawlDownloadsWorkflow(page, site, crawlerConfig, outputConfig, base) {
    const timeout = crawlerConfig.timeout;
    await crawlAdminUrl(
        page,
        site,
        crawlerConfig,
        outputConfig,
        base + "/downloads",
        "downloads"
    );

    let clientSelected = false;
    const nativeClientSelect = page.locator(
        "select[id*='client' i]:visible, select[name*='client' i]:visible, " +
        "select[aria-label*='client' i]:visible"
    ).first();
    if (await nativeClientSelect.count()) {
        const clients = await nativeClientSelect.locator("option").evaluateAll(options =>
            options
                .filter(option =>
                    option.value &&
                    !option.disabled &&
                    !/select|choose/i.test(option.textContent || "")
                )
                .map(option => option.value)
        );
        if (clients.length) {
            await nativeClientSelect.selectOption(clients[0]);
            clientSelected = true;
        }
    }

    if (!clientSelected) {
        const preferredClients = [
            "Asponte Technology Inc",
            "Inonde LLC",
            "Nirvana Lab Inc"
        ];
        const clientInput = page.locator(
            "input.client-combobox-input:visible, " +
            "input[placeholder*='client' i]:visible"
        ).first();
        await clientInput.waitFor({ state: "visible", timeout });
        await clientInput.click();
        await page.waitForTimeout(300);

        for (const name of preferredClients) {
            const option = page.getByText(name, { exact: true }).last();
            if (await option.isVisible().catch(() => false)) {
                await option.click();
                clientSelected = true;
                break;
            }
        }

        const options = page.locator(
            "[role='option']:visible, [role='listbox']:visible > *, " +
            ".select2-results__option:visible, " +
            "[class*='client-combobox'] [class*='option']:visible, " +
            "[class*='client-combobox'] [class*='item']:visible, " +
            "[class*='client-option']:visible, " +
            ".dropdown-menu:visible [role='menuitem']:visible, " +
            ".dropdown-menu:visible .dropdown-item"
        );
        const optionCount = await options.count();
        if (!clientSelected) {
            for (let index = 0; index < optionCount; index++) {
                const option = options.nth(index);
                const text = (await option.innerText().catch(() => "")).trim();
                const disabled = await option.getAttribute("aria-disabled");
                if (!text || disabled === "true" || /select|choose/i.test(text)) {
                    continue;
                }
                await option.click();
                clientSelected = true;
                break;
            }
        }

        for (const name of preferredClients) {
            if (clientSelected) {
                break;
            }
            await clientInput.fill(name);
            const option = page.getByText(name, { exact: true }).last();
            let optionIsVisible = false;
            try {
                await option.waitFor({
                    state: "visible",
                    timeout: Math.min(timeout, 3000)
                });
                optionIsVisible = true;
            } catch (error) {
                if (error.name !== "TimeoutError") {
                    throw error;
                }
            }
            if (optionIsVisible) {
                await option.click();
                clientSelected = true;
            }
        }

        if (!clientSelected) {
            throw new Error(
                "Downloads: The Client List did not expose a selectable client."
            );
        }
    }
    await page.waitForLoadState("load", { timeout }).catch(error => {
        if (error.name !== "TimeoutError") {
            throw error;
        }
    });
    await page.waitForTimeout(crawlerConfig.waitTime || 500);
    await waitForPageReady(page);
    await saveAdminState(
        page,
        site,
        crawlerConfig,
        outputConfig,
        "downloads-client-selected"
    );

    const completedTab = page.getByRole("tab", {
        name: /^Completed$/i
    }).first();
    if (await completedTab.count()) {
        await completedTab.click();
    } else {
        const completedLink = page.getByText("Completed", { exact: true }).last();
        if (!await completedLink.isVisible().catch(() => false)) {
            throw new Error("Downloads: Could not find the Completed tab.");
        }
        await completedLink.click();
    }
    await page.waitForTimeout(crawlerConfig.waitTime || 500);
    await waitForPageReady(page);
    await saveAdminState(
        page,
        site,
        crawlerConfig,
        outputConfig,
        "downloads-completed"
    );
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
        "a[aria-label*='add' i]",
        "a[title*='add' i]",
        "[role='button'][aria-label*='add' i]",
        "button:has-text('+')",
        "a:has-text('+')",
        "[role='button']:has-text('+')",
        "button:has(.fa-plus)",
        "a:has(.fa-plus)",
        "[role='button']:has(.fa-plus)",
        "button .fa-plus",
        "button[class*='plus' i]",
        "a[class*='plus' i]",
        "[role='button'][class*='plus' i]"
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

    await crawlInvoiceWorkflow(page, site, crawlerConfig, outputConfig, base);

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
    for (const [route, label] of ADMIN_REQUEST_PAGES) {
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

    await crawlAdminUrl(
        page,
        site,
        crawlerConfig,
        outputConfig,
        base + "/emails",
        "administration-emails"
    );

    await crawlAdminUrl(
        page,
        site,
        crawlerConfig,
        outputConfig,
        base + "/notifications",
        "notifications"
    );
    await crawlUnreadNotifications(
        page,
        site,
        crawlerConfig,
        outputConfig
    );
    await crawlUserProfileWorkflow(
        page,
        site,
        crawlerConfig,
        outputConfig,
        base
    );
    await crawlDownloadsWorkflow(
        page,
        site,
        crawlerConfig,
        outputConfig,
        base
    );
    await crawlAdminUrl(
        page,
        site,
        crawlerConfig,
        outputConfig,
        base + "/contact-us",
        "user-feedback"
    );

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
