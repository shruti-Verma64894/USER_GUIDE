
function normalizeUrl(url, site, crawlerConfig) {
    try {
        const parsedUrl = new URL(url);

        // Allow only HTTP and HTTPS URLs.
        if (!["http:", "https:"].includes(parsedUrl.protocol)) {
            return null;
        }

        // Allow only URLs belonging to the starting website's domain.
        if (
            crawlerConfig.sameDomainOnly &&
            parsedUrl.hostname !== site.parsedStartUrl.hostname
        ) {
            return null;
        }

        // Remove URL fragments.
        parsedUrl.hash = "";

        // Remove configured tracking parameters.
        const ignoredParameters =
            crawlerConfig.ignoredQueryParameters || [];

        for (const parameter of ignoredParameters) {
            parsedUrl.searchParams.delete(parameter);
        }

        const pathSegments = parsedUrl.pathname
            .split("/")
            .filter(Boolean);

        if (
            pathSegments.length === 4 &&
            pathSegments[0].toLowerCase() === "data" &&
            pathSegments[1].toLowerCase() === "wage-determination"
        ) {
            parsedUrl.pathname = `/${pathSegments.slice(0, 3).join("/")}`;
        }

        // Remove trailing slash except for homepage.
        if (parsedUrl.pathname !== "/") {
            parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/, "");
        }

        return parsedUrl.href;

    } catch {
        return null;
    }
}

function getDataDetailEndpoint(url) {
    try {
        const segments = new URL(url).pathname
            .split("/")
            .filter(Boolean);

        if (
            segments.length === 3 &&
            segments[0].toLowerCase() === "data"
        ) {
            return segments[1];
        }

        return null;
    } catch {
        return null;
    }
}

function getClientIdDetailEndpoint(url) {
    try {
        const parsedUrl = new URL(url);
        const segments = parsedUrl.pathname
            .split("/")
            .filter(Boolean);

        if (segments.length !== 1) {
            return null;
        }

        const hasIdParameter = Array.from(
            parsedUrl.searchParams.entries()
        ).some(([name, value]) => {
            const isIdParameter =
                /^id$/i.test(name) ||
                /(?:Id|ID)$/.test(name) ||
                /(?:_|-)id$/i.test(name);

            return isIdParameter && value.trim().length > 0;
        });

        return hasIdParameter ? segments[0].toLowerCase() : null;
    } catch {
        return null;
    }
}

function isWageDeterminationDetailUrl(url) {
    try {
        const segments = new URL(url).pathname
            .split("/")
            .filter(Boolean);

        return (
            (segments.length === 3 || segments.length === 4) &&
            segments[0].toLowerCase() === "data" &&
            segments[1].toLowerCase() === "wage-determination"
        );
    } catch {
        return false;
    }
}

function isLogoutLink(link) {
    const text = [
        link.text,
        link.href,
        link.title,
        link.ariaLabel
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

    return /\b(logout|log out|signout|sign out|logoff|log off)\b/i.test(text);
}

function isLoginLink(link) {
    const text = [
        link.text,
        link.href,
        link.title,
        link.ariaLabel
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

    return /\b(log[\s_-]*in|sign[\s_-]*in)\b/i.test(text);
}

module.exports = {
    normalizeUrl,
    getDataDetailEndpoint,
    getClientIdDetailEndpoint,
    isWageDeterminationDetailUrl,
    isLogoutLink,
    isLoginLink
};
