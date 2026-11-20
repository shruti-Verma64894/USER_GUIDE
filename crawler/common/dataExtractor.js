
async function extractPageData(page) {
    return await page.evaluate(() => {

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
        const headings = Array.from(
            document.querySelectorAll("h1, h2, h3, h4, h5, h6")
        ).map(element => ({
            tag: element.tagName.toLowerCase(),
            text: getText(element),
            ...getAttributes(element)
        })).filter(item => item.text);

        // 4. PARAGRAPHS
        const paragraphs = Array.from(
            document.querySelectorAll("p")
        ).map(element => getText(element))
            .filter(Boolean);

        // 5. NAVIGATION MENUS
        const navigation = Array.from(
            document.querySelectorAll("nav, [role='navigation']")
        ).map(nav => ({
            ...getAttributes(nav),
            text: getText(nav),

            links: Array.from(nav.querySelectorAll("a"))
                .map(link => ({
                    text: getText(link),
                    href: link.href,
                    ...getAttributes(link)
                }))
        }));

        // 6. PAGE SECTIONS
        const sections = Array.from(
            document.querySelectorAll(
                "main, section, article, [role='main']"
            )
        ).map(element => ({
            tag: element.tagName.toLowerCase(),
            text: getText(element),
            ...getAttributes(element)
        })).filter(section => section.text);

        // 7. ALL LINKS
        const links = Array.from(
            document.querySelectorAll("a[href]")
        ).map(link => ({
            text: getText(link),
            href: link.href,
            target: link.target || null,
            rel: link.rel || null,
            ...getAttributes(link)
        }));

        // 8. CLICKABLE ELEMENTS
        const clickableElements = Array.from(
            document.querySelectorAll(
                "button, [role='button'], input[type='button'], " +
                "input[type='submit'], [onclick]"
            )
        ).map(element => ({
            tag: element.tagName.toLowerCase(),
            text: getText(element) ||
                element.getAttribute("aria-label") ||
                element.getAttribute("title") || "",

            type: element.getAttribute("type"),
            disabled: element.disabled === true,
            ...getAttributes(element)
        }));

        // 9. FORMS
        const forms = Array.from(
            document.querySelectorAll("form")
        ).map(form => ({
            action: form.action || null,
            method: form.method || "get",
            ...getAttributes(form),

            fields: Array.from(
                form.querySelectorAll("input, textarea, select")
            ).map(field => ({
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
        const inputs = Array.from(
            document.querySelectorAll("input, textarea, select")
        ).map(field => ({
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
        const images = Array.from(
            document.querySelectorAll("img")
        ).map(image => ({
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
        const tables = Array.from(
            document.querySelectorAll("table")
        ).map((table, tableIndex) => ({
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
            landmarks: Array.from(
                document.querySelectorAll(
                    "header, nav, main, footer, aside, " +
                    "[role='banner'], [role='main'], " +
                    "[role='contentinfo'], [role='complementary']"
                )
            ).map(element => ({
                tag: element.tagName.toLowerCase(),
                role: element.getAttribute("role"),
                ariaLabel: element.getAttribute("aria-label"),
                text: getText(element).slice(0, 1000)
            })),

            elementsWithoutAlt: Array.from(
                document.querySelectorAll("img:not([alt])")
            ).map(image => ({
                src: image.src || null
            })),

            buttonsWithoutAccessibleName: Array.from(
                document.querySelectorAll("button")
            ).filter(button =>
                !getText(button) &&
                !button.getAttribute("aria-label") &&
                !button.getAttribute("title")
            ).map(button => getAttributes(button))
        };

        // 14. STRUCTURED DATA (JSON-LD)
        const structuredData = Array.from(
            document.querySelectorAll(
                'script[type="application/ld+json"]'
            )
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
        const pageText = getText(document.body);

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
    });
}

module.exports = {
    extractPageData
};
