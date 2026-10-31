
/* BusinessFlow workspace UI. Cloud goals use the authenticated API; experiments and business memory remain awaiting account-backed persistence. */
"use strict";

const STORAGE_KEY = "businessflow_goals_v1";
const EXPERIMENTS_KEY = "businessflow_experiments_v1";
const MEMORY_KEY = "businessflow_memory_v1";
const LOCAL_GOALS_BACKUP_KEY = "businessflow_goals_local_backup_v1";
let cloudGoalWorkspaceId = null;
let cloudGoalBusy = false;
let cloudExperimentWorkspaceId = null;
let cloudMemoryWorkspaceId = null;
let cloudCollectionBusy = false;

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
  // Persistence diagnostics are intentionally kept out of the customer interface.
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
    showToast("Could not save this record. Please try again.");
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
    if (cloudGoalWorkspaceId !== cloud.businessId) {
      showToast("Wait for the selected workspace to finish loading before saving.");
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
      if (!saveGoals()) showToast("Goal saved to your account, but the secondary copy could not be updated.");
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
  showToast("Goal saved. Connect a business workspace to sync it to your account.");
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
      '"? This removes the goal from your selected workspace.'
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
    showToast(cloud?.signedIn && cloud.apiConnected ? "Goal deleted." : "Unsynced goal deleted.");
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
    showToast(cloud?.signedIn && cloud.apiConnected ? "Progress updated in the cloud." : "Progress updated. This change is not synced to your account yet.");
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
    showToast(cloud?.signedIn && cloud.apiConnected ? "Goal updated in the cloud." : "Goal updated. This change is not synced to your account yet.");
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
  experiments = loadCollection(EXPERIMENTS_KEY).filter(isValidExperiment).map(normalizeExperiment);
}
function normalizeExperiment(item) {
  return {
    id: String(item.id), title: String(item.title).trim().slice(0,120),
    hypothesis: String(item.hypothesis || "").trim().slice(0,1000),
    baseline: item.baseline === null || item.baseline === undefined ? null : Number(item.baseline),
    result: item.result === null || item.result === undefined ? null : Number(item.result),
    status: EXPERIMENT_STATUSES.includes(item.status) ? item.status : "planned",
    notes: String(item.notes || "").slice(0,2000),
    createdAt: item.createdAt || new Date().toISOString(),
    updatedAt: item.updatedAt || item.createdAt || new Date().toISOString()
  };
}
function saveExperiments() { return saveCollection(EXPERIMENTS_KEY, experiments); }
function decodeCloudExperiment(record) {
  let extra = {};
  try {
    const raw = String(record.result_summary || "");
    if (raw.startsWith("BFEXP1:")) extra = JSON.parse(raw.slice(7));
    else if (raw) extra = { notes: raw };
  } catch { extra = {}; }
  return normalizeExperiment({
    id: record.id, title: record.title, hypothesis: record.hypothesis || "",
    baseline: extra.baseline ?? null, result: extra.result ?? null,
    status: extra.status || record.status || "planned", notes: extra.notes || "",
    createdAt: record.created_at, updatedAt: record.updated_at
  });
}
function encodeCloudExperiment(item) {
  const dbStatus = item.status === "review" ? "running" : item.status;
  return {
    id: item.id, title: item.title, hypothesis: item.hypothesis,
    successMetric: null, status: dbStatus,
    resultSummary: "BFEXP1:" + JSON.stringify({
      baseline: item.baseline, result: item.result, status: item.status, notes: item.notes
    }),
    startedAt: item.status === "running" || item.status === "review" ? item.createdAt : null,
    completedAt: item.status === "completed" ? item.updatedAt : null
  };
}
async function loadExperimentsForWorkspace(businessId) {
  const cloud = window.BusinessFlowCloud?.getState?.();
  if (!cloud?.signedIn || !cloud.apiConnected || !businessId) {
    cloudExperimentWorkspaceId = null;
    loadExperiments(); renderExperiments(); return;
  }
  const requestWorkspace = businessId;
  cloudExperimentWorkspaceId = null; experiments = []; renderExperiments();
  try {
    const records = await window.BusinessFlowCloud.loadExperiments(businessId);
    if (window.BusinessFlowCloud.getBusinessId() !== requestWorkspace) return;
    experiments = records.map(decodeCloudExperiment);
    cloudExperimentWorkspaceId = businessId;
    renderExperiments();
  } catch (error) {
    console.error("BusinessFlow experiments could not load:", error);
    showToast("Could not load experiments: " + error.message);
  }
}
async function loadMemoriesForWorkspace(businessId) {
  const cloud = window.BusinessFlowCloud?.getState?.();
  if (!cloud?.signedIn || !cloud.apiConnected || !businessId) {
    cloudMemoryWorkspaceId = null;
    loadMemories(); renderMemories(); return;
  }
  const requestWorkspace = businessId;
  cloudMemoryWorkspaceId = null; memories = []; renderMemories();
  try {
    const records = await window.BusinessFlowCloud.loadMemories(businessId);
    if (window.BusinessFlowCloud.getBusinessId() !== requestWorkspace) return;
    memories = records.map(record => {
      const value = record.content && typeof record.content === "object" ? record.content : {};
      const categoryMap = { business_context:"Other", decision:"Decision", observation:"Customer insight", preference:"Other", lesson:"Lesson learned", experiment_result:"Other" };
      return {
        id: record.id, title: String(value.title || "Business note").slice(0,120),
        category: categoryMap[record.category] || "Other",
        date: String(value.date || record.created_at || new Date().toISOString()).slice(0,10),
        content: String(value.content || "").slice(0,4000),
        createdAt: record.created_at, updatedAt: record.updated_at
      };
    }).filter(isValidMemory);
    cloudMemoryWorkspaceId = businessId;
    renderMemories();
  } catch (error) {
    console.error("BusinessFlow memory could not load:", error);
    showToast("Could not load Business Memory: " + error.message);
  }
}
async function saveExperimentToCloud(item, create) {
  const cloud = window.BusinessFlowCloud?.getState?.();
  if (!cloud?.signedIn || !cloud.apiConnected || !cloud.businessId || cloudExperimentWorkspaceId !== cloud.businessId) throw new Error("Wait for the selected workspace to finish loading before saving.");
  const payload = encodeCloudExperiment(item);
  const saved = create
    ? await window.BusinessFlowCloud.createExperiment(cloud.businessId, payload)
    : await window.BusinessFlowCloud.updateExperiment(cloud.businessId, { ...payload, id: item.id });
  if (create && saved.id) item.id = saved.id;
  return saved;
}
function cloudMemoryCategory(category) {
  return ({ "Decision":"decision", "Customer insight":"observation", "Lesson learned":"lesson", "Process":"business_context", "Follow-up":"decision", "Other":"business_context" })[category] || "business_context";
}
async function saveMemoryToCloud(item, create) {
  const cloud = window.BusinessFlowCloud?.getState?.();
  if (!cloud?.signedIn || !cloud.apiConnected || !cloud.businessId || cloudMemoryWorkspaceId !== cloud.businessId) throw new Error("Wait for the selected workspace to finish loading before saving.");
  const payload = { id:item.id, category:cloudMemoryCategory(item.category), content:{title:item.title,date:item.date,content:item.content} };
  const saved = create
    ? await window.BusinessFlowCloud.createMemory(cloud.businessId,payload)
    : await window.BusinessFlowCloud.updateMemory(cloud.businessId,payload);
  if (create && saved.id) item.id=saved.id;
  return saved;
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

  form.addEventListener("submit", async event => {
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

      const cloud = window.BusinessFlowCloud?.getState?.();
      if (cloud?.signedIn && cloud.apiConnected && cloud.businessId) {
        try { await saveExperimentToCloud(item, false); }
        catch (error) { Object.assign(item, previous); showToast("Experiment update failed: " + error.message); return; }
      }
      if (!saveExperiments()) { Object.assign(item, previous); return; }
      renderExperiments(); cancelExperimentEdit();
      showToast(cloud?.signedIn && cloud.apiConnected && cloud.businessId ? "Experiment updated in your workspace." : "Select a workspace to sync this experiment.");
      return;
    }

    const item = { id:createId(), title, hypothesis, baseline, result, status, notes, createdAt:now, updatedAt:now };
    const cloud = window.BusinessFlowCloud?.getState?.();
    if (!cloud?.signedIn || !cloud.apiConnected || !cloud.businessId) {
      showToast("Select a connected workspace before saving an experiment.");
      return;
    }
    try {
      await saveExperimentToCloud(item, true);
      experiments.unshift(item);
      renderExperiments(); form.reset();
      showToast("Experiment saved to your workspace.");
    } catch (error) { showToast("Experiment save failed: " + error.message); }
  });
}

async function handleExperimentAction(action, id) {
  const index = experiments.findIndex(item => item.id === id);
  if (index < 0) {
    showToast("Experiment not found.");
    return;
  }

  const item = experiments[index];

  if (action === "delete") {
    if (!confirm(
      'Delete "' + item.title +
      '"? This removes the record from your selected workspace.'
    )) return;

    const cloud = window.BusinessFlowCloud?.getState?.();
    if (!cloud?.signedIn || !cloud.apiConnected || !cloud.businessId) { showToast("Select the workspace containing this experiment."); return; }
    try { await window.BusinessFlowCloud.deleteExperiment(cloud.businessId, id); }
    catch (error) { showToast("Experiment delete failed: " + error.message); return; }
    experiments.splice(index, 1);
    if (editingExperimentId === id) cancelExperimentEdit();
    renderExperiments(); showToast("Experiment deleted from your workspace.");
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

  form.addEventListener("submit", async event => {
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

    const item = { id:createId(), title, category, date, content, createdAt:now, updatedAt:now };
    const cloud = window.BusinessFlowCloud?.getState?.();
    if (!cloud?.signedIn || !cloud.apiConnected || !cloud.businessId) {
      showToast("Select a connected workspace before saving Business Memory.");
      return;
    }
    try {
      await saveMemoryToCloud(item, true);
      memories.unshift(item); renderMemories(); form.reset();
      if (dateInput) dateInput.value = new Date().toISOString().slice(0,10);
      showToast("Business Memory saved to your workspace.");
    } catch (error) { showToast("Memory save failed: " + error.message); }
  });
}

async function handleMemoryAction(action, id) {
  const index = memories.findIndex(item => item.id === id);
  if (index < 0) {
    showToast("Memory entry not found.");
    return;
  }

  const item = memories[index];

  if (action === "delete") {
    if (!confirm(
      'Delete "' + item.title +
      '"? This removes the record from your selected workspace.'
    )) return;

    const cloud = window.BusinessFlowCloud?.getState?.();
    if (!cloud?.signedIn || !cloud.apiConnected || !cloud.businessId) { showToast("Select the workspace containing this memory."); return; }
    try { await window.BusinessFlowCloud.deleteMemory(cloud.businessId, id); }
    catch (error) { showToast("Memory delete failed: " + error.message); return; }
    memories.splice(index, 1); renderMemories(); showToast("Memory entry deleted from your workspace.");
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

  const cloud = window.BusinessFlowCloud?.getState?.();
  if (!cloud?.signedIn || !cloud.apiConnected || !cloud.businessId) { Object.assign(item, previous); showToast("Select a connected workspace before editing memory."); return; }
  try { await saveMemoryToCloud(item, false); }
  catch (error) { Object.assign(item, previous); showToast("Memory update failed: " + error.message); return; }
  renderMemories(); showToast("Memory entry updated in your workspace.");
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

  goals = []; cloudGoalWorkspaceId = null; renderGoals();
  const requestedBusinessId = businessId;
  try {
    if (!localStorage.getItem(LOCAL_GOALS_BACKUP_KEY)) {
      const localSnapshot = localStorage.getItem(STORAGE_KEY);
      if (localSnapshot !== null) localStorage.setItem(LOCAL_GOALS_BACKUP_KEY, localSnapshot);
    }
    const records = await window.BusinessFlowCloud.loadGoals(businessId);
    if (window.BusinessFlowCloud.getBusinessId() !== requestedBusinessId) return;
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
    showToast("Sign in and select a business workspace before importing saved records.");
    return;
  }
  if (cloudGoalWorkspaceId !== cloud.businessId || cloudExperimentWorkspaceId !== cloud.businessId || cloudMemoryWorkspaceId !== cloud.businessId) {
    showToast("Wait for all workspace records to finish loading before importing.");
    return;
  }
  let legacy = { goals:[], experiments:[], memories:[] };
  try {
    const goalsRaw = localStorage.getItem(LOCAL_GOALS_BACKUP_KEY) ?? localStorage.getItem(STORAGE_KEY);
    const experimentsRaw = localStorage.getItem(EXPERIMENTS_KEY);
    const memoriesRaw = localStorage.getItem(MEMORY_KEY);
    const goalsParsed = goalsRaw ? JSON.parse(goalsRaw) : [];
    const experimentsParsed = experimentsRaw ? JSON.parse(experimentsRaw) : [];
    const memoriesParsed = memoriesRaw ? JSON.parse(memoriesRaw) : [];
    legacy.goals = Array.isArray(goalsParsed) ? goalsParsed.filter(isValidGoal) : [];
    legacy.experiments = Array.isArray(experimentsParsed) ? experimentsParsed.filter(isValidExperiment).map(normalizeExperiment) : [];
    legacy.memories = Array.isArray(memoriesParsed) ? memoriesParsed.filter(isValidMemory) : [];
  } catch {
    showToast("Saved records could not be read. No import was started.");
    return;
  }
  const total = legacy.goals.length + legacy.experiments.length + legacy.memories.length;
  if (!total) { showToast("There are no saved records waiting to be imported."); return; }
  if (!confirm("Import " + total + " saved records into the selected workspace? Existing records with matching titles will be skipped. Your original copies will be kept.")) return;
  try {
    const [remoteGoals,remoteExperiments,remoteMemories] = await Promise.all([
      window.BusinessFlowCloud.loadGoals(cloud.businessId),
      window.BusinessFlowCloud.loadExperiments(cloud.businessId),
      window.BusinessFlowCloud.loadMemories(cloud.businessId)
    ]);
    const keys = {
      goals:new Set(remoteGoals.map(x=>String(x.title).trim().toLowerCase())),
      experiments:new Set(remoteExperiments.map(x=>String(x.title).trim().toLowerCase())),
      memories:new Set(remoteMemories.map(x=>String(x.content?.title || "").trim().toLowerCase()))
    };
    let imported=0,skipped=0;
    for(const item of legacy.goals){
      const key=item.title.trim().toLowerCase();
      if(keys.goals.has(key)){skipped++;continue;}
      await window.BusinessFlowCloud.createGoal(cloud.businessId,item);keys.goals.add(key);imported++;
    }
    for(const item of legacy.experiments){
      const key=item.title.trim().toLowerCase();
      if(keys.experiments.has(key)){skipped++;continue;}
      await saveExperimentToCloud(item,true);keys.experiments.add(key);imported++;
    }
    for(const item of legacy.memories){
      const key=item.title.trim().toLowerCase();
      if(keys.memories.has(key)){skipped++;continue;}
      await saveMemoryToCloud(item,true);keys.memories.add(key);imported++;
    }
    await Promise.all([
      loadCloudGoalsForWorkspace(cloud.businessId),
      loadExperimentsForWorkspace(cloud.businessId),
      loadMemoriesForWorkspace(cloud.businessId)
    ]);
    showToast("Import complete: " + imported + " saved and " + skipped + " matching records skipped. Original copies were kept.");
  } catch(error) {
    showToast("Import stopped: " + error.message + ". Original copies were kept; you can safely retry.");
  }
}
window.addEventListener("businessflow:auth-state", event => {
  const signedIn = Boolean(event.detail?.signedIn);
  if (!signedIn) navigateTo("account");
});

window.addEventListener("businessflow:workspace-ready", event => {
  const required = Boolean(event.detail?.onboardingRequired);
  const hasWorkspace = Boolean(event.detail?.hasWorkspace);
  const gate = document.querySelector("#onboarding-gate");
  if (gate) gate.hidden = !required || hasWorkspace;
  updateWorkspaceIdentity({ signedIn: true, apiConnected: true, businessId: event.detail?.businessId, businessName: event.detail?.businessName });
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
  void loadExperimentsForWorkspace(businessId);
  void loadMemoriesForWorkspace(businessId);
  void loadBusinessInsights(businessId);
});

let latestBusinessInsights = null;
function renderAnalyticsMetrics(result) {
  const setMetric = (key, value, note) => {
    const valueNode = document.querySelector('[data-analytics-metric="' + key + '"]');
    const noteNode = document.querySelector('[data-analytics-note="' + key + '"]');
    if (valueNode) valueNode.textContent = value;
    if (noteNode) noteNode.textContent = note;
  };
  if (!result) {
    setMetric("revenue", "—", "Awaiting mapped revenue records");
    setMetric("customers", "—", "Awaiting customer identifiers");
    setMetric("conversion", "—", "Not available from current imports");
    const chart = document.querySelector("#analytics-revenue-chart");
    if (chart) chart.innerHTML = '<p class="empty-state">Select a workspace to load your revenue trend.</p>';
    return;
  }
  const metrics = result.metrics || {};
  const currency = metrics.revenueCurrency || "XOF";
  const number = value => Number(value).toLocaleString(undefined,{maximumFractionDigits:2});
  setMetric("revenue", metrics.revenueTotal === null || metrics.revenueTotal === undefined ? "—" : number(metrics.revenueTotal) + " " + currency,
    metrics.revenueRecords + " readable transaction values");
  setMetric("customers", metrics.customers === null || metrics.customers === undefined ? "—" : number(metrics.customers),
    metrics.customers === null || metrics.customers === undefined ? "Customer identity is not mapped" : "Distinct mapped customers");
  setMetric("conversion", "—", "Not available from current imports");
  const chart = document.querySelector("#analytics-revenue-chart");
  if (!chart) return;
  const months = Array.isArray(metrics.monthlyRevenue) ? metrics.monthlyRevenue : [];
  if (!months.length) {
    chart.innerHTML = '<p class="empty-state">No dated revenue records are available. Map both Revenue and Order date to build this trend.</p>';
    return;
  }
  const maximum = Math.max(1,...months.map(item=>Math.abs(Number(item.total)||0)));
  chart.classList.remove("chart-empty");
  chart.innerHTML = '<div class="revenue-trend-list">' + months.map(item => {
    const value = Number(item.total)||0;
    const width = Math.max(2,Math.round(Math.abs(value)/maximum*100));
    const label = String(item.month || "");
    return '<div class="revenue-trend-row"><div class="revenue-trend-label"><span>' + escapeHTML(label) + '</span><strong>' + escapeHTML(number(value)) + ' ' + escapeHTML(currency) + '</strong></div><div class="revenue-trend-track"><span style="width:' + width + '%"></span></div></div>';
  }).join("") + '</div>';
}
function renderBusinessInsights() {
  const overview = document.querySelector("#overview-insights");
  const analytics = document.querySelector("#analytics-insights");
  const status = document.querySelector("#overview-intelligence-status");
  const result = latestBusinessInsights;
  if (!result) {
    if (overview) overview.innerHTML = '<p class="empty-state">Select a workspace to generate your first business analysis.</p>';
    if (analytics) analytics.innerHTML = '<p class="empty-state">Select a workspace to generate verified business insights.</p>';
    if (status) status.textContent = "Waiting for a selected workspace.";
    renderAnalyticsMetrics(null);
    return;
  }
  const coverage = result.coverage || {};
  renderAnalyticsMetrics(result);
  if (status) status.textContent = result.engine === "businessflow_rules_v1"
    ? coverage.recordsAnalysed + " records analysed · " + coverage.datasetCount + " datasets · Evidence-based rules engine"
    : "Business analysis";
  const markup = (result.insights || []).map(item => {
    const priority = item.priority === "high" ? "Priority" : item.priority === "low" ? "Monitor" : "Insight";
    return '<article class="insight-item"><div class="insight-item-top"><span class="insight-type">' + escapeHTML(priority) + '</span><strong>' + escapeHTML(item.title) + '</strong></div><p>' + escapeHTML(item.summary) + '</p><small><b>Evidence:</b> ' + escapeHTML(item.evidence || "No supporting records") + '</small><p class="insight-action"><b>Recommended next step:</b> ' + escapeHTML(item.recommendedAction) + '</p></article>';
  }).join("");
  const content = markup || '<p class="empty-state">No recommendations are available yet.</p>';
  if (overview) overview.innerHTML = content;
  if (analytics) analytics.innerHTML = content;
}
async function loadBusinessInsights(businessId) {
  const cloud = window.BusinessFlowCloud;
  if (!businessId || !cloud?.getState?.().signedIn || !cloud?.getState?.().apiConnected || typeof cloud.loadInsights !== "function") {
    latestBusinessInsights = null;
    renderBusinessInsights();
    return;
  }
  latestBusinessInsights = null;
  renderBusinessInsights();
  const status = document.querySelector("#overview-intelligence-status");
  if (status) status.textContent = "Analysing your business records…";
  try {
    const result = await cloud.loadInsights(businessId);
    if (cloud.getBusinessId() !== businessId) return;
    latestBusinessInsights = result;
    renderBusinessInsights();
  } catch (error) {
    latestBusinessInsights = null;
    if (status) status.textContent = error.message || "Business intelligence could not load.";
    renderBusinessInsights();
  }
}
function updateWorkspaceIdentity(state = {}) {
  const name = String(state.businessName || "").trim();
  const signedIn = Boolean(state.signedIn);
  const connected = Boolean(state.apiConnected);
  const profileName = document.querySelector("#workspace-profile-name");
  const avatar = document.querySelector("#workspace-avatar");
  const caption = document.querySelector("#workspace-profile-caption");
  const syncLabel = document.querySelector("#workspace-sync-label");
  const greeting = document.querySelector("#overview-greeting");
  const manageButton = document.querySelector("#manage-workspace-button");
  if (profileName) profileName.textContent = name || (signedIn ? "Choose a workspace" : "Your business");
  if (avatar) avatar.textContent = name ? name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() : "BF";
  if (caption) caption.textContent = name ? "Active business workspace" : "Business workspace";
  if (syncLabel) syncLabel.textContent = !signedIn ? "Sign in to sync your workspace" : !connected ? "Connection unavailable" : name ? "Connected · " + name : "Connected · Select a workspace";
  if (greeting) {
    const hour = new Date().getHours();
    const salutation = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    greeting.textContent = name ? salutation + ", " + name + "." : salutation + ".";
  }
  if (manageButton) manageButton.textContent = name ? "Manage workspace" : "Set up workspace";
  document.body.classList.toggle("workspace-ready", Boolean(signedIn && connected && state.businessId));
}

window.addEventListener("businessflow:cloud-state", event => {
  const state = event.detail ?? {};
  updateWorkspaceIdentity(state);
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
  setupDataImport();

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
  renderBusinessInsights();
  updateStorageStatus();

  const initialPage = location.hash.slice(1);
  const page = document.getElementById(initialPage);

  if (page?.classList.contains("page")) {
    navigateTo(initialPage);
  }
}

/* Startup is registered after feature declarations at the end of this file. */

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

/* CSV / Excel dataset import */
const IMPORT_MAPPING_OPTIONS = [["","Keep as source field"],["customer_name","Customer name"],["email","Email address"],["phone","Phone number"],["revenue","Revenue / amount"],["order_date","Order / transaction date"],["product","Product / service"],["quantity","Quantity"],["status","Status"],["customer_id","Customer ID"],["location","Location"],["notes","Notes / description"]];
let pendingImport = null;
let importedDatasets = [];

function parseCsvText(source) {
  const rows=[]; let row=[], cell="", quoted=false;
  for(let i=0;i<source.length;i++){const ch=source[i];
    if(quoted){if(ch==='"'&&source[i+1]==='"'){cell+='"';i++;}else if(ch==='"')quoted=false;else cell+=ch;}
    else if(ch==='"'&&cell.length===0)quoted=true;
    else if(ch===","){row.push(cell);cell="";}
    else if(ch==="\n"||ch==="\r"){if(ch==="\r"&&source[i+1]==="\n")i++;row.push(cell);cell="";if(row.some(v=>v.trim()!==""))rows.push(row);row=[];if(rows.length>252)throw Error("This file has more than 250 data rows. Split it into smaller imports.");}
    else cell+=ch;
  }
  if(quoted)throw Error("The CSV contains an unfinished quoted field.");
  if(cell.length||row.length){row.push(cell);if(row.some(v=>v.trim()!==""))rows.push(row);}
  return rows;
}
function normalizeImportRows(matrix){
  if(!Array.isArray(matrix)||matrix.length<2)throw Error("The file needs a header row and at least one data row.");
  const raw=matrix[0].map((v,i)=>String(v??"").trim()||"Column "+(i+1));
  if(raw.length>40)throw Error("This file has more than 40 columns.");
  const seen=new Map(),columns=raw.map(name=>{const key=name.toLowerCase(),count=(seen.get(key)||0)+1;seen.set(key,count);return count===1?name:name+" ("+count+")";});
  const data=matrix.slice(1).filter(row=>row.some(v=>String(v??"").trim()!==""));
  if(!data.length)throw Error("No data rows were found below the header.");
  if(data.length>250)throw Error("This import has "+data.length+" rows. The current limit is 250.");
  const rows=data.map((row,index)=>{const out={};columns.forEach((column,i)=>{const value=row[i]===null||row[i]===undefined?"":String(row[i]);if(value.length>1000)throw Error("A cell in data row "+(index+1)+" exceeds 1,000 characters.");out[column]=value;});return out;});
  return {columns,rows};
}
async function readImportFile(file){
  if(!file)throw Error("Choose a file first.");
  if(file.size>2*1024*1024)throw Error("The file is larger than 2 MB. Split it into smaller files.");
  const name=file.name.toLowerCase();let matrix;
  if(name.endsWith(".csv")||file.type==="text/csv")matrix=parseCsvText(await file.text());
  else if(name.endsWith(".xlsx")||name.endsWith(".xls")){
    if(!window.XLSX)throw Error("The Excel reader could not load. Check your connection or save the workbook as CSV.");
    const workbook=window.XLSX.read(await file.arrayBuffer(),{type:"array",cellDates:false,raw:true});
    const sheet=workbook.Sheets[workbook.SheetNames[0]];
    if(!sheet)throw Error("The workbook has no readable worksheet.");
    matrix=window.XLSX.utils.sheet_to_json(sheet,{header:1,raw:true,defval:""});
  }else throw Error("Choose a CSV, XLSX, or XLS file.");
  return normalizeImportRows(matrix);
}
function inferImportBusinessField(column, rows) {
  const name = String(column || "").toLowerCase();
  const samples = (Array.isArray(rows) ? rows : []).slice(0, 30)
    .map(row => String(row?.[column] ?? "").trim()).filter(Boolean);
  const sample = samples[0] || "";
  if (/e-?mail/.test(name) || samples.some(value => /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(value))) return "email";
  if (/phone|mobile|tel|whatsapp/.test(name) || samples.filter(value => /^\\+?[0-9() .-]{7,}$/.test(value)).length >= Math.max(2, Math.ceil(samples.length * 0.7))) return "phone";
  if (/customer.?name|client.?name|buyer.?name|full.?name/.test(name)) return "customer_name";
  if (/customer.?id|client.?id|buyer.?id|account.?id/.test(name)) return "customer_id";
  if (/date|day|created|transaction.?time|timestamp/.test(name) || samples.filter(value => /^\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}/.test(value) || /^\\d{1,2}[-/]\\d{1,2}[-/]\\d{2,4}$/.test(value)).length >= Math.max(2, Math.ceil(samples.length * 0.7))) return "order_date";
  if (/revenue|amount|price|cost|payment|paid|sales|income|turnover|fee|charge/.test(name)) return "revenue";
  if (/quantity|qty|units|items.?count/.test(name)) return "quantity";
  if (/product|item|service|job|package|offering/.test(name)) return "product";
  if (/status|progress|state/.test(name)) return "status";
  if (/location|address|area|zone|city|region|branch/.test(name)) return "location";
  if (/note|description|comment|detail|remark/.test(name)) return "notes";
  return "";
}
function renderImportReview(){
  if(!pendingImport)return;
  const review=document.querySelector("#import-review"),mappings=document.querySelector("#import-column-mapping"),head=document.querySelector("#import-preview-head"),body=document.querySelector("#import-preview-body");
  if(!review||!mappings||!head||!body)return;
  review.hidden=false;document.querySelector("#import-row-count").textContent=pendingImport.rows.length+" rows · "+pendingImport.columns.length+" columns";
  mappings.replaceChildren();
  const assignedFields = new Set();
  pendingImport.columns.forEach(column=>{
    const label=document.createElement("label");label.className="import-mapping-item";
    const title=document.createElement("span");title.textContent=column;
    const select=document.createElement("select");select.dataset.importColumn=column;
    IMPORT_MAPPING_OPTIONS.forEach(([value,text])=>{const option=document.createElement("option");option.value=value;option.textContent=text;select.append(option);});
    let guess=inferImportBusinessField(column,pendingImport.rows);
    if(guess && assignedFields.has(guess)) guess="";
    if(guess) assignedFields.add(guess);
    select.value=guess;
    select.addEventListener("change",()=>{
      const selected=select.value;
      if(!selected)return;
      const duplicate=[...mappings.querySelectorAll("[data-import-column]")].find(other=>other!==select&&other.value===selected);
      if(duplicate){
        duplicate.value="";
        document.querySelector("#import-review-status").textContent="BusinessFlow kept both source columns. Only one is mapped to each standard field; the other remains available for Intelligence analysis.";
      }
    });
    label.append(title,select);mappings.append(label);
  });
  head.replaceChildren();body.replaceChildren();
  const hr=document.createElement("tr");pendingImport.columns.forEach(c=>{const th=document.createElement("th");th.textContent=c;hr.append(th);});head.append(hr);
  pendingImport.rows.slice(0,10).forEach(row=>{const tr=document.createElement("tr");pendingImport.columns.forEach(c=>{const td=document.createElement("td");td.textContent=row[c]??"";tr.append(td);});body.append(tr);});
  document.querySelector("#import-review-status").textContent="BusinessFlow Intelligence has suggested fields from your column names and sample values. Unmapped columns will still be saved and analysed.";
  document.querySelector("#import-save").disabled=false;
}
function currentImportMapping(){
  const mapping={},assigned=new Set();
  document.querySelectorAll("[data-import-column]").forEach(select=>{
    const field=select.value||null;
    if(field && assigned.has(field)){select.value="";mapping[select.dataset.importColumn]=null;return;}
    if(field)assigned.add(field);
    mapping[select.dataset.importColumn]=field;
  });
  return mapping;
}
async function loadSavedImports(){
  const list=document.querySelector("#saved-imports-list"),status=document.querySelector("#saved-imports-status"),cloud=window.BusinessFlowCloud?.getState?.();if(!list||!status)return;
  if(!cloud?.signedIn||!cloud?.apiConnected||!cloud?.businessId){list.innerHTML='<p class="empty-state">Sign in, connect to the BusinessFlow API, and select a business workspace to view saved datasets.</p>';status.textContent="";importedDatasets=[];return;}
  status.textContent="Loading saved datasets…";
  try{
    const result=await window.BusinessFlowCloud.request("/api/business-intelligence/imports?business_id="+encodeURIComponent(cloud.businessId));
    importedDatasets=Array.isArray(result.imports)?result.imports:[];list.replaceChildren();
    if(!importedDatasets.length){const empty=document.createElement("p");empty.className="empty-state";empty.textContent="No datasets imported yet. Choose a file above to get started.";list.append(empty);}
    importedDatasets.forEach(item=>{const row=document.createElement("div");row.className="record-item import-record";const content=document.createElement("div");content.className="record-content";const title=document.createElement("strong");title.textContent=item.name;const detail=document.createElement("p");detail.textContent=item.source_filename+" · "+item.row_count+" rows · "+new Date(item.created_at).toLocaleString();content.append(title,detail);const button=document.createElement("button");button.className="small-button";button.type="button";button.textContent="View data";button.dataset.importId=item.id;row.append(content,button);list.append(row);});
    status.textContent=importedDatasets.length+" saved dataset"+(importedDatasets.length===1?"":"s")+" in this workspace.";
  }catch(error){status.textContent=error.message||"Could not load saved datasets.";}
}
function buildDatasetReadout(dataset){
  const mapping=dataset.column_mapping&&typeof dataset.column_mapping==="object"?dataset.column_mapping:{};
  const sourceFor=field=>Object.keys(mapping).find(column=>mapping[column]===field);
  const rows=Array.isArray(dataset.rows)?dataset.rows:[];
  const cards=[{label:"Records imported",value:String(rows.length)}],notes=[];
  const customerColumn=sourceFor("customer_name")||sourceFor("customer_id")||sourceFor("email")||sourceFor("phone");
  if(customerColumn){const unique=new Set(rows.map(row=>String(row[customerColumn]??"").trim().toLowerCase()).filter(Boolean));cards.push({label:"Distinct customers",value:String(unique.size)});}
  const revenueColumn=sourceFor("revenue");
  if(revenueColumn){
    const values=rows.map(row=>{const raw=String(row[revenueColumn]??"").trim();if(!raw)return null;const normalized=raw.replace(/,/g,"").replace(/[^0-9.\\-]/g,"");if(!normalized||normalized==="-"||normalized==="."||normalized==="-.")return null;const n=Number(normalized);return Number.isFinite(n)?n:null;}).filter(v=>v!==null);
    if(values.length){const total=values.reduce((sum,v)=>sum+v,0);cards.push({label:"Total mapped amount",value:total.toLocaleString(undefined,{maximumFractionDigits:2})});cards.push({label:"Average amount",value:(total/values.length).toLocaleString(undefined,{maximumFractionDigits:2})});notes.push("Amount summary uses "+values.length+" numeric values from “"+revenueColumn+"”. Confirm the currency and meaning of this column before using it as revenue.");}
    else notes.push("The mapped amount column “"+revenueColumn+"” contains no readable numeric values.");
  }else notes.push("Map the column containing job prices, payments or sales amounts to “Revenue / amount” to calculate totals.");
  const dateColumn=sourceFor("order_date");
  if(dateColumn){const dates=rows.map(row=>new Date(row[dateColumn])).filter(d=>!Number.isNaN(d.getTime())).sort((a,b)=>a-b);if(dates.length)cards.push({label:"Date coverage",value:dates[0].toLocaleDateString()+" – "+dates[dates.length-1].toLocaleDateString()});}
  const statusColumn=sourceFor("status");
  if(statusColumn){const counts=new Map();rows.forEach(row=>{const value=String(row[statusColumn]??"").trim();if(value)counts.set(value,(counts.get(value)||0)+1);});if(counts.size)notes.push("Status breakdown: "+[...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,4).map(([label,count])=>label+": "+count).join(" · "));}
  if(!customerColumn)notes.push("Map a customer/client name, ID, email or phone column to count distinct customers.");
  if(!dateColumn)notes.push("Map your cleaning/job date column to show the period covered.");
  return {cards,notes};
}
async function viewSavedImport(id){
  const cloud=window.BusinessFlowCloud?.getState?.(),panel=document.querySelector("#saved-import-detail");if(!cloud?.businessId||!panel)return;
  panel.hidden=false;panel.textContent="Loading dataset…";
  try{
    const result=await window.BusinessFlowCloud.request("/api/business-intelligence/imports/"+encodeURIComponent(id)+"?business_id="+encodeURIComponent(cloud.businessId)),dataset=result.import;
    panel.replaceChildren();const title=document.createElement("h3");title.textContent=dataset.name;const meta=document.createElement("p");meta.textContent=dataset.row_count+" rows · "+dataset.columns.length+" columns · "+dataset.source_filename;
    const analysis=buildDatasetReadout(dataset);const analysisPanel=document.createElement("section");analysisPanel.className="dataset-readout";const analysisTitle=document.createElement("h4");analysisTitle.textContent="BusinessFlow data readout";analysisPanel.append(analysisTitle);const analysisNote=document.createElement("p");analysisNote.className="muted";analysisNote.textContent="Calculated from your saved records and column mapping. These are summaries, not invented forecasts.";analysisPanel.append(analysisNote);const cards=document.createElement("div");cards.className="dataset-readout-grid";analysis.cards.forEach(item=>{const card=document.createElement("article");card.className="dataset-readout-card";const label=document.createElement("span");label.textContent=item.label;const value=document.createElement("strong");value.textContent=item.value;card.append(label,value);cards.append(card);});analysisPanel.append(cards);if(analysis.notes.length){const list=document.createElement("ul");analysis.notes.forEach(note=>{const li=document.createElement("li");li.textContent=note;list.append(li);});analysisPanel.append(list);}panel.append(analysisPanel);const wrap=document.createElement("div");wrap.className="import-preview-wrap";const table=document.createElement("table");table.className="import-preview-table";const thead=document.createElement("thead"),tr=document.createElement("tr");
    dataset.columns.forEach(c=>{const th=document.createElement("th");th.textContent=c;tr.append(th);});thead.append(tr);const tbody=document.createElement("tbody");
    dataset.rows.slice(0,25).forEach(row=>{const line=document.createElement("tr");dataset.columns.forEach(c=>{const td=document.createElement("td");td.textContent=row[c]??"";line.append(td);});tbody.append(line);});
    table.append(thead,tbody);wrap.append(table);panel.append(title,meta,wrap);if(dataset.rows.length>25){const note=document.createElement("p");note.className="muted";note.textContent="Showing the first 25 rows of "+dataset.rows.length+".";panel.append(note);}
  }catch(error){panel.textContent=error.message||"Could not load this dataset.";}
}
function setupDataImport(){
  const input=document.querySelector("#import-file");
  const fileStatus=document.querySelector("#import-file-status");
  const review=document.querySelector("#import-review");
  if(!input||!fileStatus||!review)return;

  // Keep a visible, direct picker control for iPhone/Safari. The native input
  // remains available as a fallback and both paths use the same handler.
  let chooseButton=document.querySelector("#import-choose-file");
  if(!chooseButton){
    chooseButton=document.createElement("button");
    chooseButton.type="button";
    chooseButton.id="import-choose-file";
    chooseButton.className="secondary-button";
    chooseButton.textContent="Choose file";
    chooseButton.style.marginTop="12px";
    input.closest(".import-dropzone")?.insertAdjacentElement("afterend",chooseButton);
  }
  chooseButton.addEventListener("click",()=>{fileStatus.textContent="Choose a CSV or Excel file from Files on your device.";input.click();});

  let processingFile=null;
  const handleSelectedFile=async()=>{
    const file=input.files&&input.files.length?input.files[0]:null;
    if(!file){
      fileStatus.textContent="No file selected yet. Tap Choose file and select a file in the Files picker.";
      return;
    }
    if(processingFile===file)return;
    processingFile=file;
    pendingImport=null;
    review.hidden=true;
    fileStatus.textContent="File selected: "+file.name+". Reading file…";
    try{
      pendingImport=await readImportFile(file);
      pendingImport.filename=file.name;
      const name=document.querySelector("#import-dataset-name");
      if(name&&!name.value.trim())name.value=file.name.replace(/\.(csv|xlsx|xls)$/i,"").slice(0,160);
      fileStatus.textContent="File ready: "+file.name+". Review the preview below, then tap Add to BusinessFlow.";
      renderImportReview();
      review.scrollIntoView({behavior:"smooth",block:"start"});
    }catch(error){
      fileStatus.textContent="Could not read "+file.name+": "+(error.message||"Unsupported or invalid file.");
    }finally{
      processingFile=null;
    }
  };
  input.addEventListener("change",handleSelectedFile);
  input.addEventListener("input",handleSelectedFile);
  // Capture file changes at document level as well: iOS Safari can behave
  // differently when the native picker is opened from a label.
  document.addEventListener("change",event=>{
    if(event.target===input)void handleSelectedFile();
  },true);
  // Re-check after the iOS Files picker returns focus/visibility to the page.
  const recheckSelectedFile=()=>{
    if(input.files&&input.files.length)void handleSelectedFile();
  };
  window.addEventListener("focus",recheckSelectedFile);
  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState==="visible")recheckSelectedFile();
  });

  document.querySelector("#import-save")?.addEventListener("click",async()=>{
    const button=document.querySelector("#import-save");
    const status=document.querySelector("#import-review-status");
    const cloud=window.BusinessFlowCloud?.getState?.();
    if(!pendingImport){status.textContent="Choose and review a file first.";return;}
    if(!cloud?.signedIn||!cloud?.apiConnected||!cloud?.businessId){status.textContent="Sign in and select a connected business workspace before saving.";return;}
    button.disabled=true;
    status.textContent="Validating and saving the reviewed dataset…";
    try{
      const mapping=currentImportMapping();
      const name=document.querySelector("#import-dataset-name").value.trim();
      if(!name)throw Error("Enter a name for this dataset.");
      const result=await window.BusinessFlowCloud.request("/api/business-intelligence/imports",{method:"POST",body:JSON.stringify({business_id:cloud.businessId,name,source_filename:pendingImport.filename,columns:pendingImport.columns,column_mapping:mapping,rows:pendingImport.rows})});
      status.textContent="Added "+result.import.row_count+" rows to this business workspace.";
      showToast("Dataset added to BusinessFlow.");
      await loadSavedImports();
      status.textContent="Dataset saved. BusinessFlow Intelligence is analysing the updated workspace…";
      await loadBusinessInsights(cloud.businessId);
      document.querySelector("#saved-import-detail")?.setAttribute("hidden","");
      navigateTo("overview");
      status.textContent="Dataset added. Your BusinessFlow dashboard has been updated with the available findings.";
    }catch(error){status.textContent=error.message||"Import failed. Your file remains on this device.";}
    finally{button.disabled=false;}
  });
  document.querySelector("#imports-refresh")?.addEventListener("click",loadSavedImports);
  document.querySelector("#saved-imports-list")?.addEventListener("click",event=>{const button=event.target.closest("[data-import-id]");if(button)viewSavedImport(button.dataset.importId);});
  window.addEventListener("businessflow:cloud-state",loadSavedImports);
  renderImportReview();
  loadSavedImports();
}


/* Persistent BusinessFlow Intelligence conversations */
function initializeBusinessFlowChat() {
  const panel = document.querySelector("#businessflow-intelligence-panel");
  const list = document.querySelector("#bf-conversation-list");
  const messages = document.querySelector("#bf-chat-messages");
  const form = document.querySelector("#bf-chat-form");
  const input = document.querySelector("#bf-chat-input");
  const send = document.querySelector("#bf-chat-send");
  const status = document.querySelector("#bf-chat-status");
  const newButton = document.querySelector("#bf-new-conversation");
  if (!panel || !list || !messages || !form || !input || !send) return;

  let conversations = [];
  let activeConversationId = null;
  let busy = false;
  let pendingClientMessageId = null;
  let pendingClientMessageContent = null;
  const api = () => window.BusinessFlowCloud;
  const state = () => api()?.getState?.() ?? {};
  const setStatus = value => { if (status) status.textContent = value; };
  const uuid = () => window.crypto?.randomUUID?.() || null;

  function renderList() {
    if (!conversations.length) {
      list.innerHTML = '<p class="empty-state">No conversations yet. Start a new one.</p>';
      return;
    }
    list.innerHTML = conversations.map(item =>
      '<button type="button" class="bf-conversation-item' + (item.id === activeConversationId ? ' active' : '') +
      '" data-conversation-id="' + escapeHTML(item.id) + '"><strong>' + escapeHTML(item.title || 'New conversation') +
      '</strong><small>' + escapeHTML(new Date(item.updated_at).toLocaleDateString()) + '</small></button>'
    ).join("");
  }

  function renderMessages(items) {
    if (!items.length) {
      messages.innerHTML = '<div class="bf-chat-empty"><strong>What should we work on?</strong><p>Ask a question about your business. I will use the records saved in this workspace.</p></div>';
      return;
    }
    messages.innerHTML = items.map(item =>
      '<article class="bf-message ' + (item.role === "user" ? "user" : "assistant") + '"><span>' +
      (item.role === "user" ? "YOU" : "BUSINESSFLOW INTELLIGENCE") + '</span><p>' +
      formatText(item.content) + '</p></article>'
    ).join("");
    messages.scrollTop = messages.scrollHeight;
  }

  async function loadConversations(keepActive = true) {
    const current = state();
    if (!current.signedIn || !current.apiConnected || !current.businessId) {
      conversations = [];
      activeConversationId = null;
      renderList();
      renderMessages([]);
      setStatus("Sign in and select a business workspace to use saved conversations.");
      return;
    }
    setStatus("Loading your saved conversations…");
    try {
      const result = await api().request("/api/business-intelligence/conversations?business_id=" + encodeURIComponent(current.businessId));
      conversations = Array.isArray(result.conversations) ? result.conversations : [];
      if (!keepActive || !conversations.some(item => item.id === activeConversationId)) {
        activeConversationId = conversations[0]?.id ?? null;
      }
      renderList();
      if (activeConversationId) await loadMessages(activeConversationId);
      else renderMessages([]);
      setStatus("Conversation history is saved to this business workspace.");
    } catch (error) {
      setStatus(error.message || "Could not load conversation history.");
    }
  }

  async function loadMessages(conversationId) {
    const result = await api().request("/api/business-intelligence/conversations/" + encodeURIComponent(conversationId) + "/messages");
    if (activeConversationId === conversationId) renderMessages(Array.isArray(result.messages) ? result.messages : []);
  }

  async function createConversation() {
    const current = state();
    if (!current.signedIn || !current.apiConnected || !current.businessId) {
      setStatus("Sign in and select a business workspace first.");
      return;
    }
    if (busy) return;
    busy = true;
    newButton.disabled = true;
    try {
      const result = await api().request("/api/business-intelligence/conversations", {
        method: "POST",
        body: JSON.stringify({ business_id: current.businessId, title: "New conversation" })
      });
      activeConversationId = result.conversation.id;
      conversations.unshift(result.conversation);
      renderList();
      renderMessages([]);
      input.focus();
      setStatus("New conversation created. Your messages will be saved automatically.");
    } catch (error) {
      setStatus(error.message || "Could not create a conversation.");
    } finally {
      busy = false;
      newButton.disabled = false;
    }
  }

  list.addEventListener("click", async event => {
    const button = event.target.closest("[data-conversation-id]");
    if (!button || busy) return;
    activeConversationId = button.dataset.conversationId;
    renderList();
    renderMessages([]);
    try { await loadMessages(activeConversationId); }
    catch (error) { setStatus(error.message || "Could not load messages."); }
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const content = input.value.trim();
    if (!content || busy) return;
    const current = state();
    if (!current.signedIn || !current.apiConnected || !current.businessId) {
      setStatus("Sign in and select a business workspace before sending a message.");
      return;
    }
    if (!activeConversationId) await createConversation();
    if (!activeConversationId) return;
    if (pendingClientMessageContent !== content) {
      pendingClientMessageId = uuid();
      pendingClientMessageContent = content;
    }
    const clientMessageId = pendingClientMessageId;
    if (!clientMessageId) {
      setStatus("Unable to create a secure message ID. Please try again.");
      return;
    }
    busy = true;
    send.disabled = true;
    input.disabled = true;
    const previous = input.value;
    input.value = "";
    setStatus("BusinessFlow Intelligence is reviewing your workspace…");
    try {
      const result = await api().request("/api/business-intelligence/conversations/" + encodeURIComponent(activeConversationId) + "/messages", {
        method: "POST",
        body: JSON.stringify({ content, client_message_id: clientMessageId })
      });
      const items = await api().request("/api/business-intelligence/conversations/" + encodeURIComponent(activeConversationId) + "/messages");
      renderMessages(items.messages || []);
      const found = conversations.find(item => item.id === activeConversationId);
      if (found) found.updated_at = new Date().toISOString();
      conversations.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
      renderList();
      pendingClientMessageId = null;
      pendingClientMessageContent = null;
      setStatus(result.replayed ? "Previous response restored safely." : "Saved to your business workspace.");
    } catch (error) {
      input.value = previous;
      setStatus(error.message || "Message could not be saved. Your text is still here so you can retry.");
    } finally {
      busy = false;
      send.disabled = false;
      input.disabled = false;
      input.focus();
    }
  });

  newButton.addEventListener("click", createConversation);
  window.addEventListener("businessflow:cloud-state", () => { void loadConversations(false); });
  window.addEventListener("businessflow:workspace-changed", () => { void loadConversations(false); });
  void loadConversations(false);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { initializeBusinessFlow(); initializeBusinessFlowChat(); }, {
    once: true
  });
} else {
  initializeBusinessFlow();
  initializeBusinessFlowChat();
}
