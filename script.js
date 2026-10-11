
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

    if (
        initialPage &&
        document.getElementById(initialPage) &&
        document.getElementById(initialPage).classList.contains("page")
    ) {
        showPage(initialPage);
    } else {
        showPage("overview");
    }

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
            const stored = window.localStorage.getItem(STORAGE_KEY);

            if (!stored) return [];

            const goals = JSON.parse(stored);

            if (!Array.isArray(goals)) {
                throw new Error("Saved goals are not a list.");
            }

            return goals.filter(function (goal) {
                return goal && typeof goal.name === "string";
            }).map(function (goal) {
                return {
                    name: goal.name,
                    createdAt: goal.createdAt || "",
                    completed: goal.completed === true
                };
            });
        } catch (error) {
            console.error("BusinessFlow: Could not read goals.", error);
            return [];
        }
    }

    function saveGoals(goals) {
        try {
            window.localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify(goals)
            );
            return true;
        } catch (error) {
            console.error("BusinessFlow: Could not save goals.", error);
            return false;
        }
    }

    function renderGoal(goal, index) {
        const completed = goal.completed === true;
        const item = document.createElement("div");
        item.className = "goal-item";

        const header = document.createElement("div");
        header.className = "goal-top";

        const title = document.createElement("strong");
        title.textContent = goal.name;

        if (completed) {
            title.style.textDecoration = "line-through";
        }

        const percentage = document.createElement("span");
        percentage.textContent = completed ? "100%" : "0%";

        header.append(title, percentage);

        const track = document.createElement("div");
        track.className = "progress-track";
        track.setAttribute(
            "aria-label",
            "Goal progress: " + (completed ? "100%" : "0%")
        );

        const fill = document.createElement("div");
        fill.className = "progress-fill";
        fill.style.width = completed ? "100%" : "0%";

        track.appendChild(fill);

        const status = document.createElement("small");
        status.textContent = completed
            ? "Completed"
            : "In progress";

        const toggleButton = document.createElement("button");
        toggleButton.type = "button";
        toggleButton.className = "goal-complete-button";
        toggleButton.textContent = completed
            ? "Mark as in progress"
            : "Mark as completed";
        toggleButton.setAttribute(
            "aria-pressed",
            String(completed)
        );

        toggleButton.style.marginTop = "10px";
        toggleButton.style.padding = "8px 12px";
        toggleButton.style.borderRadius = "8px";
        toggleButton.style.border = "1px solid #cbd5e1";
        toggleButton.style.cursor = "pointer";
        toggleButton.style.fontSize = "14px";

        toggleButton.addEventListener("click", function () {
            const goals = readGoals();

            if (!goals[index]) {
                window.alert(
                    "This goal could not be found. Please refresh the page."
                );
                return;
            }

            goals[index].completed = !goals[index].completed;

            if (!saveGoals(goals)) {
                window.alert(
                    "The status could not be saved. " +
                    "Your browser storage may be unavailable."
                );
                return;
            }

            displayGoals();
        });

        item.append(header, track, status, toggleButton);

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

        goals.forEach(function (goal, index) {
            goalList.appendChild(renderGoal(goal, index));
        });

        console.info(
            "BusinessFlow: Displayed " + goals.length + " goal(s)."
        );
    }

    function createGoal() {
        if (!goalList) {
            window.alert("The dashboard goal list could not be found.");
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
            createdAt: new Date().toISOString(),
            completed: false
        });

        if (!saveGoals(goals)) {
            window.alert(
                "The goal could not be saved in browser storage."
            );
            return;
        }

        displayGoals();

        window.alert(
            "Goal created: " + name +
            ". You can now mark it as completed when you achieve it."
        );
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

            if (element) {
                element.textContent = entry[1];
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
        "BusinessFlow initialized. Analytics figures are sample data."
    );
});
