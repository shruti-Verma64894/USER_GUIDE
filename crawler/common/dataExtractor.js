
async function extractPageData(page, options = {}) {
    return await page.evaluate((evaluationOptions) => {
        const excludedSelectors = Array.isArray(evaluationOptions?.excludeSelectors)
            ? evaluationOptions.excludeSelectors
            : [];

        function isExcluded(element) {
            return excludedSelectors.some(selector => {
                try {
                    return element.matches(selector) || element.closest(selector);
                } catch {
                    return false;
                }
            });
        }

        function getVisibleElements(selector) {
            return Array.from(document.querySelectorAll(selector))
                .filter(element => !isExcluded(element));
        }

        // Helper: Get clean text from an element.
        function getText(element) {
            return element?.innerText
                ?.replace(/\s+/g, " ")
                .trim() || "";
        }

        // Helper: Get an element's useful attributes.
        function getAttributes(element) {
            return {
                id: element.id || null,
                className: typeof element.className === "string"
                    ? element.className
                    : null,
                role: element.getAttribute("role"),
                ariaLabel: element.getAttribute("aria-label"),
                title: element.getAttribute("title")
            };
        }

        // 1. PAGE INFORMATION
        const pageInfo = {
            url: window.location.href,
            title: document.title,
            language: document.documentElement.lang || null,
            lastModified: document.lastModified
        };

        // 2. SEO INFORMATION
        const seo = {
            description:
                document.querySelector('meta[name="description"]')
                    ?.content || null,

            keywords:
                document.querySelector('meta[name="keywords"]')
                    ?.content || null,

            author:
                document.querySelector('meta[name="author"]')
                    ?.content || null,

            canonical:
                document.querySelector('link[rel="canonical"]')
                    ?.href || null,

            robots:
                document.querySelector('meta[name="robots"]')
                    ?.content || null,

            openGraph: {
                title:
                    document.querySelector('meta[property="og:title"]')
                        ?.content || null,

                description:
                    document.querySelector('meta[property="og:description"]')
                        ?.content || null,

                image:
                    document.querySelector('meta[property="og:image"]')
                        ?.content || null,

                url:
                    document.querySelector('meta[property="og:url"]')
                        ?.content || null
            }
        };

        // 3. HEADINGS
        const headings = getVisibleElements("h1, h2, h3, h4, h5, h6").map(element => ({
            tag: element.tagName.toLowerCase(),
            text: getText(element),
            ...getAttributes(element)
        })).filter(item => item.text);

        // 4. PARAGRAPHS
        const paragraphs = getVisibleElements("p").map(element => getText(element))
            .filter(Boolean);

        // 5. NAVIGATION MENUS
        const navigation = getVisibleElements("nav, [role='navigation']").map(nav => ({
            ...getAttributes(nav),
            text: getText(nav),

            links: Array.from(nav.querySelectorAll("a"))
                .filter(link => !isExcluded(link))
                .map(link => ({
                    text: getText(link),
                    href: link.href,
                    ...getAttributes(link)
                }))
        }));

        // 6. PAGE SECTIONS
        const sections = getVisibleElements(
            "main, section, article, [role='main']"
        ).map(element => ({
            tag: element.tagName.toLowerCase(),
            text: getText(element),
            ...getAttributes(element)
        })).filter(section => section.text);

        // 7. ALL LINKS
        const links = getVisibleElements("a[href]").map(link => ({
            text: getText(link),
            href: link.href,
            target: link.target || null,
            rel: link.rel || null,
            ...getAttributes(link)
        }));

        // 8. CLICKABLE ELEMENTS
        const clickableElements = getVisibleElements(
            "button, [role='button'], input[type='button'], " +
            "input[type='submit'], [onclick]"
        ).map(element => {
            const text = getText(element) ||
                element.getAttribute("aria-label") ||
                element.getAttribute("title") || "";
            const normalizedText = text.toLowerCase();
            let purpose = null;

            if (normalizedText.includes("save")) {
                purpose = "Save or submit action; the crawler records this control but does not activate it.";
            } else if (normalizedText.includes("delete")) {
                purpose = "Delete action; the crawler records this control but does not execute deletion.";
            } else if (normalizedText.includes("deactivate")) {
                purpose = "Deactivate action; the crawler records this control but does not execute deactivation.";
            } else if (normalizedText.includes("edit")) {
                purpose = "Edit action; the crawler records this control but does not open an edit workflow.";
            } else if (normalizedText.includes("b2c")) {
                purpose = "B2C navigation; the crawler records this option but does not interact with it.";
            } else if (normalizedText.includes("logout") || normalizedText.includes("log out")) {
                purpose = "Logout control; the crawler records it but never activates it.";
            }

            return {
                tag: element.tagName.toLowerCase(),
                text,
                type: element.getAttribute("type"),
                disabled: element.disabled === true,
                href: element.href || null,
                formAction: element.form?.action || null,
                purpose,
                ...getAttributes(element)
            };
        });

        // 9. FORMS
        const forms = getVisibleElements("form").map(form => ({
            action: form.action || null,
            method: form.method || "get",
            ...getAttributes(form),

            fields: Array.from(
                form.querySelectorAll("input, textarea, select")
            ).filter(field => !isExcluded(field)).map(field => ({
                tag: field.tagName.toLowerCase(),
                type: field.type || null,
                name: field.name || null,
                id: field.id || null,
                placeholder: field.placeholder || null,
                required: field.required === true,
                disabled: field.disabled === true,
                ariaLabel: field.getAttribute("aria-label"),
                label: field.labels
                    ? Array.from(field.labels)
                        .map(label => getText(label))
                        .filter(Boolean)
                    : []
            }))
        }));

        // 10. INPUT FIELDS OUTSIDE OR INSIDE FORMS
        // Never collect field.value.
        const inputs = getVisibleElements("input, textarea, select").map(field => ({
            tag: field.tagName.toLowerCase(),
            type: field.type || null,
            name: field.name || null,
            id: field.id || null,
            placeholder: field.placeholder || null,
            required: field.required === true,
            disabled: field.disabled === true,
            ariaLabel: field.getAttribute("aria-label"),
            ...getAttributes(field)
        }));

        // 11. IMAGES
        const images = getVisibleElements("img").map(image => ({
            src: image.src || null,
            alt: image.alt || null,
            title: image.title || null,
            width: image.naturalWidth || image.width || null,
            height: image.naturalHeight || image.height || null,
            loading: image.loading || null
        }));

        // 12. TABLES
        // Collect table structure and visible cell text.
        // No row selection or record-link filtering.
        const tables = getVisibleElements("table").map((table, tableIndex) => ({
            index: tableIndex + 1,
            ...getAttributes(table),

            headers: Array.from(
                table.querySelectorAll("thead th")
            ).map(header => getText(header)),

            rows: Array.from(
                table.querySelectorAll("tr")
            ).map(row => ({
                cells: Array.from(
                    row.querySelectorAll("th, td")
                ).map(cell => getText(cell))
            })).filter(row => row.cells.length > 0)
        }));

        // 13. ACCESSIBILITY INFORMATION
        const accessibility = {
            landmarks: getVisibleElements(
                "header, nav, main, footer, aside, " +
                "[role='banner'], [role='main'], " +
                "[role='contentinfo'], [role='complementary']"
            ).map(element => ({
                tag: element.tagName.toLowerCase(),
                role: element.getAttribute("role"),
                ariaLabel: element.getAttribute("aria-label"),
                text: getText(element).slice(0, 1000)
            })),

            elementsWithoutAlt: getVisibleElements("img:not([alt])").map(image => ({
                src: image.src || null
            })),

            buttonsWithoutAccessibleName: getVisibleElements("button").filter(button =>
                !getText(button) &&
                !button.getAttribute("aria-label") &&
                !button.getAttribute("title")
            ).map(button => getAttributes(button))
        };

        // 14. STRUCTURED DATA (JSON-LD)
        const structuredData = getVisibleElements(
            'script[type="application/ld+json"]'
        ).map(script => {
            try {
                return JSON.parse(script.textContent);
            } catch {
                return {
                    error: "Invalid JSON-LD data"
                };
            }
        });

        // 15. PAGE TEXT
        const pageTextRoot = document.body.cloneNode(true);
        for (const selector of excludedSelectors) {
            try {
                pageTextRoot.querySelectorAll(selector)
                    .forEach(element => element.remove());
            } catch {}
        }
        const pageText = getText(pageTextRoot);

        // Return all extracted information.
        return {
            pageInfo,
            seo,
            pageText,
            headings,
            paragraphs,
            navigation,
            sections,
            links,
            clickableElements,
            forms,
            inputs,
            images,
            tables,
            accessibility,
            structuredData,
            extractedAt: new Date().toISOString()
        };
    }, options);
}

module.exports = {
    extractPageData
};
