/* BusinessFlow — Frontend interactions
Business Goals + Local Persistence
Browser prototype only. No backend or database connection.
*/

“use strict”;

const STORAGE_KEY = “businessflow_goals_v1”;

const DEFAULT_GOALS = [
{
id: “customers-100”,
title: “I want 100 customers”,
current: 0,
target: 100,
unit: “customers”,
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
goals = DEFAULT_GOALS.map(goal => ({ …goal }));
console.error(“BusinessFlow could not load saved goals:”, error);
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
console.error(“BusinessFlow could not save goals:”, error);
showToast(“Could not save changes. Browser storage may be unavailable.”);
return false;
}
}

function escapeHTML(value) {
return String(value).replace(/[&<>”’]/g, character => ({
“&”: “&”,
“<”: “<”,
“>”: “>”,
‘”’: “"”,
“’”: “'”
})[character]);
}

function getProgress(goal) {
const current = Math.max(0, Number(goal.current) || 0);
const target = Math.max(1, Number(goal.target) || 1);

return Math.min(100, Math.round((current / target) * 100));
}

function formatNumber(value) {
return new Intl.NumberFormat().format(Number(value) || 0);
}

function findGoalContainer() {
const selectors = [
“#goals-list”,
“#goal-list”,
“.goal-list”,
“[data-goals-list]”
];

for (const selector of selectors) {
const element = document.querySelector(selector);
if (element) return element;
}

return null;
}

function renderGoals() {
const container = findGoalContainer();

if (!container) {
console.warn(
“BusinessFlow: Could not find the goals list container. “ +
“Check the goal-list element in index.html.”
);
updateStorageStatus();
return;
}

if (goals.length === 0) {
container.innerHTML =
‘No goals yet. Create your first business goal.’;
updateStorageStatus();
return;
}

container.innerHTML = goals.map(goal => {
const progress = getProgress(goal);
const current = Math.max(0, Number(goal.current) || 0);
const target = Number(goal.target) || 1;
const unit = escapeHTML(goal.unit || “units”);
const title = escapeHTML(goal.title);

return `
  <article class="goal-item" data-goal-id="${escapeHTML(goal.id)}">
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
      ${formatNumber(current)} of ${formatNumber(target)} ${unit}
    </small>
    <div class="record-actions">
      <button
        class="small-button"
        type="button"
        data-action="update"
        data-id="${escapeHTML(goal.id)}"
      >Update progress</button>
      <button
        class="small-button"
        type="button"
        data-action="edit"
        data-id="${escapeHTML(goal.id)}"
      >Edit goal</button>
    </div>
  </article>
`;

}).join(””);

updateStorageStatus();
}

function updateStorageStatus() {
const statusElements = document.querySelectorAll(
“[data-storage-status], #goal-storage-status”
);

statusElements.forEach(element => {
element.textContent = storageAvailable
? “Saved locally in this browser · Progress tracking is local”
: “Browser storage unavailable · Changes may not persist”;
});
}

function showToast(message) {
let toast = document.querySelector(”.toast”);

if (!toast) {
toast = document.createElement(“div”);
toast.className = “toast”;
toast.setAttribute(“role”, “status”);
toast.setAttribute(“aria-live”, “polite”);
document.body.appendChild(toast);
}

toast.textContent = message;
toast.classList.add(“show”);

clearTimeout(showToast.timer);
showToast.timer = setTimeout(() => {
toast.classList.remove(“show”);
}, 3000);
}

function createGoal() {
const title = prompt(“What business goal do you want to achieve?”);
if (title === null || !title.trim()) return;

const targetInput = prompt(“What is your target number?”, “100”);
if (targetInput === null) return;

const target = Number(targetInput);

if (!Number.isFinite(target) || target <= 0) {
showToast(“Enter a target greater than zero.”);
return;
}

const unit = prompt(“What are you measuring? (customers, sales, etc.)”, “customers”);
if (unit === null) return;

const goal = {
id: createId(),
title: title.trim(),
current: 0,
target,
unit: unit.trim() || “units”,
createdAt: new Date().toISOString()
};

goals.push(goal);

if (saveGoals()) {
renderGoals();
showToast(“Goal created and saved in this browser.”);
}
}

function createId() {
if (window.crypto && typeof window.crypto.randomUUID === “function”) {
return window.crypto.randomUUID();
}

return “goal-” + Date.now() + “-” + Math.random().toString(36).slice(2, 10);
}

function updateGoal(id) {
const goal = goals.find(item => item.id === id);
if (!goal) return;

const input = prompt(
Current progress for "${goal.title}" (${goal.unit}):,
String(goal.current)
);

if (input === null) return;

const current = Number(input);

if (!Number.isFinite(current) || current < 0) {
showToast(“Enter a valid number of zero or greater.”);
return;
}

goal.current = current;

if (saveGoals()) {
renderGoals();
showToast(“Progress updated and saved locally.”);
}
}

function editGoal(id) {
const goal = goals.find(item => item.id === id);
if (!goal) return;

const title = prompt(“Goal name:”, goal.title);
if (title === null || !title.trim()) return;

const targetInput = prompt(“Target value:”, String(goal.target));
if (targetInput === null) return;

const target = Number(targetInput);

if (!Number.isFinite(target) || target <= 0) {
showToast(“Enter a target greater than zero.”);
return;
}

const unit = prompt(“Measurement unit:”, goal.unit || “units”);
if (unit === null) return;

goal.title = title.trim();
goal.target = target;
goal.unit = unit.trim() || “units”;

if (saveGoals()) {
renderGoals();
showToast(“Goal updated and saved locally.”);
}
}

function setupGoalActions() {
document.addEventListener(“click”, event => {
const actionButton = event.target.closest(”[data-action]”);
if (actionButton) {
const id = actionButton.dataset.id;
const action = actionButton.dataset.action;

  if (action === "update") updateGoal(id);
  if (action === "edit") editGoal(id);
  return;
}
const createButton = event.target.closest(
  "#create-goal, #add-goal, [data-action='create-goal']"
);
if (createButton) {
  event.preventDefault();
  createGoal();
}

});
}

function setupNavigation() {
const menuButton = document.querySelector(”.menu-button”);
const sidebar = document.querySelector(”.sidebar”);

if (menuButton && sidebar) {
menuButton.addEventListener(“click”, () => {
sidebar.classList.toggle(“open”);
menuButton.setAttribute(
“aria-expanded”,
String(sidebar.classList.contains(“open”))
);
});
}

document.querySelectorAll(”.nav-link”).forEach(link => {
link.addEventListener(“click”, event => {
const href = link.getAttribute(“href”);
if (!href || !href.startsWith(”#”)) return;

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
  if (breadcrumb) breadcrumb.textContent = link.textContent.trim();
  if (sidebar) sidebar.classList.remove("open");
  history.replaceState(null, "", href);
});

});
}

function initializeBusinessFlow() {
loadGoals();
setupGoalActions();
setupNavigation();
renderGoals();
}

if (document.readyState === “loading”) {
document.addEventListener(“DOMContentLoaded”, initializeBusinessFlow);
} else {
initializeBusinessFlow();
}
