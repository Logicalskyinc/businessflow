
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
        console.error("BusinessFlow: No dashboard pages found.");
        return;
    }

    function showPage(pageId) {
        const target = document.getElementById(pageId);

        if (!target || !target.classList.contains("page")) return;

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

        if (sidebar) sidebar.classList.remove("mobile-open");

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

    const initialPage = window.location.hash.slice(1);

    showPage(
        initialPage &&
        document.getElementById(initialPage) &&
        document.getElementById(initialPage).classList.contains("page")
            ? initialPage
            : "overview"
    );

    if (sidebar && topbar) {
        const breadcrumb = topbar.querySelector(".breadcrumb");

        if (
            breadcrumb &&
            !document.getElementById("mobile-menu-button")
        ) {
            const menu = document.createElement("button");

            menu.type = "button";
            menu.id = "mobile-menu-button";
            menu.className = "menu-button";
            menu.textContent = "☰";
            menu.setAttribute("aria-label", "Toggle navigation");
            menu.setAttribute("aria-expanded", "false");

            breadcrumb.parentNode.insertBefore(menu, breadcrumb);

            menu.addEventListener("click", function () {
                const open = sidebar.classList.toggle("mobile-open");
                menu.setAttribute("aria-expanded", String(open));
            });

            navigationLinks.forEach(function (link) {
                link.addEventListener("click", function () {
                    menu.setAttribute("aria-expanded", "false");
                });
            });
        }
    }

    function readGoals() {
        try {
            const value = window.localStorage.getItem(STORAGE_KEY);

            if (!value) return [];

            const parsed = JSON.parse(value);

            if (!Array.isArray(parsed)) {
                throw new Error("Stored goals are not an array.");
            }

            return parsed.filter(function (goal) {
                return goal && typeof goal.name === "string";
            });
        } catch (error) {
            console.error("BusinessFlow: Cannot read goals.", error);
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

        const percentage = document.createElement("span");
        percentage.textContent = "0%";

        header.append(title, percentage);

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

        return item;
    }

    function displayGoals() {
        if (!goalList) {
            console.error(
                "BusinessFlow: #goal-list was not found in index.html."
            );
            return;
        }

        goalList.replaceChildren();

        const goals = readGoals();

        goals.forEach(function (goal) {
            goalList.appendChild(renderGoal(goal));
        });

        console.info(
            "BusinessFlow: Rendered " + goals.length + " saved goal(s)."
        );
    }

    function createGoal() {
        if (!goalList) {
            window.alert(
                "Goal list is missing. The dashboard HTML needs checking."
            );
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

            const savedValue = window.localStorage.getItem(STORAGE_KEY);

            if (!savedValue) {
                throw new Error("Browser storage returned no saved value.");
            }

            const verifiedGoals = JSON.parse(savedValue);

            if (!Array.isArray(verifiedGoals)) {
                throw new Error("Saved goals could not be verified.");
            }

            goalList.appendChild(renderGoal({
                name: name
            }));

            window.alert(
                "Goal saved and displayed: " + name +
                ". Browser storage confirmed. Cloud sync is not connected."
            );

            console.info("BusinessFlow: Goal saved and displayed.", name);
        } catch (error) {
            console.error("BusinessFlow: Goal save failed.", error);

            goalList.appendChild(renderGoal({
                name: name
            }));

            window.alert(
                "Your goal was added to the current page, but saving " +
                "failed. Check browser storage settings."
            );
        }
    }

    if (goalButton) {
        goalButton.addEventListener("click", createGoal);
    } else {
        console.error(
            "BusinessFlow: #goal-button was not found in index.html."
        );
    }

    displayGoals();

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

        [
            ["revenue-value", report.revenue],
            ["customers-value", report.customers],
            ["conversion-value", report.conversion],
            ["experiments-value", report.experiments]
        ].forEach(function (entry) {
            const element = document.getElementById(entry[0]);
            if (element) element.textContent = entry[1];
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
