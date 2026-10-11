
"use strict";

/*
 * BusinessFlow frontend prototype
 * Organization: HackyTech Digitals
 *
 * Current scope:
 * - Dashboard page navigation
 * - Mobile sidebar toggle
 * - Goal creation in the browser
 * - Illustrative reporting-period figures
 *
 * Important:
 * All figures are sample data. No backend or live business
 * integrations are connected yet.
 */

document.addEventListener("DOMContentLoaded", () => {
    const pages = document.querySelectorAll(".page");
    const navigationLinks = document.querySelectorAll(
        '.nav-link[data-page]'
    );
    const currentSection = document.getElementById("current-section");
    const goalButton = document.getElementById("goal-button");
    const goalList = document.getElementById("goal-list");
    const periodSelect = document.getElementById("period-select");
    const sidebar = document.querySelector(".sidebar");
    const topbar = document.querySelector(".topbar");

    // Stop safely if the expected HTML structure is missing.
    if (!pages.length || !sidebar || !topbar) {
        console.error(
            "BusinessFlow could not initialize. Check index.html."
        );
        return;
    }

    // --------------------------------------------------
    // 1. Page navigation
    // --------------------------------------------------

    function showPage(pageId) {
        const targetPage = document.getElementById(pageId);

        if (!targetPage || !targetPage.classList.contains("page")) {
            return;
        }

        pages.forEach((page) => {
            page.classList.toggle("active", page.id === pageId);
        });

        navigationLinks.forEach((link) => {
            const isActive = link.dataset.page === pageId;

            link.classList.toggle("active", isActive);

            if (isActive) {
                link.setAttribute("aria-current", "page");
            } else {
                link.removeAttribute("aria-current");
            }
        });

        if (currentSection) {
            const activeLink = document.querySelector(
                `.nav-link[data-page="${pageId}"]`
            );

            currentSection.textContent = activeLink
                ? activeLink.textContent.trim()
                : targetPage.querySelector("h1")?.textContent.trim()
                    || "Workspace";
        }

        // Close the mobile sidebar after selecting a page.
        sidebar.classList.remove("mobile-open");

        // Keep the URL in sync with the selected page.
        if (window.location.hash !== `#${pageId}`) {
            window.history.replaceState(null, "", `#${pageId}`);
        }
    }

    navigationLinks.forEach((link) => {
        link.addEventListener("click", (event) => {
            const pageId = link.dataset.page;

            if (!pageId) {
                return;
            }

            event.preventDefault();
            showPage(pageId);
        });
    });

    // Open the correct page if the URL already has a valid hash.
    const initialPageId = window.location.hash.slice(1);

    if (
        initialPageId &&
        document.getElementById(initialPageId)?.classList.contains("page")
    ) {
        showPage(initialPageId);
    } else {
        showPage("overview");
    }

    // --------------------------------------------------
    // 2. Mobile navigation button
    // --------------------------------------------------

    if (sidebar && topbar) {
        const breadcrumb = topbar.querySelector(".breadcrumb");

        if (breadcrumb && !document.getElementById("mobile-menu-button")) {
            const menuButton = document.createElement("button");

            menuButton.type = "button";
            menuButton.id = "mobile-menu-button";
            menuButton.className = "menu-button";
            menuButton.textContent = "☰";
            menuButton.setAttribute("aria-label", "Toggle navigation");
            menuButton.setAttribute("aria-expanded", "false");

            breadcrumb.parentNode.insertBefore(menuButton, breadcrumb);

            menuButton.addEventListener("click", () => {
                const isOpen = sidebar.classList.toggle("mobile-open");

                menuButton.setAttribute(
                    "aria-expanded",
                    String(isOpen)
                );
            });

            navigationLinks.forEach((link) => {
                link.addEventListener("click", () => {
                    menuButton.setAttribute("aria-expanded", "false");
                });
            });
        }
    }

    // --------------------------------------------------
    // 3. Create a goal
    // --------------------------------------------------

    function createGoal() {
        if (!goalList) {
            console.error("Goal list was not found in index.html.");
            return;
        }

        const goalName = window.prompt(
            "What business goal do you want to create?"
        );

        if (goalName === null) {
            return;
        }

        const cleanGoalName = goalName.trim();

        if (!cleanGoalName) {
            window.alert("Please enter a goal name.");
            return;
        }

        const goalItem = document.createElement("div");
        goalItem.className = "goal-item";

        const goalTop = document.createElement("div");
        goalTop.className = "goal-top";

        const title = document.createElement("strong");
        title.textContent = cleanGoalName;

        const percentage = document.createElement("span");
        percentage.textContent = "0%";

        goalTop.append(title, percentage);

        const progressTrack = document.createElement("div");
        progressTrack.className = "progress-track";
        progressTrack.setAttribute("aria-label", "Goal progress: 0%");

        const progressFill = document.createElement("div");
        progressFill.className = "progress-fill";
        progressFill.style.width = "0%";

        progressTrack.appendChild(progressFill);

        const note = document.createElement("small");
        note.textContent =
            "New goal · Progress tracking is not connected yet.";

        goalItem.append(goalTop, progressTrack, note);
        goalList.appendChild(goalItem);

        window.alert(
            "Goal added to this page. It is temporary and will be lost when the page reloads."
        );
    }

    if (goalButton) {
        goalButton.addEventListener("click", createGoal);
    }

    // --------------------------------------------------
    // 4. Illustrative reporting-period figures
    // --------------------------------------------------

    const sampleReports = {
        "7": {
            revenue: "₦2,450,000",
            customers: "184",
            conversion: "4.8%",
            experiments: "3"
        },
        "30": {
            revenue: "₦8,900,000",
            customers: "612",
            conversion: "4.5%",
            experiments: "5"
        },
        "90": {
            revenue: "₦25,700,000",
            customers: "1,740",
            conversion: "4.2%",
            experiments: "8"
        }
    };

    function updateReport(period) {
        const report = sampleReports[period];

        if (!report) {
            return;
        }

        const revenue = document.getElementById("revenue-value");
        const customers = document.getElementById("customers-value");
        const conversion = document.getElementById("conversion-value");
        const experiments = document.getElementById("experiments-value");

        if (revenue) revenue.textContent = report.revenue;
        if (customers) customers.textContent = report.customers;
        if (conversion) conversion.textContent = report.conversion;
        if (experiments) experiments.textContent = report.experiments;

        const chartDisclaimer = document.querySelector(".chart-disclaimer");

        if (chartDisclaimer) {
            const periodLabel = period === "7"
                ? "7 days"
                : period === "30"
                    ? "30 days"
                    : "90 days";

            chartDisclaimer.textContent =
                `Illustrative ${periodLabel} sample data. No live data connected.`;
        }
    }

    if (periodSelect) {
        periodSelect.addEventListener("change", () => {
            updateReport(periodSelect.value);
        });

        updateReport(periodSelect.value);
    }

    // --------------------------------------------------
    // 5. Prototype initialization
    // --------------------------------------------------

    console.info(
        "BusinessFlow prototype initialized. Sample data only."
    );
});
