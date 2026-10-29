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
let supabase = null;
let session = null;
const show = (message) => { if (status) status.textContent = message; };
const showApi = (message) => { if (apiStatus) apiStatus.textContent = message; };
function setSession(next) {
  session = next ?? null;
  const signedIn = Boolean(session?.user);
  if (signIn) signIn.hidden = signedIn;
  if (signUp) signUp.hidden = signedIn;
  if (signOut) signOut.hidden = !signedIn;
  if (email) email.disabled = signedIn;
  if (password) password.disabled = signedIn;
}
async function backendHealth() {
  const base = typeof config.apiBaseUrl === "string" ? config.apiBaseUrl.trim().replace(/\/+$/, "") : "";
  if (!base) { showApi("BusinessFlow API: not connected. Backend URL is not configured."); return; }
  try {
    const response = await fetch(base + "/health", { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const result = await response.json();
    if (result.service !== "businessflow-backend" || result.status !== "ok") throw new Error("Unexpected backend health response");
    showApi("BusinessFlow API: reachable. Cloud data access still requires end-to-end verification.");
  } catch (error) {
    console.error("BusinessFlow backend health check failed:", error);
    showApi("BusinessFlow API: unreachable or blocked by network/CORS settings.");
  }
}
form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase) { show("Sign-in is not configured. Check the Supabase public configuration."); return; }
  signIn.disabled = true; signUp.disabled = true; show("Signing in…");
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
    if (error) throw error;
    setSession(data.session); password.value = "";
    show("Signed in as " + (data.user?.email ?? "your account") + ". Cloud records are not connected until the backend is deployed and configured.");
  } catch (error) { show(error?.message || "Sign-in failed. Check your credentials."); }
  finally { signIn.disabled = Boolean(session?.user); signUp.disabled = Boolean(session?.user); }
});
signUp?.addEventListener("click", async () => {
  if (!supabase) { show("Account creation is not configured."); return; }
  const address = email.value.trim(), secret = password.value;
  if (!address || secret.length < 8) { show("Enter a valid email and a password with at least 8 characters."); return; }
  signIn.disabled = true; signUp.disabled = true; show("Creating account…");
  try {
    const { data, error } = await supabase.auth.signUp({ email: address, password: secret });
    if (error) throw error;
    if (data.session) { setSession(data.session); show("Account created and signed in. Cloud records still need the deployed backend."); }
    else show("Account request received. Check your email if confirmation is enabled, then sign in.");
  } catch (error) { show(error?.message || "Account creation failed."); }
  finally { signIn.disabled = Boolean(session?.user); signUp.disabled = Boolean(session?.user); }
});
signOut?.addEventListener("click", async () => {
  if (!supabase) return;
  signOut.disabled = true;
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setSession(null); password.value = ""; show("You are signed out.");
  } catch (error) { show(error?.message || "Sign-out failed."); }
  finally { signOut.disabled = false; }
});
async function initialize() {
  if (!config.supabaseUrl || !config.supabasePublishableKey) {
    show("Account sign-in is not configured. Supabase URL and publishable key are required.");
    await backendHealth(); return;
  }
  try {
    supabase = createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    setSession(data.session);
    show(data.session?.user
      ? "Signed in as " + (data.session.user.email ?? "your account") + ". Cloud records are not connected until the backend is deployed and configured."
      : "Not signed in. Sign in or create a BusinessFlow account.");
    supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (next?.user) show("Signed in as " + (next.user.email ?? "your account") + ". Cloud records are not connected until the backend is deployed and configured.");
    });
  } catch (error) {
    console.error("BusinessFlow Auth initialization failed:", error);
    show("Could not initialize Supabase Auth. Check network access and project configuration.");
  }
  await backendHealth();
}
initialize();