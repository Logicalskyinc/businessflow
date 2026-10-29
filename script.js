
/* BusinessFlow workspace UI. Cloud goals use the authenticated API; experiments and business memory remain browser-local for now. */
"use strict";

const STORAGE_KEY = "businessflow_goals_v1";
const EXPERIMENTS_KEY = "businessflow_experiments_v1";
const MEMORY_KEY = "businessflow_memory_v1";
const LOCAL_GOALS_BACKUP_KEY = "businessflow_goals_local_backup_v1";
let cloudGoalWorkspaceId = null;
let cloudGoalBusy = false;

const DEFAULT_GOALS = [];

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
    const cloud = window.BusinessFlowCloud?.getState?.();
    element.textContent = cloud?.signedIn && cloud.apiConnected && cloud.businessId === cloudGoalWorkspaceId
      ? "Business goals saved to the selected cloud workspace"
      : storageAvailable
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
      goals = [];
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

async function createGoal(title, current, target, unit) {
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

  const cloud = window.BusinessFlowCloud?.getState?.();
  if (cloud?.signedIn && cloud.apiConnected) {
    if (!cloud.businessId) {
      showToast("Create or select a business workspace before saving a cloud goal.");
      return false;
    }
    if (cloudGoalBusy) return false;
    cloudGoalBusy = true;
    try {
      const saved = await window.BusinessFlowCloud.createGoal(cloud.businessId, {
        title: cleanTitle, current: currentValue, target: targetValue, unit: cleanUnit || "units"
      });
      goals.push({
        id: saved.id, title: saved.title, current: Number(saved.current_value ?? 0),
        target: Number(saved.target_value ?? targetValue), unit: saved.metric_name || cleanUnit || "units"
      });
      if (!saveGoals()) showToast("Cloud goal saved, but the local browser copy could not be updated.");
      renderGoals();
      showToast("Goal saved to your BusinessFlow cloud workspace.");
      return true;
    } catch (error) {
      showToast("Cloud save failed: " + error.message);
      return false;
    } finally {
      cloudGoalBusy = false;
    }
  }

  goals.push({
    id: createId(), title: cleanTitle, current: currentValue,
    target: targetValue, unit: cleanUnit || "units"
  });
  if (!saveGoals()) {
    goals.pop();
    return false;
  }
  renderGoals();
  showToast("Goal saved in this browser. Cloud sync is not connected.");
  return true;
}

async function handleGoalAction(action, id) {
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

    const cloud = window.BusinessFlowCloud?.getState?.();
    if (cloud?.signedIn && cloud.apiConnected && cloud.businessId === cloudGoalWorkspaceId && /^[0-9a-f-]{36}$/i.test(id)) {
      try {
        await window.BusinessFlowCloud.deleteGoal(cloud.businessId, id);
      } catch (error) {
        showToast("Cloud delete failed: " + error.message);
        return;
      }
    }
    const index = goals.findIndex(item => item.id === id);
    const removed = goals.splice(index, 1)[0];
    if (!saveGoals()) {
      goals.splice(index, 0, removed);
      renderGoals();
      return;
    }
    renderGoals();
    showToast(cloud?.signedIn && cloud.apiConnected ? "Goal deleted." : "Goal deleted from this browser.");
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

    const cloud = window.BusinessFlowCloud?.getState?.();
    if (cloud?.signedIn && cloud.apiConnected && cloud.businessId === cloudGoalWorkspaceId && /^[0-9a-f-]{36}$/i.test(id)) {
      try {
        await window.BusinessFlowCloud.updateGoal(cloud.businessId, goal);
      } catch (error) {
        goal.current = previous;
        showToast("Cloud update failed: " + error.message);
        return;
      }
    }
    if (!saveGoals()) {
      goal.current = previous;
      return;
    }
    renderGoals();
    showToast(cloud?.signedIn && cloud.apiConnected ? "Progress updated in the cloud." : "Progress updated locally.");
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

    const cloud = window.BusinessFlowCloud?.getState?.();
    if (cloud?.signedIn && cloud.apiConnected && cloud.businessId === cloudGoalWorkspaceId && /^[0-9a-f-]{36}$/i.test(id)) {
      try {
        await window.BusinessFlowCloud.updateGoal(cloud.businessId, goal);
      } catch (error) {
        Object.assign(goal, previous);
        showToast("Cloud update failed: " + error.message);
        return;
      }
    }
    if (!saveGoals()) {
      Object.assign(goal, previous);
      return;
    }
    renderGoals();
    showToast(cloud?.signedIn && cloud.apiConnected ? "Goal updated in the cloud." : "Goal updated locally.");
  }
}

function setupGoalForm() {
  const form = document.querySelector("#goal-form");
  if (!form) return;

  form.addEventListener("submit", async event => {
    event.preventDefault();

    if (!form.reportValidity()) return;

    const title = document.querySelector("#goal-title")?.value ?? "";
    const current = document.querySelector("#goal-current")?.value ?? "0";
    const target = document.querySelector("#goal-target")?.value ?? "";
    const unit = document.querySelector("#goal-unit")?.value ?? "units";

    if (await createGoal(title, current, target, unit)) {
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

function renderOverviewExperiments() {
  const activeCount = experiments.filter(item => item.status === "running").length;
  document.querySelectorAll('[data-metric-value="active-experiments"]').forEach(node => { node.textContent = String(activeCount); });
  document.querySelectorAll('[data-metric-note="active-experiments"]').forEach(node => { node.textContent = "From saved experiments"; });
  const overview = document.querySelector("#overview-experiment-list");
  if (!overview) return;
  if (experiments.length === 0) {
    overview.innerHTML = '<p class="empty-state">No experiments saved yet. Create one to start learning from real tests.</p>';
    return;
  }
  overview.innerHTML = [...experiments]
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))
    .slice(0, 3)
    .map(item => {
      const status = String(item.status || "planned");
      const label = status.charAt(0).toUpperCase() + status.slice(1);
      return '<div class="simple-item"><div><strong>' + escapeHTML(item.title) +
        '</strong><p>' + escapeHTML(label) + '</p></div><span class="status-pill ' +
        escapeHTML(status) + '">' + escapeHTML(label) + '</span></div>';
    }).join("");
}

function renderExperiments() {
  const container = document.querySelector("#experiment-list");
  const count = document.querySelector("#experiment-count");

  if (count) count.textContent = String(experiments.length);
  renderOverviewExperiments();
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
  const cloudState = window.BusinessFlowCloud?.getState?.();
  if (pageId !== "account" && !cloudState?.signedIn) {
    pageId = "account";
    return navigateTo(pageId);
  }

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

async function loadCloudGoalsForWorkspace(businessId) {
  const cloud = window.BusinessFlowCloud?.getState?.();
  if (!cloud?.signedIn || !cloud.apiConnected || !businessId) {
    cloudGoalWorkspaceId = null;
    loadGoals();
    renderGoals();
    return;
  }

  try {
    if (!localStorage.getItem(LOCAL_GOALS_BACKUP_KEY)) {
      const localSnapshot = localStorage.getItem(STORAGE_KEY);
      if (localSnapshot !== null) localStorage.setItem(LOCAL_GOALS_BACKUP_KEY, localSnapshot);
    }
    const records = await window.BusinessFlowCloud.loadGoals(businessId);
    goals = records.filter(record =>
      record && typeof record.id === "string" &&
      typeof record.title === "string" &&
      Number.isFinite(Number(record.current_value)) &&
      Number(record.current_value) >= 0 &&
      record.target_value !== null &&
      Number.isFinite(Number(record.target_value)) &&
      Number(record.target_value) > 0
    ).map(record => ({
      id: record.id,
      title: record.title,
      current: Number(record.current_value),
      target: Number(record.target_value),
      unit: record.metric_name || "units"
    }));
    cloudGoalWorkspaceId = businessId;
    renderGoals();
    showToast("Loaded " + goals.length + " cloud goal" + (goals.length === 1 ? "" : "s") + ".");
  } catch (error) {
    console.error("BusinessFlow cloud goals could not load:", error);
    showToast("Could not load cloud goals: " + error.message);
  }
}

async function importLocalGoalsToCloud() {
  const cloud = window.BusinessFlowCloud?.getState?.();
  if (!cloud?.signedIn || !cloud.apiConnected || !cloud.businessId) {
    showToast("Sign in, connect the backend, and select a business workspace first.");
    return;
  }
  let localRecords = [];
  try {
    const snapshot = localStorage.getItem(LOCAL_GOALS_BACKUP_KEY) ?? localStorage.getItem(STORAGE_KEY);
    const parsed = snapshot ? JSON.parse(snapshot) : [];
    if (Array.isArray(parsed)) localRecords = parsed.filter(isValidGoal);
  } catch (error) {
    showToast("Could not read local goals for import.");
    return;
  }
  if (!localRecords.length) {
    showToast("No valid browser goals were found to import.");
    return;
  }
  if (!confirm("Import " + localRecords.length + " browser goal(s) into the selected business? Existing cloud goals with the same name will be skipped. Your local backup will be kept.")) return;

  try {
    const remote = await window.BusinessFlowCloud.loadGoals(cloud.businessId);
    const existingTitles = new Set(remote.map(item => String(item.title).trim().toLowerCase()));
    let imported = 0, skipped = 0;
    for (const local of localRecords) {
      if (existingTitles.has(local.title.trim().toLowerCase())) {
        skipped++;
        continue;
      }
      await window.BusinessFlowCloud.createGoal(cloud.businessId, local);
      existingTitles.add(local.title.trim().toLowerCase());
      imported++;
    }
    await loadCloudGoalsForWorkspace(cloud.businessId);
    showToast("Import complete: " + imported + " imported, " + skipped + " skipped. Local backup retained.");
  } catch (error) {
    showToast("Import stopped: " + error.message + ". Your local backup was retained; retry safely.");
  }
}

window.addEventListener("businessflow:auth-state", event => {
  const signedIn = Boolean(event.detail?.signedIn);
  if (!signedIn) navigateTo("account");
});

window.addEventListener("businessflow:workspace-ready", event => {
  const required = Boolean(event.detail?.onboardingRequired);
  const gate = document.querySelector("#onboarding-gate");
  if (gate) gate.hidden = !required;
  navigateTo("overview");
});

document.querySelector("#onboarding-setup")?.addEventListener("click", () => {
  const gate = document.querySelector("#onboarding-gate");
  if (gate) gate.hidden = true;
  navigateTo("account");
  document.querySelector("#business-workspace-name")?.focus({ preventScroll: true });
});

window.addEventListener("businessflow:onboarding-skipped", () => {
  const gate = document.querySelector("#onboarding-gate");
  if (gate) gate.hidden = true;
  navigateTo("overview");
});

window.addEventListener("businessflow:workspace-changed", event => {
  const businessId = event.detail?.businessId ?? null;
  void loadCloudGoalsForWorkspace(businessId);
});
window.addEventListener("businessflow:cloud-state", event => {
  const state = event.detail ?? {};
  if (!state.signedIn || !state.apiConnected) {
    cloudGoalWorkspaceId = null;
    loadGoals();
    renderGoals();
  }
});
window.addEventListener("businessflow:import-local-goals-requested", () => {
  void importLocalGoalsToCloud();
});

/* ---------- Start the app ---------- */

function initializeBusinessFlow() {
  loadGoals();
  loadExperiments();
  loadMemories();

  setupNavigation();
  setupConnections();

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

/* ---------- Connections directory ---------- */
const CONNECTION_CATALOG = [
  { id:"hubspot", name:"HubSpot", category:"CRM & customers", kind:"CRM", description:"Bring customer records, lead stages, and sales activity into business analysis.", access:"OAuth authorization; start with read-only contacts, companies, and deals scopes.", requirements:["A HubSpot account with permission to authorize apps.","A secure OAuth connector and workspace-level token storage.","Explicit selection of the records and scopes BusinessFlow may read."] },
  { id:"salesforce", name:"Salesforce", category:"CRM & customers", kind:"CRM", description:"Analyze sales pipeline, customer relationships, and opportunity movement.", access:"OAuth authorization; read-only scopes first.", requirements:["A Salesforce organization and an authorized administrator or user.","Registered OAuth app and approved scopes.","Server-side token storage and workspace isolation."] },
  { id:"zoho-crm", name:"Zoho CRM", category:"CRM & customers", kind:"CRM", description:"Use leads, contacts, and deal stages to understand sales performance.", access:"OAuth authorization with least-privilege CRM scopes.", requirements:["A Zoho CRM account.","OAuth application configuration for the selected region.","Permission review and workspace-level token storage."] },
  { id:"pipedrive", name:"Pipedrive", category:"CRM & customers", kind:"CRM", description:"Understand lead conversion, deal velocity, and pipeline bottlenecks.", access:"OAuth or approved API access; read-only by default.", requirements:["A Pipedrive account.","Approved OAuth scopes or securely stored API credentials.","A clear mapping from pipeline data to BusinessFlow metrics."] },
  { id:"excel", name:"Microsoft Excel", category:"Spreadsheets & files", kind:"Spreadsheet", description:"Analyze business figures from Excel workbooks and structured tables.", access:"File import first; cloud workbook sync can follow through Microsoft Graph.", requirements:["For file import: a workbook in a supported format.","For cloud sync: Microsoft sign-in and Graph permissions.","Column mapping, validation, and a preview before importing."] },
  { id:"google-sheets", name:"Google Sheets", category:"Spreadsheets & files", kind:"Spreadsheet", description:"Use existing sales, stock, finance, or customer sheets as a business data source.", access:"Google OAuth with access limited to files the user selects.", requirements:["A Google account and explicit file-selection permission.","A secure OAuth flow and server-side token handling.","A preview and confirmation before data is imported."] },
  { id:"csv-import", name:"CSV & Excel file import", category:"Spreadsheets & files", kind:"File import", description:"Start with a spreadsheet export without connecting an external account.", access:"User-selected file upload; no external account access.", requirements:["A CSV or supported Excel file.","Column mapping, size limits, validation, and duplicate handling.","A review screen before saving imported records."] },
  { id:"whatsapp-business", name:"WhatsApp Business Platform", category:"Messaging & email", kind:"Messaging", description:"Analyze approved business messaging events and customer-service activity.", access:"Meta business authorization; only approved business assets and scopes.", requirements:["A WhatsApp Business Platform setup and eligible business assets.","Meta app review and permissions where required.","Webhook verification, customer privacy safeguards, and clear consent rules."] },
  { id:"gmail", name:"Gmail", category:"Messaging & email", kind:"Email", description:"Connect selected business email signals for approved workflow and response analysis.", access:"Google OAuth; minimal scopes, preferably metadata or user-selected data.", requirements:["A Google Workspace or Gmail account.","OAuth consent and only the scopes needed for the chosen feature.","Clear limits on message access, retention, and analysis."] },
  { id:"outlook", name:"Microsoft Outlook", category:"Messaging & email", kind:"Email", description:"Connect approved mailbox or calendar data for business workflow insights.", access:"Microsoft Graph authorization with least-privilege scopes.", requirements:["A Microsoft account or Microsoft 365 organization.","Microsoft identity app configuration and consent.","Explicit permissions and a way to revoke access."] },
  { id:"slack", name:"Slack", category:"Messaging & email", kind:"Team messaging", description:"Bring approved team workflow signals into operational reviews.", access:"Slack OAuth with narrowly scoped workspace permissions.", requirements:["A Slack workspace and authorized app installation.","A review of channel and message permissions.","Workspace-level token protection and access auditing."] },
  { id:"teams", name:"Microsoft Teams", category:"Messaging & email", kind:"Team messaging", description:"Connect approved collaboration and operational signals from Teams.", access:"Microsoft Graph permissions and admin consent where required.", requirements:["A Microsoft 365 tenant.","Registered app and permission approval.","A clear scope for messages, meetings, or activity data."] },
  { id:"quickbooks", name:"QuickBooks", category:"Finance & payments", kind:"Accounting", description:"Analyze approved financial summaries, expenses, and accounting trends.", access:"OAuth; start with read-only accounting scopes.", requirements:["A supported QuickBooks account and region.","Intuit developer app and OAuth configuration.","Currency, fiscal period, and accounting-category mapping."] },
  { id:"xero", name:"Xero", category:"Finance & payments", kind:"Accounting", description:"Use accounting records to understand cash flow and business performance.", access:"OAuth with the minimum accounting scopes required.", requirements:["A Xero organization.","Registered app and approved connection scopes.","Careful treatment of financial data and workspace permissions."] },
  { id:"stripe", name:"Stripe", category:"Finance & payments", kind:"Payments", description:"Analyze payment outcomes, refunds, and revenue events from authorized data.", access:"Restricted read-only API key or OAuth where supported; backend only.", requirements:["A Stripe account.","A restricted key or approved authorization flow stored server-side.","A clear definition of gross revenue, fees, refunds, and currency."] },
  { id:"shopify", name:"Shopify", category:"E-commerce & sales", kind:"E-commerce", description:"Understand orders, product performance, and customer purchase trends.", access:"Shopify app authorization with minimum required scopes.", requirements:["A Shopify store and authorized app installation.","Approved scopes and secure webhook verification if used.","Data mapping for orders, refunds, products, and currencies."] },
  { id:"woocommerce", name:"WooCommerce", category:"E-commerce & sales", kind:"E-commerce", description:"Analyze store orders, product sales, and customer trends.", access:"Restricted WooCommerce REST API credentials stored server-side.", requirements:["A WooCommerce store with HTTPS.","A dedicated key with the minimum required permissions.","Secure credential storage and webhook validation."] },
  { id:"meta-ads", name:"Meta Ads", category:"Marketing & ads", kind:"Advertising", description:"Measure campaign results and customer acquisition performance.", access:"Meta OAuth and approved advertising permissions; reporting first.", requirements:["A Meta business portfolio and ad account.","App review and business verification if required.","Read-only reporting first; any campaign changes require separate approval."] },
  { id:"google-ads", name:"Google Ads", category:"Marketing & ads", kind:"Advertising", description:"Compare campaign spending, conversions, and acquisition performance.", access:"Google OAuth and the required Google Ads API access.", requirements:["A Google Ads account and developer token where required.","OAuth configuration and approved access.","Reporting metrics mapped to the business's attribution model."] },
  { id:"google-analytics", name:"Google Analytics", category:"Marketing & ads", kind:"Analytics", description:"Understand website traffic and conversion trends using approved properties.", access:"Google OAuth with access to selected Analytics properties.", requirements:["A GA4 property and permission to authorize access.","Google Analytics Data API setup.","Defined conversion events and date ranges."] },
  { id:"notion", name:"Notion", category:"Projects & teams", kind:"Knowledge base", description:"Use selected operational documents and plans as business context.", access:"Notion integration authorization limited to pages shared with it.", requirements:["A Notion workspace.","An integration authorized by the workspace owner.","Explicitly shared pages and a clear data-retention policy."] },
  { id:"trello", name:"Trello", category:"Projects & teams", kind:"Project management", description:"Track project progress, task movement, and operational bottlenecks.", access:"Trello authorization with minimum board permissions.", requirements:["A Trello account and selected boards.","Secure authorization and workspace token storage.","A mapping for boards, lists, cards, and completion states."] },
  { id:"asana", name:"Asana", category:"Projects & teams", kind:"Project management", description:"Understand project delivery, task progress, and team workflows.", access:"OAuth with selected workspace and project scopes.", requirements:["An Asana workspace and authorization.","OAuth configuration and least-privilege scopes.","Clear rules for which projects BusinessFlow may read."] },
  { id:"postgresql", name:"PostgreSQL database", category:"Custom data", kind:"Database", description:"Connect a supported database for governed business reporting and analysis.", access:"Backend-only connection using a dedicated read-only database role.", requirements:["A reachable PostgreSQL instance with TLS where supported.","A dedicated read-only role restricted to approved schemas and tables.","Network controls, secret storage, query limits, and a tested isolation model."] },
  { id:"rest-api", name:"REST APIs & webhooks", category:"Custom data", kind:"Developer tools", description:"Connect custom business systems that do not have a built-in integration.", access:"Server-side API credentials or signed webhook verification.", requirements:["API documentation and an authorized credential or signing secret.","A server-side connector with timeouts, retries, and rate limits.","Validated payloads, audit logs, and secret rotation."] },
  { id:"pos-inventory", name:"POS & inventory systems", category:"Operations & inventory", kind:"Operations", description:"Understand stock movement, point-of-sale activity, and order operations.", access:"Provider-specific OAuth or restricted API access.", requirements:["The exact POS or inventory provider must be identified.","Provider API access and supported data scopes.","A mapping for products, stock levels, sales, and locations."] },
  { id:"logistics", name:"Shipping & logistics", category:"Operations & inventory", kind:"Operations", description:"Track delivery status, fulfilment delays, and order operations.", access:"Provider-specific authorization or signed webhooks.", requirements:["The shipping or logistics provider used by the business.","API or webhook access approved by that provider.","Validation of shipment events and customer information handling."] }
];

function renderConnections() {
  const grid = document.querySelector("#connections-grid");
  if (!grid) return;
  const query = (document.querySelector("#connections-search")?.value || "").trim().toLowerCase();
  const category = document.querySelector("#connections-category")?.value || "all";
  const filtered = CONNECTION_CATALOG.filter(item => {
    const matchesCategory = category === "all" || item.category === category;
    const searchable = [item.name, item.category, item.kind, item.description].join(" ").toLowerCase();
    return matchesCategory && (!query || searchable.includes(query));
  });
  grid.innerHTML = filtered.map(item => `
    <article class="connection-card">
      <div class="connection-card-top"><span class="connection-logo" aria-hidden="true">${escapeHTML(item.name.split(/\\s+/).map(part => part[0]).join("").slice(0,2))}</span><span class="connection-status"><i></i> Not connected</span></div>
      <p class="connection-category">${escapeHTML(item.category)}</p>
      <h2>${escapeHTML(item.name)}</h2>
      <p class="connection-description">${escapeHTML(item.description)}</p>
      <div class="connection-card-footer"><span>${escapeHTML(item.kind)}</span><button type="button" class="text-button" data-connection-details="${escapeHTML(item.id)}">View details <span aria-hidden="true">→</span></button></div>
    </article>`).join("");
  const count = document.querySelector("#connections-count");
  if (count) count.textContent = filtered.length + " integration option" + (filtered.length === 1 ? "" : "s");
  const empty = document.querySelector("#connections-empty");
  if (empty) empty.hidden = filtered.length > 0;
}

function showConnectionDetails(id) {
  const item = CONNECTION_CATALOG.find(connection => connection.id === id);
  const panel = document.querySelector("#connection-detail");
  if (!item || !panel) return;
  document.querySelector("#connection-detail-title").textContent = item.name;
  document.querySelector("#connection-detail-description").textContent = item.description;
  document.querySelector("#connection-detail-category").textContent = item.category + " · " + item.kind;
  const requirements = document.querySelector("#connection-detail-requirements");
  requirements.innerHTML = item.requirements.map(value => "<li>" + escapeHTML(value) + "</li>").join("");
  panel.hidden = false;
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function setupConnections() {
  document.querySelector("#connections-search")?.addEventListener("input", renderConnections);
  document.querySelector("#connections-category")?.addEventListener("change", renderConnections);
  document.querySelector("#connections-grid")?.addEventListener("click", event => {
    const button = event.target.closest("[data-connection-details]");
    if (button) showConnectionDetails(button.dataset.connectionDetails);
  });
  document.querySelector("#connection-detail-close")?.addEventListener("click", () => {
    document.querySelector("#connection-detail").hidden = true;
  });
  renderConnections();
}
