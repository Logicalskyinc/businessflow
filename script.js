/* BusinessFlow — Business Goals + Local Persistence
Browser prototype only. No backend or database connection.
*/

"use strict";

const STORAGE_KEY = "businessflow_goals_v1";

const DEFAULT_GOALS = [
{
id: "revenue-1000000",
title: "Increase revenue",
current: 680000,
target: 1000000,
unit: "₦",
createdAt: new Date().toISOString()
},
{
id: "customers-100",
title: "Acquire customers",
current: 45,
target: 100,
unit: "customers",
createdAt: new Date().toISOString()
}
];

let goals = [];
let storageAvailable = true;

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
  throw new Error("Invalid saved goals format");
}
goals = parsed.filter(goal =>
  goal &&
  typeof goal.id === "string" &&
  typeof goal.title === "string" &&
  Number.isFinite(Number(goal.current)) &&
  Number.isFinite(Number(goal.target)) &&
  Number(goal.target) > 0
);

} catch (error) {
storageAvailable = false;
goals = DEFAULT_GOALS.map(goal => ({ ...goal }));
console.error("BusinessFlow could not load saved goals:", error);
}
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
showToast("Could not save changes. Browser storage may be unavailable.");
return false;
}
}

function escapeHTML(value) {
return String(value).replace(/[&<>"']/g, character => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
})[character]);
}
}

function getProgress(goal) {
const current = Math.max(0, Number(goal.current) || 0);
const target = Math.max(1, Number(goal.target) || 1);

return Math.min(100, Math.round((current / target) * 100));
}

function formatNumber(value) {
return new Intl.NumberFormat().format(Number(value) || 0);
}

function formatGoalValue(value, unit) {
const number = formatNumber(value);

if (unit === "₦") {
return "₦" + number;
}

return number + (unit ? " " + escapeHTML(unit) : "");
}

function renderGoalList(container) {
if (!container) return;

if (goals.length === 0) {
container.innerHTML =
'No goals yet. Create your first business goal.';
return;
}

container.innerHTML = goals.map(goal => {
const progress = getProgress(goal);
const current = Math.max(0, Number(goal.current) || 0);
const target = Number(goal.target) || 1;
const title = escapeHTML(goal.title);
const id = escapeHTML(goal.id);
const unit = goal.unit || "units";

return `
  <article class="goal-item" data-goal-id="${id}">
    <div class="goal-top">
      <strong>${title}</strong>
      <span>${progress}%</span>
    </div>
    <div
      class="progress-track"
      role="progressbar"
      aria-label="${title} progress"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow="${progress}"
    >
      <div
        class="progress-fill ${progress >= 100 ? "complete" : ""}"
        style="width:${progress}%"
      ></div>
    </div>
    <small>
      ${formatGoalValue(current, unit)} of ${formatGoalValue(target, unit)} target
    </small>
    <div class="record-actions">
      <button
        class="small-button"
        type="button"
        data-action="update"
        data-id="${id}"
      >Update progress</button>
      <button
        class="small-button"
        type="button"
        data-action="edit"
        data-id="${id}"
      >Edit goal</button>
    </div>
  </article>
`;

}).join("");
}

function renderGoals() {
renderGoalList(document.querySelector("#goal-list"));
renderGoalList(document.querySelector("#all-goals-list"));

const count = document.querySelector("#goal-count");
if (count) {
count.textContent = String(goals.length);
}

updateStorageStatus();
}

function updateStorageStatus() {
document.querySelectorAll(
"[data-storage-status], #goal-storage-status"
).forEach(element => {
element.textContent = storageAvailable
? "Saved locally in this browser · Not synced across devices"
: "Browser storage unavailable · Changes may not persist";
});
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
if (window.crypto && typeof window.crypto.randomUUID === "function") {
return window.crypto.randomUUID();
}

return "goal-" + Date.now() + "-" +
Math.random().toString(36).slice(2, 10);
}

function createGoalFromValues(title, current, target, unit) {
const cleanTitle = title.trim();
const currentValue = Number(current);
const targetValue = Number(target);

if (!cleanTitle) {
showToast("Enter a goal name.");
return false;
}

if (!Number.isFinite(currentValue) || currentValue < 0) {
showToast("Enter a valid current progress.");
return false;
}

if (!Number.isFinite(targetValue) || targetValue <= 0) {
showToast("Enter a target greater than zero.");
return false;
}

const goal = {
id: createId(),
title: cleanTitle,
current: currentValue,
target: targetValue,
unit: unit.trim() || "units",
createdAt: new Date().toISOString()
};

goals.push(goal);

if (!saveGoals()) {
goals.pop();
return false;
}

renderGoals();
showToast("Goal created and saved in this browser.");
return true;
}

function createGoal() {
const title = prompt("What business goal do you want to achieve?");
if (title === null) return;

const targetInput = prompt("What is your target value?", "100");
if (targetInput === null) return;

const unit = prompt("What are you measuring?", "customers");
if (unit === null) return;

createGoalFromValues(title, 0, targetInput, unit);
}

function updateGoal(id) {
const goal = goals.find(item => item.id === id);
if (!goal) return;

const input = prompt(
  `Current progress for "${goal.title}":`,
  String(goal.current)
);

if (input === null) return;

const current = Number(input);

if (!Number.isFinite(current) || current < 0) {
showToast("Enter a valid number of zero or greater.");
return;
}

const previous = goal.current;
goal.current = current;

if (saveGoals()) {
renderGoals();
showToast("Progress updated and saved locally.");
} else {
goal.current = previous;
}
}

function editGoal(id) {
const goal = goals.find(item => item.id === id);
if (!goal) return;

const title = prompt("Goal name:", goal.title);
if (title === null || !title.trim()) return;

const targetInput = prompt("Target value:", String(goal.target));
if (targetInput === null) return;

const target = Number(targetInput);

if (!Number.isFinite(target) || target <= 0) {
showToast("Enter a target greater than zero.");
return;
}

const unit = prompt("Measurement unit:", goal.unit || "units");
if (unit === null) return;

const previous = { ...goal };

goal.title = title.trim();
goal.target = target;
goal.unit = unit.trim() || "units";

if (saveGoals()) {
renderGoals();
showToast("Goal updated and saved locally.");
} else {
Object.assign(goal, previous);
}
}

function setupGoalForm() {
const form = document.querySelector("#goal-form");
if (!form) return;

form.addEventListener("submit", event => {
event.preventDefault();

const title = document.querySelector("#goal-title")?.value || "";
const current = document.querySelector("#goal-current")?.value || "0";
const target = document.querySelector("#goal-target")?.value || "";
const unit = document.querySelector("#goal-unit")?.value || "units";
const created = createGoalFromValues(title, current, target, unit);
if (created) {
  form.reset();
  const currentField = document.querySelector("#goal-current");
  if (currentField) currentField.value = "0";
}

});
}

function setupGoalActions() {
document.addEventListener("click", event => {
const target = event.target;
if (!(target instanceof Element)) return;

const actionButton = target.closest("[data-action]");
if (actionButton) {
  const id = actionButton.dataset.id;
  const action = actionButton.dataset.action;
  if (action === "update") updateGoal(id);
  if (action === "edit") editGoal(id);
  if (action === "create-goal") createGoal();
  return;
}
const createButton = target.closest("#goal-button, #create-goal, #add-goal");
if (createButton) {
  event.preventDefault();
  createGoal();
}

});
}

function setupNavigation() {
const menuButton = document.querySelector(".menu-button");
const sidebar = document.querySelector(".sidebar");

if (menuButton && sidebar) {
menuButton.addEventListener("click", () => {
sidebar.classList.toggle("open");

  menuButton.setAttribute(
    "aria-expanded",
    String(sidebar.classList.contains("open"))
  );
});

}

document.querySelectorAll(".nav-link").forEach(link => {
link.addEventListener("click", event => {
const href = link.getAttribute("href");

  if (!href || !href.startsWith("#")) return;
  const target = document.querySelector(href);
  if (!target) return;
  event.preventDefault();
  document.querySelectorAll(".nav-link").forEach(item => {
    item.classList.remove("active");
  });
  document.querySelectorAll(".page").forEach(page => {
    page.classList.remove("active");
  });
  link.classList.add("active");
  target.classList.add("active");
  const breadcrumb = document.querySelector(".breadcrumb strong");
  if (breadcrumb) {
    breadcrumb.textContent = link.textContent.trim();
  }
  if (sidebar) sidebar.classList.remove("open");
  history.replaceState(null, "", href);
});

});
}

function initializeBusinessFlow() {
loadGoals();
setupGoalActions();
setupGoalForm();
setupNavigation();
renderGoals();
}

if (document.readyState === "loading") {
document.addEventListener("DOMContentLoaded", initializeBusinessFlow);
} else {
initializeBusinessFlow();
}
