
const fs = require("fs");
const path = require("path");

function slugify(text) {
    return String(text || "untitled")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "untitled";
}

function createPageFolder(outputRoot, siteId, pageNumber, pageTitle) {
    const pageSlug = slugify(pageTitle);

    const folderName =
        `${String(pageNumber).padStart(3, "0")}-${pageSlug}`;

    const pageFolder = path.join(
        outputRoot,
        siteId,
        "pages",
        folderName
    );

    fs.mkdirSync(pageFolder, { recursive: true });

    return pageFolder;
}

function savePageJson(pageFolder, pageData) {
    const jsonPath = path.join(pageFolder, "page.json");

    fs.writeFileSync(
        jsonPath,
        JSON.stringify(pageData, null, 2),
        "utf8"
    );

    console.log(`JSON saved: ${jsonPath}`);

    return jsonPath;
}

function getScreenshotPath(pageFolder) {
    return path.join(pageFolder, "screenshot.png");
}

function savePageOutput({
    outputRoot,
    siteId,
    pageNumber,
    pageData
}) {
    const pageTitle =
        pageData.pageInfo?.title || `page-${pageNumber}`;

    const pageFolder = createPageFolder(
        outputRoot,
        siteId,
        pageNumber,
        pageTitle
    );

    const jsonPath = savePageJson(pageFolder, pageData);

    return {
        pageFolder,
        jsonPath,
        screenshotPath: getScreenshotPath(pageFolder)
    };
}

module.exports = {
    savePageOutput
};
