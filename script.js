
/* BusinessFlow frontend prototype.
   Goals are stored in this browser only.
   No backend or live business data is connected.
*/
"use strict";

const STORAGE_KEY = "businessflow_goals_v1";

const DEFAULT_GOALS = [
  {
    id: "revenue-1000000",
    title: "Increase revenue",
    current: 680000,
    target: 1000000,
    unit: "₦"
  },
  {
    id: "customers-100",
    title: "Acquire customers",
    current: 45,
    target: 100,
    unit: "customers"
  }
];

let goals = [];
let storageAvailable = true;

function escapeHTML(value) {
  const entities = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  };

  return String(value).replace(/[&<>"']/g, char => entities[char]);
}

function showToast(message) {
  let toast = document.querySelector(".toast");

  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.classList.remove("show");
  }, 3000);
}

function updateStorageStatus() {
  document.querySelectorAll("[data-storage-status]").forEach(element => {
    element.textContent = storageAvailable
      ? "Saved locally in this browser · Not synced across devices"
      : "Browser storage unavailable · Changes may not persist";
  });
}

function saveGoals() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(goals));
    storageAvailable = true;
    updateStorageStatus();
    return true;
  } catch (error) {
    storageAvailable = false;
    updateStorageStatus();
    console.error("BusinessFlow could not save goals:", error);
    showToast("Could not save. Browser storage may be unavailable.");
    return false;
  }
}

function isValidGoal(goal) {
  return Boolean(
    goal &&
    typeof goal.id === "string" &&
    typeof goal.title === "string" &&
    goal.title.trim().length > 0 &&
    Number.isFinite(Number(goal.current)) &&
    Number(goal.current) >= 0 &&
    Number.isFinite(Number(goal.target)) &&
    Number(goal.target) > 0 &&
    (goal.unit === undefined || typeof goal.unit === "string")
  );
}

function loadGoals() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);

    if (saved === null) {
      goals = DEFAULT_GOALS.map(goal => ({ ...goal }));
      saveGoals();
      return;
    }

    const parsed = JSON.parse(saved);

    if (!Array.isArray(parsed)) {
      throw new Error("Saved goals must be an array.");
    }

    goals = parsed.filter(isValidGoal).map(goal => ({
      id: goal.id,
      title: goal.title.trim().slice(0, 120),
      current: Number(goal.current),
      target: Number(goal.target),
      unit: typeof goal.unit === "string"
        ? goal.unit.slice(0, 40)
        : "units"
    }));
  } catch (error) {
    storageAvailable = false;
    goals = DEFAULT_GOALS.map(goal => ({ ...goal }));
    console.error("BusinessFlow could not load goals:", error);
  }
}

function getProgress(goal) {
  return Math.min(
    100,
    Math.round((Number(goal.current) / Number(goal.target)) * 100)
  );
}

function formatGoalValue(value, unit) {
  const number = new Intl.NumberFormat().format(Number(value) || 0);

  if (unit === "₦") return "₦" + number;

  return number + (unit ? " " + escapeHTML(unit) : "");
}

function renderGoalList(container) {
  if (!container) return;

  if (goals.length === 0) {
    container.innerHTML =
      '<p class="empty-state">No goals yet. Create your first business goal.</p>';
    return;
  }

  container.innerHTML = goals.map(goal => {
    const id = escapeHTML(goal.id);
    const title = escapeHTML(goal.title);
    const progress = getProgress(goal);
    const unit = goal.unit || "units";

    return `
      <article class="goal-item" data-goal-id="${id}">
        <div class="goal-top">
          <strong>${title}</strong>
          <span>${progress}%</span>
        </div>

        <div class="progress-track"
          role="progressbar"
          aria-label="${title} progress"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow="${progress}">
          <div class="progress-fill ${progress >= 100 ? "complete" : ""}"
            style="width:${progress}%"></div>
        </div>

        <small>
          ${formatGoalValue(goal.current, unit)}
          of ${formatGoalValue(goal.target, unit)} target
        </small>

        <div class="record-actions">
          <button class="small-button" type="button"
            data-action="update" data-id="${id}">
            Update progress
          </button>
          <button class="small-button" type="button"
            data-action="edit" data-id="${id}">
            Edit goal
          </button>
          <button class="small-button danger" type="button"
            data-action="delete" data-id="${id}">
            Delete goal
          </button>
        </div>
      </article>
    `;
  }).join("");
}

function renderGoals() {
  renderGoalList(document.querySelector("#goal-list"));
  renderGoalList(document.querySelector("#all-goals-list"));

  const count = document.querySelector("#goal-count");
  if (count) count.textContent = String(goals.length);

  updateStorageStatus();
}

function createId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return "goal-" + Date.now() + "-" +
    Math.random().toString(36).slice(2, 10);
}

function createGoal(title, current, target, unit) {
  const cleanTitle = String(title).trim();
  const currentValue = Number(current);
  const targetValue = Number(target);
  const cleanUnit = String(unit).trim();

  if (!cleanTitle || cleanTitle.length > 120) {
    showToast("Goal name must contain 1–120 characters.");
    return false;
  }

  if (!Number.isFinite(currentValue) || currentValue < 0) {
    showToast("Current value must be zero or greater.");
    return false;
  }

  if (!Number.isFinite(targetValue) || targetValue <= 0) {
    showToast("Target must be greater than zero.");
    return false;
  }

  if (cleanUnit.length > 40) {
    showToast("Measurement unit must be 40 characters or fewer.");
    return false;
  }

  const goal = {
    id: createId(),
    title: cleanTitle,
    current: currentValue,
    target: targetValue,
    unit: cleanUnit || "units"
  };

  goals.push(goal);

  if (!saveGoals()) {
    goals.pop();
    return false;
  }

  renderGoals();
  showToast("Goal saved in this browser.");
  return true;
}

function navigateTo(pageId) {
  const page = document.getElementById(pageId);

  if (!page || !page.classList.contains("page")) return;

  document.querySelectorAll(".page").forEach(item => {
    item.classList.toggle("active", item === page);
  });

  document.querySelectorAll(".nav-link[data-page]").forEach(link => {
    const active = link.dataset.page === pageId;

    link.classList.toggle("active", active);

    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });

  const breadcrumb = document.querySelector("#current-section");
  const activeLink = document.querySelector(
    '.nav-link[data-page="' + pageId + '"]'
  );

  if (breadcrumb) {
    breadcrumb.textContent = activeLink
      ? activeLink.textContent.trim()
      : (page.querySelector("h1")?.textContent || "Workspace");
  }

  document.querySelector("#sidebar")?.classList.remove("open");
  document.querySelector(".menu-button")?.setAttribute(
    "aria-expanded", "false"
  );

  if (location.hash !== "#" + pageId) {
    history.replaceState(null, "", "#" + pageId);
  }
}

function handleGoalAction(action, id) {
  const goal = goals.find(item => item.id === id);

  if (!goal) {
    showToast("Goal not found. Refresh and try again.");
    return;
  }

  if (action === "delete") {
    const confirmed = window.confirm(
      'Delete "' + goal.title +
      '"? This removes the goal from this browser only.'
    );

    if (!confirmed) return;

    const index = goals.findIndex(item => item.id === id);
    if (index < 0) return;

    const removedGoal = goals.splice(index, 1)[0];

    if (!saveGoals()) {
      goals.splice(index, 0, removedGoal);
      renderGoals();
      return;
    }

    renderGoals();
    showToast("Goal deleted from this browser.");
    return;
  }

  if (action === "update") {
    const input = prompt(
      'Current progress for "' + goal.title + '":',
      String(goal.current)
    );

    if (input === null) return;

    const value = Number(input);

    if (input.trim() === "" || !Number.isFinite(value) || value < 0) {
      showToast("Enter a valid number of zero or greater.");
      return;
    }

    const previous = goal.current;
    goal.current = value;

    if (!saveGoals()) {
      goal.current = previous;
      return;
    }

    renderGoals();
    showToast("Progress updated locally.");
    return;
  }

  if (action === "edit") {
    const title = prompt("Goal name:", goal.title);
    if (title === null) return;

    if (!title.trim() || title.trim().length > 120) {
      showToast("Goal name must contain 1–120 characters.");
      return;
    }

    const targetInput = prompt("Target value:", String(goal.target));
    if (targetInput === null) return;

    const target = Number(targetInput);

    if (
      targetInput.trim() === "" ||
      !Number.isFinite(target) ||
      target <= 0
    ) {
      showToast("Target must be greater than zero.");
      return;
    }

    const unit = prompt("Measurement unit:", goal.unit || "units");
    if (unit === null) return;

    if (unit.trim().length > 40) {
      showToast("Measurement unit must be 40 characters or fewer.");
      return;
    }

    const previous = { ...goal };

    goal.title = title.trim();
    goal.target = target;
    goal.unit = unit.trim() || "units";

    if (!saveGoals()) {
      Object.assign(goal, previous);
      return;
    }

    renderGoals();
    showToast("Goal updated locally.");
  }
}

function setupGoalForm() {
  const form = document.querySelector("#goal-form");
  if (!form) return;

  form.addEventListener("submit", event => {
    event.preventDefault();

    if (!form.reportValidity()) return;

    const title = document.querySelector("#goal-title")?.value ?? "";
    const current = document.querySelector("#goal-current")?.value ?? "0";
    const target = document.querySelector("#goal-target")?.value ?? "";
    const unit = document.querySelector("#goal-unit")?.value ?? "units";

    if (createGoal(title, current, target, unit)) {
      form.reset();

      const currentField = document.querySelector("#goal-current");
      const unitField = document.querySelector("#goal-unit");

      if (currentField) currentField.value = "0";
      if (unitField) unitField.value = "customers";
    }
  });
}

function setupGoalActions() {
  document.addEventListener("click", event => {
    if (!(event.target instanceof Element)) return;

    const actionButton = event.target.closest("[data-action]");

    if (actionButton) {
      handleGoalAction(
        actionButton.dataset.action,
        actionButton.dataset.id
      );
      return;
    }

    const createButton = event.target.closest(
      "#goal-button, #create-goal, #add-goal"
    );

    if (createButton) {
      event.preventDefault();
      navigateTo("goals");
      document.querySelector("#goal-title")?.focus();
    }
  });
}

function setupNavigation() {
  document.querySelectorAll(".nav-link[data-page]").forEach(link => {
    link.addEventListener("click", event => {
      event.preventDefault();
      navigateTo(link.dataset.page);
    });
  });

  document.querySelectorAll("[data-go-to]").forEach(button => {
    button.addEventListener("click", () => {
      navigateTo(button.dataset.goTo);
    });
  });

  const menuButton = document.querySelector(".menu-button");
  const sidebar = document.querySelector("#sidebar");

  if (menuButton && sidebar) {
    menuButton.addEventListener("click", () => {
      const isOpen = sidebar.classList.toggle("open");
      menuButton.setAttribute("aria-expanded", String(isOpen));
    });
  }

  window.addEventListener("hashchange", () => {
    const pageId = location.hash.slice(1);
    const page = document.getElementById(pageId);

    if (page?.classList.contains("page")) {
      navigateTo(pageId);
    }
  });
}

function initializeBusinessFlow() {
  loadGoals();
  setupNavigation();
  setupGoalForm();
  setupGoalActions();
  renderGoals();

  const initialPage = location.hash.slice(1);
  const page = document.getElementById(initialPage);

  if (page?.classList.contains("page")) {
    navigateTo(initialPage);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeBusinessFlow, {
    once: true
  });
} else {
  initializeBusinessFlow();
}
