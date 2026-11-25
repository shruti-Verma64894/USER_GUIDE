const ADMIN_CHROME_SELECTORS = [
    "#controlMenu",
    "#_com_liferay_product_navigation_product_menu_web_portlet_ProductMenuPortlet_sidenavSliderId",
    "[aria-label='Product Menu']"
];

const VISIBLE_PRODUCT_MENU = [
    "#_com_liferay_product_navigation_product_menu_web_portlet_ProductMenuPortlet_sidenavSliderId:visible",
    "[aria-label='Product Menu']:visible"
].join(", ");

async function closeAdminProductMenuIfOpen(page) {
    const productMenu = page.locator(VISIBLE_PRODUCT_MENU).first();
    if (!await productMenu.isVisible()) {
        return false;
    }

    const closeButton = page.locator(".sidenav-close:visible").first();
    if (!await closeButton.count()) {
        throw new Error(
            "Admin: Product Menu is open but its close control is not visible."
        );
    }

    await closeButton.click();
    await productMenu.waitFor({ state: "hidden", timeout: 10000 });
    return true;
}

module.exports = {
    ADMIN_CHROME_SELECTORS,
    closeAdminProductMenuIfOpen
};
