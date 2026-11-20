
const fs = require("fs");
const path = require("path");

function isTimeoutError(error) {
    return error && error.name === "TimeoutError";
}

async function waitForPageReady(page) {
    // The crawler may navigate only until domcontentloaded; wait for the full
    // document load before extracting data or taking a screenshot.
    await page.waitForLoadState("load", {
        timeout: 30000
    });

    const currentUrl = page.url();
    const pathname = new URL(currentUrl).pathname;

    const isDataListingPage = /^\/data\/[^/]+\/?$/.test(pathname);
    const isDataDetailPage =
        /^\/data\/[^/]+\/[^/]+(?:\/[^/]+)?\/?$/.test(pathname);

    if (isDataListingPage) {
        console.log(`Data page detected: ${currentUrl}`);
        console.log("Waiting for table data to load...");

        // Poll table readiness directly so unrelated requests cannot delay capture.
        let tableReady = true;
        try {
            await page.waitForFunction(() => {
                const table = document.querySelector(
                    "#listView table#DataTables_Table_0"
                );
                const tableContainer = table?.closest(".nlTableContainer");

                const loader = tableContainer?.querySelector(".main-loader");
                const info = tableContainer?.querySelector(".table-info-display");

                if (!table || !tableContainer || !info) {
                    return false;
                }

                // Check whether loader is hidden.
                const loaderHidden = !loader ||
                    loader.classList.contains("d-none") ||
                    window.getComputedStyle(loader).display === "none";

                // Check whether actual rows have been populated.
                const rows = table.querySelectorAll("tbody tr");

                const hasActualData = Array.from(rows).some(row =>
                    Array.from(row.cells).some(cell =>
                        cell.innerText.trim().length > 0
                    )
                );

                // Check whether table entry information is populated.
                const infoText = info.innerText.trim();

                const hasEntryInfo =
                    /Showing\s+\d+\s+to\s+\d+\s+of\s+[\d,]+\s+entries/i
                        .test(infoText);

                return (
                    loaderHidden &&
                    rows.length > 0 &&
                    hasActualData &&
                    hasEntryInfo
                );

            }, {
                timeout: 45000
            });
        } catch (error) {
            if (!isTimeoutError(error)) {
                throw error;
            }
            tableReady = false;
            console.warn(
                "Table data did not finish loading before the timeout. " +
                "Capturing the fully loaded page as-is."
            );
        }

        if (tableReady) {
            console.log("Table data loaded successfully.");
        }
    } else if (isDataDetailPage) {
        console.log(`Data detail page detected: ${currentUrl}`);
        console.log("Waiting for detail data to load...");

        try {
            await page.waitForFunction(() => {
                const skeleton = document.querySelector(".page-skeleton");

                if (!skeleton) {
                    return true;
                }

                const style = window.getComputedStyle(skeleton);

                return (
                    style.display === "none" ||
                    style.visibility === "hidden" ||
                    Number.parseFloat(style.opacity) === 0 ||
                    skeleton.getClientRects().length === 0
                );
            }, {
                timeout: 45000
            });
            console.log("Detail page data loaded successfully.");
        } catch (error) {
            if (!isTimeoutError(error)) {
                throw error;
            }
            console.warn(
                "Detail page data did not finish loading before the timeout. " +
                "Capturing the fully loaded page as-is."
            );
        }
    }
}

async function saveScreenshot(page, destination) {
    const directory = path.dirname(destination);

    // Create screenshot folder if it does not exist.
    fs.mkdirSync(directory, { recursive: true });

    // The full page readiness check runs before extraction in the crawler.
    // Keep this guard for screenshots captured by other callers.
    await page.waitForLoadState("load", {
        timeout: 30000
    });

    // Capture screenshot.
    await page.screenshot({
        path: destination,
        fullPage: false,
        animations: "disabled"
    });

    console.log(`Screenshot saved: ${destination}`);
}

module.exports = {
    waitForPageReady,
    saveScreenshot
};
