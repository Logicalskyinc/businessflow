
/* BusinessFlow frontend prototype.
   Goals, experiments, and business memory are stored in this browser.
   No backend, live business data, or AI service is connected.
*/
"use strict";

const STORAGE_KEY = "businessflow_goals_v1";
const EXPERIMENTS_KEY = "businessflow_experiments_v1";
const MEMORY_KEY = "businessflow_memory_v1";

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

const MEMORY_CATEGORIES = [
  "Decision",
  "Customer insight",
  "Lesson learned",
  "Process",
  "Follow-up",
  "Other"
];

const EXPERIMENT_STATUSES = [
  "planned",
  "running",
  "review",
  "completed"
];

let goals = [];
let experiments = [];
let editingExperimentId = null;
let memories = [];
let storageAvailable = true;

/* ---------- Shared helpers ---------- */

function escapeHTML(value) {
  const entities = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  };

  return String(value ?? "").replace(/[&<>"']/g, char => entities[char]);
}

function formatText(value) {
  return escapeHTML(value).replace(/\r?\n/g, "<br>");
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

function createId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return "record-" + Date.now() + "-" +
    Math.random().toString(36).slice(2, 10);
}

function updateStorageStatus() {
  document.querySelectorAll("[data-storage-status]").forEach(element => {
    element.textContent = storageAvailable
      ? "Saved locally in this browser · Not synced across devices"
      : "Browser storage unavailable · Changes may not persist";
  });
}

function saveCollection(key, collection) {
  try {
    localStorage.setItem(key, JSON.stringify(collection));
    storageAvailable = true;
    updateStorageStatus();
    return true;
  } catch (error) {
    storageAvailable = false;
    updateStorageStatus();
    console.error("BusinessFlow could not save data:", error);
    showToast("Could not save. Browser storage may be unavailable.");
    return false;
  }
}

function loadCollection(key) {
  try {
    const saved = localStorage.getItem(key);

    if (saved === null) return [];

    const parsed = JSON.parse(saved);

    if (!Array.isArray(parsed)) {
      throw new Error("Saved data must be an array.");
    }

    return parsed;
  } catch (error) {
    storageAvailable = false;
    updateStorageStatus();
    console.error("BusinessFlow could not load saved data:", error);
    return [];
  }
}

function formatDate(dateString) {
  if (!dateString) return "No date";

  const date = new Date(dateString + "T00:00:00");

  if (Number.isNaN(date.getTime())) return escapeHTML(dateString);

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

/* ---------- Goals ---------- */

function saveGoals() {
  return saveCollection(STORAGE_KEY, goals);
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

function renderAnalyticsGoals() {
  const container = document.querySelector("#analytics-goals");
  if (!container) return;

  if (goals.length === 0) {
    container.innerHTML = `
      <p class="empty-state">
        No saved goals yet. Create a goal to start tracking progress.
      </p>
    `;
    return;
  }

  container.innerHTML = goals.map(goal => {
    const title = escapeHTML(goal.title);
    const progress = getProgress(goal);
    const unit = goal.unit || "units";

    return `
      <article class="goal-item">
        <div class="goal-top">
          <strong>${title}</strong>
          <span>${progress}% complete</span>
        </div>

        <div class="progress-track"
          role="progressbar"
          aria-label="${title} completion"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow="${progress}">
          <div class="progress-fill ${progress >= 100 ? "complete" : ""}"
            style="width:${progress}%"></div>
        </div>

        <small>
          ${formatGoalValue(goal.current, unit)}
          of ${formatGoalValue(goal.target, unit)}
        </small>
      </article>
    `;
  }).join("");
}

function renderGoals() {
  renderGoalList(document.querySelector("#goal-list"));
  renderGoalList(document.querySelector("#all-goals-list"));
  renderAnalyticsGoals();

  const count = document.querySelector("#goal-count");
  if (count) count.textContent = String(goals.length);

  updateStorageStatus();
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

  goals.push({
    id: createId(),
    title: cleanTitle,
    current: currentValue,
    target: targetValue,
    unit: cleanUnit || "units"
  });

  if (!saveGoals()) {
    goals.pop();
    return false;
  }

  renderGoals();
  showToast("Goal saved in this browser.");
  return true;
}

function handleGoalAction(action, id) {
  const goal = goals.find(item => item.id === id);

  if (!goal) {
    showToast("Goal not found. Refresh and try again.");
    return;
  }

  if (action === "delete") {
    if (!confirm(
      'Delete "' + goal.title +
      '"? This removes the goal from this browser only.'
    )) return;

    const index = goals.findIndex(item => item.id === id);
    const removed = goals.splice(index, 1)[0];

    if (!saveGoals()) {
      goals.splice(index, 0, removed);
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

/* ---------- Experiments ---------- */

function isValidExperiment(item) {
  return Boolean(
    item &&
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    item.title.trim() &&
    typeof item.hypothesis === "string" &&
    item.hypothesis.trim() &&
    (item.baseline === null ||
      item.baseline === undefined ||
      (Number.isFinite(Number(item.baseline)) && Number(item.baseline) >= 0)) &&
    (item.result === null ||
      item.result === undefined ||
      (Number.isFinite(Number(item.result)) && Number(item.result) >= 0)) &&
    EXPERIMENT_STATUSES.includes(item.status) &&
    typeof (item.notes ?? "") === "string"
  );
}

function loadExperiments() {
  experiments = loadCollection(EXPERIMENTS_KEY)
    .filter(isValidExperiment)
    .map(item => ({
      id: item.id,
      title: item.title.trim().slice(0, 120),
      hypothesis: item.hypothesis.trim().slice(0, 1000),
      baseline: item.baseline === null || item.baseline === undefined ? null : Number(item.baseline),
      result: item.result === null || item.result === undefined
        ? null
        : Number(item.result),
      status: item.status,
      notes: String(item.notes ?? "").slice(0, 2000),
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || item.createdAt || new Date().toISOString()
    }));
}

function saveExperiments() {
  return saveCollection(EXPERIMENTS_KEY, experiments);
}

function renderExperiments() {
  const container = document.querySelector("#experiment-list");
  const count = document.querySelector("#experiment-count");

  if (count) count.textContent = String(experiments.length);
  if (!container) return;

  if (experiments.length === 0) {
    container.innerHTML = `
      <p class="empty-state">
        No experiments saved yet. Create one to start testing ideas.
      </p>
    `;
    return;
  }

  container.innerHTML = experiments.map(item => {
    const id = escapeHTML(item.id);
    const result = item.result === null
      ? "Not recorded yet"
      : escapeHTML(new Intl.NumberFormat().format(item.result));
    const status = item.status.charAt(0).toUpperCase() +
      item.status.slice(1);

    return `
      <article class="record-item panel">
        <div class="record-heading">
          <div>
            <h3>${escapeHTML(item.title)}</h3>
            <span class="count-pill">${escapeHTML(status)}</span>
          </div>
        </div>

        <p><strong>Hypothesis</strong></p>
        <p>${formatText(item.hypothesis)}</p>

        <div class="record-details">
          <p><strong>Baseline:</strong>
            ${item.baseline === null
              ? "Not recorded yet"
              : escapeHTML(new Intl.NumberFormat().format(item.baseline))}
          </p>
          <p><strong>Test result:</strong> ${result}</p>
        </div>

        ${item.notes ? `
          <p><strong>Learning notes</strong></p>
          <p>${formatText(item.notes)}</p>
        ` : ""}

        <div class="record-actions">
          <button class="small-button" type="button"
            data-experiment-action="edit" data-id="${id}">
            Edit
          </button>
          <button class="small-button danger" type="button"
            data-experiment-action="delete" data-id="${id}">
            Delete
          </button>
        </div>
      </article>
    `;
  }).join("");
}

function setExperimentFormMode(isEditing) {
  const form = document.querySelector("#experiment-form");
  const submitButton = form?.querySelector('button[type="submit"]');
  const cancelButton = document.querySelector("#experiment-cancel-edit");

  if (submitButton) {
    submitButton.textContent = isEditing ? "Save changes" : "Save experiment";
  }

  if (cancelButton) cancelButton.hidden = !isEditing;
}

function cancelExperimentEdit() {
  editingExperimentId = null;
  const form = document.querySelector("#experiment-form");
  form?.reset();
  setExperimentFormMode(false);
}

function setupExperimentForm() {
  const form = document.querySelector("#experiment-form");
  if (!form) return;

  const cancelButton = document.querySelector("#experiment-cancel-edit");
  cancelButton?.addEventListener("click", cancelExperimentEdit);

  form.addEventListener("submit", event => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const title = document.querySelector("#experiment-title").value.trim();
    const hypothesis = document.querySelector(
      "#experiment-hypothesis"
    ).value.trim();
    const baselineInput = document.querySelector(
      "#experiment-baseline"
    ).value.trim();
    const resultInput = document.querySelector(
      "#experiment-result"
    ).value.trim();
    const status = document.querySelector("#experiment-status").value;
    const notes = document.querySelector("#experiment-notes").value.trim();

    const baseline = baselineInput === "" ? null : Number(baselineInput);
    const result = resultInput === "" ? null : Number(resultInput);

    if (!title || title.length > 120) {
      showToast("Experiment name must contain 1–120 characters.");
      return;
    }

    if (!hypothesis || hypothesis.length > 1000) {
      showToast("Enter a hypothesis of up to 1,000 characters.");
      return;
    }

    if (
      baselineInput !== "" &&
      (!Number.isFinite(baseline) || baseline < 0)
    ) {
      showToast("Baseline must be zero or greater, or left blank until measured.");
      return;
    }

    if (
      resultInput !== "" &&
      (!Number.isFinite(result) || result < 0)
    ) {
      showToast("Test result must be zero or greater.");
      return;
    }

    if (!EXPERIMENT_STATUSES.includes(status)) {
      showToast("Choose a valid experiment status.");
      return;
    }

    if (notes.length > 2000) {
      showToast("Learning notes must be 2,000 characters or fewer.");
      return;
    }

    const now = new Date().toISOString();

    if (editingExperimentId !== null) {
      const item = experiments.find(entry => entry.id === editingExperimentId);

      if (!item) {
        cancelExperimentEdit();
        showToast("Experiment not found. Please try editing it again.");
        return;
      }

      const previous = { ...item };
      Object.assign(item, {
        title,
        hypothesis,
        baseline,
        result,
        status,
        notes,
        updatedAt: now
      });

      if (!saveExperiments()) {
        Object.assign(item, previous);
        return;
      }

      renderExperiments();
      cancelExperimentEdit();
      showToast("Experiment updated in this browser.");
      return;
    }

    experiments.unshift({
      id: createId(),
      title,
      hypothesis,
      baseline,
      result,
      status,
      notes,
      createdAt: now,
      updatedAt: now
    });

    if (!saveExperiments()) {
      experiments.shift();
      return;
    }

    renderExperiments();
    form.reset();
    showToast("Experiment saved in this browser.");
  });
}

function handleExperimentAction(action, id) {
  const index = experiments.findIndex(item => item.id === id);
  if (index < 0) {
    showToast("Experiment not found.");
    return;
  }

  const item = experiments[index];

  if (action === "delete") {
    if (!confirm(
      'Delete "' + item.title +
      '"? This removes it from this browser only.'
    )) return;

    const removed = experiments.splice(index, 1)[0];

    if (!saveExperiments()) {
      experiments.splice(index, 0, removed);
      renderExperiments();
      return;
    }

    if (editingExperimentId === id) cancelExperimentEdit();
    renderExperiments();
    showToast("Experiment deleted.");
    return;
  }

  if (action !== "edit") return;

  const form = document.querySelector("#experiment-form");
  if (!form) {
    showToast("The experiment form is unavailable.");
    return;
  }

  editingExperimentId = id;
  document.querySelector("#experiment-title").value = item.title;
  document.querySelector("#experiment-hypothesis").value = item.hypothesis;
  document.querySelector("#experiment-baseline").value =
    item.baseline === null ? "" : String(item.baseline);
  document.querySelector("#experiment-result").value =
    item.result === null ? "" : String(item.result);
  document.querySelector("#experiment-status").value = item.status;
  document.querySelector("#experiment-notes").value = item.notes;

  setExperimentFormMode(true);
  form.scrollIntoView({ behavior: "smooth", block: "start" });
  document.querySelector("#experiment-title").focus({ preventScroll: true });
}

function setupExperimentActions() {
  document.addEventListener("click", event => {
    if (!(event.target instanceof Element)) return;

    const button = event.target.closest("[data-experiment-action]");
    if (!button) return;

    handleExperimentAction(
      button.dataset.experimentAction,
      button.dataset.id
    );
  });
}

/* ---------- Business Memory ---------- */

function isValidMemory(item) {
  return Boolean(
    item &&
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    item.title.trim() &&
    MEMORY_CATEGORIES.includes(item.category) &&
    typeof item.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(item.date) &&
    typeof item.content === "string" &&
    item.content.trim()
  );
}

function loadMemories() {
  memories = loadCollection(MEMORY_KEY)
    .filter(isValidMemory)
    .map(item => ({
      id: item.id,
      title: item.title.trim().slice(0, 120),
      category: item.category,
      date: item.date,
      content: item.content.trim().slice(0, 4000),
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || item.createdAt || new Date().toISOString()
    }));
}

function saveMemories() {
  return saveCollection(MEMORY_KEY, memories);
}

function renderMemories() {
  const container = document.querySelector("#memory-list");
  const count = document.querySelector("#memory-count");
  const searchInput = document.querySelector("#memory-search");
  const query = (searchInput?.value || "").trim().toLowerCase();

  if (count) count.textContent = String(memories.length);
  if (!container) return;

  const filtered = memories.filter(item => {
    const searchable = [
      item.title,
      item.category,
      item.content,
      item.date
    ].join(" ").toLowerCase();

    return searchable.includes(query);
  });

  if (filtered.length === 0) {
    container.innerHTML = query
      ? '<p class="empty-state">No matching business memory found.</p>'
      : '<p class="empty-state">No business knowledge saved yet. Add your first note.</p>';
    return;
  }

  container.innerHTML = filtered.map(item => {
    const id = escapeHTML(item.id);

    return `
      <article class="record-item panel">
        <div class="record-heading">
          <div>
            <h3>${escapeHTML(item.title)}</h3>
            <span class="count-pill">${escapeHTML(item.category)}</span>
          </div>
          <small>${formatDate(item.date)}</small>
        </div>

        <p>${formatText(item.content)}</p>

        <div class="record-actions">
          <button class="small-button" type="button"
            data-memory-action="edit" data-id="${id}">
            Edit
          </button>
          <button class="small-button danger" type="button"
            data-memory-action="delete" data-id="${id}">
            Delete
          </button>
        </div>
      </article>
    `;
  }).join("");
}

function setupMemoryForm() {
  const form = document.querySelector("#memory-form");
  if (!form) return;

  const dateInput = document.querySelector("#memory-date");

  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const title = document.querySelector("#memory-title").value.trim();
    const category = document.querySelector("#memory-category").value;
    const date = document.querySelector("#memory-date").value;
    const content = document.querySelector("#memory-content").value.trim();

    if (!title || title.length > 120) {
      showToast("Title must contain 1–120 characters.");
      return;
    }

    if (!MEMORY_CATEGORIES.includes(category)) {
      showToast("Choose a valid memory category.");
      return;
    }

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      showToast("Choose a valid date.");
      return;
    }

    const parsedDate = new Date(date + "T00:00:00");
    if (
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== date
    ) {
      showToast("Choose a valid calendar date.");
      return;
    }

    if (!content || content.length > 4000) {
      showToast("Details must contain 1–4,000 characters.");
      return;
    }

    const now = new Date().toISOString();

    memories.unshift({
      id: createId(),
      title,
      category,
      date,
      content,
      createdAt: now,
      updatedAt: now
    });

    if (!saveMemories()) {
      memories.shift();
      return;
    }

    renderMemories();
    form.reset();

    if (dateInput) {
      dateInput.value = new Date().toISOString().slice(0, 10);
    }

    showToast("Business memory saved in this browser.");
  });
}

function handleMemoryAction(action, id) {
  const index = memories.findIndex(item => item.id === id);
  if (index < 0) {
    showToast("Memory entry not found.");
    return;
  }

  const item = memories[index];

  if (action === "delete") {
    if (!confirm(
      'Delete "' + item.title +
      '"? This removes it from this browser only.'
    )) return;

    const removed = memories.splice(index, 1)[0];

    if (!saveMemories()) {
      memories.splice(index, 0, removed);
      renderMemories();
      return;
    }

    renderMemories();
    showToast("Memory entry deleted.");
    return;
  }

  if (action !== "edit") return;

  const title = prompt("Memory title:", item.title);
  if (title === null) return;

  const category = prompt(
    "Category: Decision, Customer insight, Lesson learned, Process, Follow-up, or Other",
    item.category
  );
  if (category === null) return;

  const date = prompt("Date (YYYY-MM-DD):", item.date);
  if (date === null) return;

  const content = prompt("Details:", item.content);
  if (content === null) return;

  const cleanCategory = category.trim();

  if (!title.trim() || title.trim().length > 120) {
    showToast("Title must contain 1–120 characters.");
    return;
  }

  if (!MEMORY_CATEGORIES.includes(cleanCategory)) {
    showToast("Use one of the listed memory categories.");
    return;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
    showToast("Date must use YYYY-MM-DD.");
    return;
  }

  const parsedDate = new Date(date.trim() + "T00:00:00");
  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== date.trim()
  ) {
    showToast("Choose a valid calendar date.");
    return;
  }

  if (!content.trim() || content.trim().length > 4000) {
    showToast("Details must contain 1–4,000 characters.");
    return;
  }

  const previous = { ...item };

  Object.assign(item, {
    title: title.trim(),
    category: cleanCategory,
    date: date.trim(),
    content: content.trim(),
    updatedAt: new Date().toISOString()
  });

  if (!saveMemories()) {
    Object.assign(item, previous);
    return;
  }

  renderMemories();
  showToast("Memory entry updated.");
}

function setupMemoryActions() {
  document.addEventListener("click", event => {
    if (!(event.target instanceof Element)) return;

    const button = event.target.closest("[data-memory-action]");
    if (!button) return;

    handleMemoryAction(
      button.dataset.memoryAction,
      button.dataset.id
    );
  });
}

function setupMemorySearch() {
  const search = document.querySelector("#memory-search");
  if (!search) return;

  search.addEventListener("input", renderMemories);
}

/* ---------- Navigation ---------- */

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

/* ---------- Start the app ---------- */

function initializeBusinessFlow() {
  loadGoals();
  loadExperiments();
  loadMemories();

  setupNavigation();

  setupGoalForm();
  setupGoalActions();

  setupExperimentForm();
  setupExperimentActions();

  setupMemoryForm();
  setupMemoryActions();
  setupMemorySearch();

  renderGoals();
  renderExperiments();
  renderMemories();
  updateStorageStatus();

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
