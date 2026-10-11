
"use strict";

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

    const GOALS_STORAGE_KEY = "businessflow-goals-v1";

    if (!pages.length || !sidebar || !topbar) {
        console.error(
            "BusinessFlow could not initialize. Check index.html."
        );
        return;
    }

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

        sidebar.classList.remove("mobile-open");

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

    const initialPageId = window.location.hash.slice(1);

    if (
        initialPageId &&
        document.getElementById(initialPageId)?.classList.contains("page")
    ) {
        showPage(initialPageId);
    } else {
        showPage("overview");
    }

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

    function createGoalElement(goalName) {
        const goalItem = document.createElement("div");
        goalItem.className = "goal-item";

        const goalTop = document.createElement("div");
        goalTop.className = "goal-top";

        const title = document.createElement("strong");
        title.textContent = goalName;

        const percentage = document.createElement("span");
        percentage.textContent = "0%";

        goalTop.append(title, percentage);

        const progressTrack = document.createElement("div");
        progressTrack.className = "progress-track";
        progressTrack.setAttribute(
            "aria-label",
            "Goal progress: 0%"
        );

        const progressFill = document.createElement("div");
        progressFill.className = "progress-fill";
        progressFill.style.width = "0%";

        progressTrack.appendChild(progressFill);

        const note = document.createElement("small");
        note.textContent =
            "New goal · Progress updates are not connected yet.";

        goalItem.append(goalTop, progressTrack, note);

        return goalItem;
    }

    function loadSavedGoals() {
        if (!goalList) {
            return;
        }

        try {
            const storedGoals = window.localStorage.getItem(
                GOALS_STORAGE_KEY
            );

            if (!storedGoals) {
                return;
            }

            const goals = JSON.parse(storedGoals);

            if (!Array.isArray(goals)) {
                console.error("Saved goals data is invalid.");
                return;
            }

            goals.forEach((goal) => {
                if (
                    goal &&
                    typeof goal.name === "string" &&
                    goal.name.trim()
                ) {
                    goalList.appendChild(
                        createGoalElement(goal.name.trim())
                    );
                }
            });
        } catch (error) {
            console.warn(
                "Saved goals could not be loaded.",
                error
            );
        }
    }

    function createGoal() {
        if (!goalList) {
            window.alert("The goal list could not be found.");
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

        const newGoal = {
            name: cleanGoalName,
            createdAt: new Date().toISOString()
        };

        let savedSuccessfully = false;

        try {
            const storedGoals = window.localStorage.getItem(
                GOALS_STORAGE_KEY
            );

            const goals = storedGoals
                ? JSON.parse(storedGoals)
                : [];

            if (!Array.isArray(goals)) {
                throw new Error("Saved goals data is invalid.");
            }

            goals.push(newGoal);

            window.localStorage.setItem(
                GOALS_STORAGE_KEY,
                JSON.stringify(goals)
            );

            savedSuccessfully = true;
        } catch (error) {
            console.warn("Goal could not be saved locally.", error);
        }

        goalList.appendChild(createGoalElement(cleanGoalName));

        if (savedSuccessfully) {
            window.alert(
                "Goal added and saved in this browser on this device. " +
                "Cloud sync and progress tracking are not connected yet."
            );
        } else {
            window.alert(
                "Goal added to the current page, but browser storage " +
                "was unavailable. It may disappear when you reload."
            );
        }
    }

    loadSavedGoals();

    if (goalButton) {
        goalButton.addEventListener("click", createGoal);
    }

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
                `Illustrative ${periodLabel} sample data. ` +
                "No live data connected.";
        }
    }

    if (periodSelect) {
        periodSelect.addEventListener("change", () => {
            updateReport(periodSelect.value);
        });

        updateReport(periodSelect.value);
    }

    console.info(
        "BusinessFlow prototype initialized. Sample data only."
    );
});
