import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const config = window.BUSINESSFLOW_CONFIG ?? {};
const status = document.querySelector("#account-status");
const apiStatus = document.querySelector("#api-status");
const form = document.querySelector("#account-form");
const email = document.querySelector("#account-email");
const password = document.querySelector("#account-password");
const signIn = document.querySelector("#account-submit");
const signUp = document.querySelector("#account-signup");
const signOut = document.querySelector("#account-signout");
const workspaceSelect = document.querySelector("#business-workspace-select");
const workspaceForm = document.querySelector("#business-workspace-form");
const workspaceName = document.querySelector("#business-workspace-name");
const workspaceBasics = document.querySelector("#business-workspace-basics");
const workspaceGoal = document.querySelector("#business-workspace-goal");
const workspaceCreate = document.querySelector("#business-workspace-create");
const importLocalGoals = document.querySelector("#businessflow-import-local-goals");
const workspaceStatus = document.querySelector("#business-workspace-status");

let supabase = null;
let session = null;
let businesses = [];
let activeBusinessId = null;
let apiConnected = false;

const show = message => { if (status) status.textContent = message; };
const showApi = message => { if (apiStatus) apiStatus.textContent = message; };
const showWorkspace = message => { if (workspaceStatus) workspaceStatus.textContent = message; };

function emitCloudState() {
  window.dispatchEvent(new CustomEvent("businessflow:cloud-state", {
    detail: {
      signedIn: Boolean(session?.user),
      apiConnected,
      businessId: activeBusinessId,
      userEmail: session?.user?.email ?? null
    }
  }));
}

function setSession(next) {
  session = next ?? null;
  const signedIn = Boolean(session?.user);
  if (signIn) signIn.hidden = signedIn;
  if (signUp) signUp.hidden = signedIn;
  if (signOut) signOut.hidden = !signedIn;
  if (email) email.disabled = signedIn;
  if (password) password.disabled = signedIn;
  if (workspaceSelect) workspaceSelect.disabled = !(signedIn && apiConnected);
  if (workspaceCreate) workspaceCreate.disabled = !(signedIn && apiConnected);
  if (importLocalGoals) importLocalGoals.disabled = !(signedIn && apiConnected && activeBusinessId);
  emitCloudState();
}

function apiBase() {
  return typeof config.apiBaseUrl === "string" ? config.apiBaseUrl.trim().replace(/\/+$/, "") : "";
}

async function apiRequest(path, options = {}) {
  if (!session?.access_token) throw new Error("Sign in to use BusinessFlow cloud storage.");
  const base = apiBase();
  if (!base) throw new Error("The BusinessFlow backend URL is not configured yet.");
  const headers = new Headers(options.headers ?? {});
  headers.set("Authorization", "Bearer " + session.access_token);
  headers.set("Accept", "application/json");
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  const response = await fetch(base + path, {
    ...options, headers, cache: "no-store"
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Your session expired. Sign out and sign in again.");
    }
    const detail = Array.isArray(result.errors) ? result.errors.join(" ") : result.message || result.error;
    throw new Error(detail || "BusinessFlow API request failed (HTTP " + response.status + ").");
  }
  return result;
}

async function checkBackend() {
  const base = apiBase();
  apiConnected = false;
  if (!base) {
    showApi("BusinessFlow API: not connected. Backend URL is not configured.");
    setSession(session);
    return;
  }
  try {
    const response = await fetch(base + "/health", { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const result = await response.json();
    if (result.service !== "businessflow-backend" || result.status !== "ok") throw new Error("Unexpected backend health response");
    apiConnected = true;
    showApi("BusinessFlow API: reachable.");
    setSession(session);
  } catch (error) {
    console.error("BusinessFlow backend health check failed:", error);
    showApi("BusinessFlow API: unreachable or blocked by network/CORS settings.");
    setSession(session);
  }
}

function renderBusinesses() {
  if (!workspaceSelect) return;
  const previous = activeBusinessId;
  workspaceSelect.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = businesses.length ? "Select a business workspace" : "Create your first business workspace";
  workspaceSelect.append(placeholder);
  for (const business of businesses) {
    const option = document.createElement("option");
    option.value = business.id;
    option.textContent = business.name;
    workspaceSelect.append(option);
  }
  activeBusinessId = businesses.some(item => item.id === previous)
    ? previous
    : businesses[0]?.id ?? null;
  workspaceSelect.value = activeBusinessId ?? "";
  if (importLocalGoals) importLocalGoals.disabled = !(session?.user && apiConnected && activeBusinessId);
  emitCloudState();
}

async function loadBusinesses(preferredId = null) {
  if (!session?.user || !apiConnected) {
    businesses = [];
    activeBusinessId = null;
    renderBusinesses();
    return;
  }
  try {
    const result = await apiRequest("/api/business-intelligence/businesses");
    businesses = Array.isArray(result.businesses) ? result.businesses : [];
    if (preferredId) activeBusinessId = preferredId;
    renderBusinesses();
    window.dispatchEvent(new CustomEvent("businessflow:workspace-changed", {
      detail: { businessId: activeBusinessId }
    }));
    showWorkspace(businesses.length
      ? "Choose a workspace to load its cloud goals."
      : "No cloud workspace yet. Create one to begin storing business data.");
  } catch (error) {
    showWorkspace(error.message);
    throw error;
  }
}

async function createBusiness(event) {
  event.preventDefault();
  if (!session?.user || !apiConnected) {
    showWorkspace("Sign in and connect the BusinessFlow backend before creating a cloud workspace.");
    return;
  }
  const name = workspaceName?.value.trim() ?? "";
  const basics = workspaceBasics?.value.trim() ?? "";
  const goal = workspaceGoal?.value.trim() ?? "";
  if (!name || !basics || !goal) {
    showWorkspace("Complete the business name, business description, and main goal.");
    return;
  }
  if (businessCreateBusy) return;
  businessCreateBusy = true;
  if (workspaceCreate) workspaceCreate.disabled = true;
  showWorkspace("Creating business workspace…");
  try {
    const result = await apiRequest("/api/business-intelligence/onboarding", {
      method: "POST",
      body: JSON.stringify({ name, answers: { business_basics: basics, primary_goal: goal } })
    });
    if (!result.business?.id) throw new Error("Workspace was created but the response did not contain its ID.");
    workspaceForm.reset();
    await loadBusinesses(result.business.id);
    window.dispatchEvent(new CustomEvent("businessflow:workspace-changed", {
      detail: { businessId: result.business.id }
    }));
    showWorkspace("Cloud workspace created. Goals can now be saved to this business.");
  } catch (error) {
    showWorkspace(error.message);
  } finally {
    businessCreateBusy = false;
    if (workspaceCreate) workspaceCreate.disabled = !(session?.user && apiConnected);
  }
}
let businessCreateBusy = false;

workspaceForm?.addEventListener("submit", createBusiness);
workspaceSelect?.addEventListener("change", () => {
  activeBusinessId = businesses.some(item => item.id === workspaceSelect.value) ? workspaceSelect.value : null;
  emitCloudState();
  window.dispatchEvent(new CustomEvent("businessflow:workspace-changed", {
    detail: { businessId: activeBusinessId }
  }));
  showWorkspace(activeBusinessId ? "Loading goals for the selected cloud workspace…" : "Select or create a workspace.");
});

importLocalGoals?.addEventListener("click", () => {
  if (!activeBusinessId || !apiConnected || !session?.user) return;
  window.dispatchEvent(new CustomEvent("businessflow:import-local-goals-requested", {
    detail: { businessId: activeBusinessId }
  }));
});

form?.addEventListener("submit", async event => {
  event.preventDefault();
  if (!supabase) { show("Sign-in is not configured. Check the Supabase public configuration."); return; }
  signIn.disabled = true;
  if (signUp) signUp.disabled = true;
  show("Signing in…");
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
    if (error) throw error;
    setSession(data.session);
    password.value = "";
    show("Signed in as " + (data.user?.email ?? "your account") + ".");
    await checkBackend();
    if (apiConnected) await loadBusinesses();
  } catch (error) {
    show(error?.message || "Sign-in failed. Check your credentials.");
  } finally {
    signIn.disabled = Boolean(session?.user);
    if (signUp) signUp.disabled = Boolean(session?.user);
  }
});

signUp?.addEventListener("click", async () => {
  if (!supabase) { show("Account creation is not configured."); return; }
  const address = email.value.trim(), secret = password.value;
  if (!address || secret.length < 8) { show("Enter a valid email and a password with at least 8 characters."); return; }
  signIn.disabled = true; signUp.disabled = true; show("Creating account…");
  try {
    const { data, error } = await supabase.auth.signUp({
      email: address,
      password: secret,
      options: { emailRedirectTo: window.location.origin }
    });
    if (error) throw error;
    if (data.session) {
      setSession(data.session);
      show("Account created and signed in.");
      await checkBackend();
      if (apiConnected) await loadBusinesses();
    } else {
      show("Account request received. Check your email if confirmation is enabled, then sign in.");
    }
  } catch (error) { show(error?.message || "Account creation failed."); }
  finally {
    signIn.disabled = Boolean(session?.user);
    signUp.disabled = Boolean(session?.user);
  }
});

signOut?.addEventListener("click", async () => {
  if (!supabase) return;
  signOut.disabled = true;
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setSession(null);
    businesses = [];
    activeBusinessId = null;
    renderBusinesses();
    password.value = "";
    show("You are signed out.");
    showWorkspace("Cloud workspace not connected.");
    window.dispatchEvent(new CustomEvent("businessflow:workspace-changed", { detail: { businessId: null } }));
  } catch (error) { show(error?.message || "Sign-out failed."); }
  finally { signOut.disabled = false; }
});

window.BusinessFlowCloud = Object.freeze({
  getState: () => ({
    signedIn: Boolean(session?.user),
    apiConnected,
    businessId: activeBusinessId,
    userId: session?.user?.id ?? null
  }),
  request: apiRequest,
  listBusinesses: () => [...businesses],
  loadBusinesses,
  getBusinessId: () => activeBusinessId,
  loadGoals: async businessId => {
    const result = await apiRequest("/api/business-intelligence/goals?business_id=" + encodeURIComponent(businessId));
    return Array.isArray(result.goals) ? result.goals : [];
  },
  createGoal: async (businessId, goal) => {
    const result = await apiRequest("/api/business-intelligence/goals", {
      method: "POST",
      body: JSON.stringify({
        business_id: businessId,
        title: goal.title,
        metric_name: goal.unit || "units",
        current_value: Number(goal.current),
        target_value: Number(goal.target),
        status: "active"
      })
    });
    if (!result.goal?.id) throw new Error("Goal was saved but the response did not contain its ID.");
    return result.goal;
  },
  updateGoal: async (businessId, goal) => {
    const result = await apiRequest("/api/business-intelligence/goals/" + encodeURIComponent(goal.id), {
      method: "PATCH",
      body: JSON.stringify({
        business_id: businessId,
        title: goal.title,
        metric_name: goal.unit || "units",
        current_value: Number(goal.current),
        target_value: Number(goal.target),
        status: goal.status || "active"
      })
    });
    return result.goal;
  },
  deleteGoal: async (businessId, goalId) => apiRequest(
    "/api/business-intelligence/goals/" + encodeURIComponent(goalId) + "?business_id=" + encodeURIComponent(businessId),
    { method: "DELETE" }
  )
});

async function initialize() {
  if (!config.supabaseUrl || !config.supabasePublishableKey) {
    show("Account sign-in is not configured. Supabase URL and publishable key are required.");
    await checkBackend();
    return;
  }
  try {
    supabase = createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    setSession(data.session);
    show(data.session?.user
      ? "Signed in as " + (data.session.user.email ?? "your account") + "."
      : "Not signed in. Sign in or create a BusinessFlow account.");
    supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (next?.user) {
        show("Signed in as " + (next.user.email ?? "your account") + ".");
        queueMicrotask(async () => {
          await checkBackend();
          if (apiConnected) {
            try { await loadBusinesses(); } catch (error) { console.error(error); }
          }
        });
      }
    });
  } catch (error) {
    console.error("BusinessFlow Auth initialization failed:", error);
    show("Could not initialize Supabase Auth. Check network access and project configuration.");
  }
  await checkBackend();
  if (session?.user && apiConnected) {
    try { await loadBusinesses(); } catch (error) { console.error(error); }
  }
}
initialize();
