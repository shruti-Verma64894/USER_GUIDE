async function acceptCookieConsent(page) {
    const consent = await page.evaluate(() => {
        const controls = Array.from(document.querySelectorAll(
            "button, [role='button'], input[type='button'], " +
            "input[type='submit'], a"
        ));

        for (const element of controls) {
            const style = window.getComputedStyle(element);
            const label = [
                element.innerText ||
                    element.value ||
                    "",
                element.getAttribute("aria-label") || "",
                element.getAttribute("title") || ""
            ].join(" ").replace(/\s+/g, " ").trim();

            if (
                style.display === "none" ||
                style.visibility === "hidden" ||
                element.getClientRects().length === 0 ||
                !/\baccept\s+all\b/i.test(label)
            ) {
                continue;
            }

            let cookieContext = /\bcookies?\b/i.test(label);
            let root = element.parentElement;

            for (
                let ancestor = element;
                ancestor && ancestor !== document.body;
                ancestor = ancestor.parentElement
            ) {
                const text = ancestor.innerText || "";
                const identity = [
                    ancestor.id,
                    typeof ancestor.className === "string"
                        ? ancestor.className
                        : "",
                    ancestor.getAttribute("role"),
                    ancestor.getAttribute("aria-label")
                ].join(" ");

                if (/\bcookies?\b|\bconsent\b/i.test(text)) {
                    cookieContext = true;
                }
                if (/cookie|consent/i.test(identity)) {
                    cookieContext = true;
                }

                if (
                    ancestor !== element &&
                    (
                        ancestor.matches(
                            "[role='dialog'], [aria-modal='true']"
                        ) ||
                        /cookie|consent|privacy|banner/i.test(identity)
                    )
                ) {
                    root = ancestor;
                    break;
                }
            }

            if (!cookieContext) {
                continue;
            }

            const marker = `cookie-consent-${Date.now()}-${Math.random()}`;
            root.setAttribute("data-crawler-cookie-consent-root", marker);
            element.setAttribute("data-crawler-cookie-consent-button", marker);
            return { marker };
        }

        return null;
    });

    if (!consent) {
        return false;
    }

    await page.locator(
        `[data-crawler-cookie-consent-button="${consent.marker}"]`
    ).click();
    await page.waitForFunction(marker => {
        const root = document.querySelector(
            `[data-crawler-cookie-consent-root="${marker}"]`
        );
        if (!root) {
            return true;
        }

        const style = window.getComputedStyle(root);
        return (
            style.display === "none" ||
            style.visibility === "hidden" ||
            root.getAttribute("aria-hidden") === "true" ||
            Number.parseFloat(style.opacity) === 0 ||
            root.getClientRects().length === 0
        );
    }, consent.marker, { timeout: 10000 });

    console.log("Cookie consent accepted.");
    return true;
}

module.exports = {
    acceptCookieConsent
};
