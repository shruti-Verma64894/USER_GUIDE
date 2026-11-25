
const fs = require("fs");
const path = require("path");

function slugify(text) {
    return String(text || "untitled")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "untitled";
}

function createPageFolder(
    outputRoot,
    siteId,
    pageNumber,
    pageTitle,
    outputFolder
) {
    const pageSlug = slugify(pageTitle);

    const folderName =
        `${String(pageNumber).padStart(3, "0")}-${pageSlug}`;

    const pageFolder = path.join(
        outputRoot,
        siteId,
        outputFolder,
        folderName
    );

    fs.mkdirSync(pageFolder, { recursive: true });

    return pageFolder;
}

function savePageJson(pageFolder, pageData) {
    const folderName = path.basename(pageFolder);
    const jsonPath = path.join(pageFolder, `${folderName}.json`);

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
    pageData,
    folderName,
    saveJson = true,
    outputFolder = "pages"
}) {
    const pageTitle =
        pageData.captureLabel ||
        folderName ||
        pageData.pageInfo?.title ||
        `page-${pageNumber}`;

    const pageFolder = createPageFolder(
        outputRoot,
        siteId,
        pageNumber,
        pageTitle,
        outputFolder
    );

    const jsonPath = saveJson
        ? savePageJson(pageFolder, pageData)
        : null;

    return {
        pageFolder,
        jsonPath,
        screenshotPath: getScreenshotPath(pageFolder)
    };
}

module.exports = {
    savePageOutput
};
