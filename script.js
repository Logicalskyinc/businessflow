
"use strict";

document.addEventListener("DOMContentLoaded", function () {
    const pages = document.querySelectorAll(".page");
    const navigationLinks = document.querySelectorAll(
        '.nav-link[data-page]'
    );
    const sidebar = document.querySelector(".sidebar");
    const topbar = document.querySelector(".topbar");
    const currentSection = document.getElementById("current-section");
    const goalButton = document.getElementById("goal-button");
    const goalList = document.getElementById("goal-list");
    const periodSelect = document.getElementById("period-select");

    const STORAGE_KEY = "businessflow-goals-v1";

    if (!pages.length) {
        console.error("BusinessFlow: No dashboard pages were found.");
        return;
    }

    function showPage(pageId) {
        const target = document.getElementById(pageId);

        if (!target || !target.classList.contains("page")) {
            return;
        }

        pages.forEach(function (page) {
            page.classList.toggle("active", page.id === pageId);
        });

        navigationLinks.forEach(function (link) {
            const active = link.dataset.page === pageId;

            link.classList.toggle("active", active);

            if (active) {
                link.setAttribute("aria-current", "page");
            } else {
                link.removeAttribute("aria-current");
            }
        });

        if (currentSection) {
            const activeLink = document.querySelector(
                '.nav-link[data-page="' + pageId + '"]'
            );

            currentSection.textContent = activeLink
                ? activeLink.textContent.trim()
                : "Workspace";
        }

        if (sidebar) {
            sidebar.classList.remove("mobile-open");
        }

        if (window.location.hash !== "#" + pageId) {
            window.history.replaceState(null, "", "#" + pageId);
        }
    }

    navigationLinks.forEach(function (link) {
        link.addEventListener("click", function (event) {
            const pageId = link.dataset.page;

            if (!pageId) return;

            event.preventDefault();
            showPage(pageId);
        });
    });

    const startingPage = window.location.hash.slice(1);

    if (
        startingPage &&
        document.getElementById(startingPage) &&
        document.getElementById(startingPage).classList.contains("page")
    ) {
        showPage(startingPage);
    } else {
        showPage("overview");
    }

    if (sidebar && topbar) {
        const breadcrumb = topbar.querySelector(".breadcrumb");

        if (
            breadcrumb &&
            !document.getElementById("mobile-menu-button")
        ) {
            const menuButton = document.createElement("button");

            menuButton.type = "button";
            menuButton.id = "mobile-menu-button";
            menuButton.className = "menu-button";
            menuButton.textContent = "☰";
            menuButton.setAttribute(
                "aria-label",
                "Toggle navigation"
            );
            menuButton.setAttribute("aria-expanded", "false");

            breadcrumb.parentNode.insertBefore(
                menuButton,
                breadcrumb
            );

            menuButton.addEventListener("click", function () {
                const open = sidebar.classList.toggle("mobile-open");

                menuButton.setAttribute(
                    "aria-expanded",
                    String(open)
                );
            });

            navigationLinks.forEach(function (link) {
                link.addEventListener("click", function () {
                    menuButton.setAttribute(
                        "aria-expanded",
                        "false"
                    );
                });
            });
        }
    }

    function readGoals() {
        try {
            const raw = window.localStorage.getItem(STORAGE_KEY);

            if (!raw) return [];

            const parsed = JSON.parse(raw);

            if (!Array.isArray(parsed)) {
                console.error("BusinessFlow: Saved goals are invalid.");
                return [];
            }

            return parsed.filter(function (goal) {
                return (
                    goal &&
                    typeof goal.name === "string" &&
                    goal.name.trim() !== ""
                );
            });
        } catch (error) {
            console.error(
                "BusinessFlow: Could not read saved goals.",
                error
            );
            return [];
        }
    }

    function renderGoal(goal) {
        const item = document.createElement("div");
        item.className = "goal-item";

        const header = document.createElement("div");
        header.className = "goal-top";

        const title = document.createElement("strong");
        title.textContent = goal.name;

        const percent = document.createElement("span");
        percent.textContent = "0%";

        header.append(title, percent);

        const track = document.createElement("div");
        track.className = "progress-track";
        track.setAttribute("aria-label", "Goal progress: 0%");

        const fill = document.createElement("div");
        fill.className = "progress-fill";
        fill.style.width = "0%";

        track.appendChild(fill);

        const note = document.createElement("small");
        note.textContent =
            "Saved locally · Progress tracking is not connected.";

        item.append(header, track, note);
        goalList.appendChild(item);
    }

    function displaySavedGoals() {
        if (!goalList) {
            console.error(
                "BusinessFlow: Could not find the element with id goal-list."
            );
            return;
        }

        goalList.replaceChildren();

        readGoals().forEach(function (goal) {
            renderGoal(goal);
        });
    }

    function createGoal() {
        if (!goalList) {
            window.alert(
                "The goal list is missing from the dashboard HTML."
            );
            console.error("Missing element: #goal-list");
            return;
        }

        const answer = window.prompt(
            "What business goal do you want to create?"
        );

        if (answer === null) return;

        const name = answer.trim();

        if (!name) {
            window.alert("Please enter a goal name.");
            return;
        }

        const goals = readGoals();

        goals.push({
            name: name,
            createdAt: new Date().toISOString()
        });

        try {
            window.localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify(goals)
            );

            displaySavedGoals();

            window.alert(
                "Goal saved in this browser on this device. " +
                "Cloud sync and progress tracking are not connected."
            );
        } catch (error) {
            console.error(
                "BusinessFlow: Could not save the goal.",
                error
            );

            renderGoal({ name: name });

            window.alert(
                "The goal was added to this page, but browser storage " +
                "failed. It may disappear after refreshing."
            );
        }
    }

    if (goalButton) {
        goalButton.addEventListener("click", createGoal);
    } else {
        console.error(
            "BusinessFlow: Create a goal button (#goal-button) was not found."
        );
    }

    displaySavedGoals();

    const reports = {
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
        const report = reports[period];

        if (!report) return;

        const fields = [
            ["revenue-value", report.revenue],
            ["customers-value", report.customers],
            ["conversion-value", report.conversion],
            ["experiments-value", report.experiments]
        ];

        fields.forEach(function (field) {
            const element = document.getElementById(field[0]);

            if (element) {
                element.textContent = field[1];
            }
        });

        const disclaimer = document.querySelector(".chart-disclaimer");

        if (disclaimer) {
            const label = period === "7"
                ? "7 days"
                : period === "30"
                    ? "30 days"
                    : "90 days";

            disclaimer.textContent =
                "Illustrative " + label +
                " sample data. No live data connected.";
        }
    }

    if (periodSelect) {
        periodSelect.addEventListener("change", function () {
            updateReport(periodSelect.value);
        });

        updateReport(periodSelect.value);
    }

    console.info(
        "BusinessFlow initialized. Dashboard figures are sample data."
    );
});
