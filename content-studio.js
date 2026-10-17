/* BusinessFlow Content Studio.
 * Real AI generation uses a same-origin server endpoint. Never put API keys here.
 * The demo preview is explicitly labelled and does not call an AI provider.
 */
"use strict";

const EMAN_ENDPOINT = "/api/eman/content/drafts";

function studioElement(selector) {
  return document.querySelector(selector);
}

function studioToast(message) {
  const toast = studioElement(".toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(studioToast.timer);
  studioToast.timer = window.setTimeout(() => toast.classList.remove("show"), 3200);
}

function readStudioForm() {
  const form = studioElement("#content-form");
  if (!form) return null;
  const data = new FormData(form);
  const platforms = data.getAll("platforms").map(String);
  return {
    business: {
      name: String(data.get("businessName") || "").trim(),
      industry: String(data.get("industry") || "").trim(),
      audience: String(data.get("audience") || "").trim(),
      offer: String(data.get("offer") || "").trim(),
      brand_voice: String(data.get("brandVoice") || "clear, trustworthy, and helpful").trim(),
      location: String(data.get("location") || "").trim() || null
    },
    goal: String(data.get("goal") || "").trim(),
    topic: String(data.get("topic") || "").trim(),
    content_type: String(data.get("contentType") || "social_post"),
    platforms,
    language: String(data.get("language") || "English"),
    include_call_to_action: data.get("includeCta") === "on"
  };
}

function renderDrafts(drafts, mode) {
  const results = studioElement("#content-results");
  const status = studioElement("#content-result-status");
  if (!results || !status) return;
  results.replaceChildren();
  status.textContent = mode === "demo"
    ? "DEMO PREVIEW · Example copy only. EMAN AI is not connected to this browser page yet."
    : "EMAN RESPONSE · Review every claim before using this content.";
  status.className = mode === "demo" ? "studio-result-status demo" : "studio-result-status";
  drafts.forEach((draft, index) => {
    const card = document.createElement("article");
    card.className = "studio-draft-card";
    const heading = document.createElement("div");
    heading.className = "studio-draft-heading";
    const title = document.createElement("h3");
    title.textContent = String(draft.platform || "Content").replace(/_/g, " ");
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "text-button";
    copyButton.textContent = "Copy draft";
    copyButton.addEventListener("click", async () => {
      const text = [draft.text, (draft.hashtags || []).join(" "), draft.call_to_action || ""].filter(Boolean).join("\n\n");
      try {
        await navigator.clipboard.writeText(text);
        studioToast("Draft copied.");
      } catch (_) {
        studioToast("Copy is unavailable in this browser. Select the draft text to copy it.");
      }
    });
    heading.append(title, copyButton);
    const body = document.createElement("p");
    body.className = "studio-draft-text";
    body.textContent = draft.text || "";
    card.append(heading, body);
    if (Array.isArray(draft.hashtags) && draft.hashtags.length) {
      const tags = document.createElement("p");
      tags.className = "studio-hashtags";
      tags.textContent = draft.hashtags.join(" ");
      card.append(tags);
    }
    if (draft.call_to_action) {
      const cta = document.createElement("p");
      cta.className = "studio-cta";
      cta.textContent = "Suggested CTA: " + draft.call_to_action;
      card.append(cta);
    }
    results.append(card);
  });
}

function createDemoDrafts(request) {
  const business = request.business.name;
  const offer = request.business.offer;
  const audience = request.business.audience;
  const topic = request.topic;
  return request.platforms.map(platform => ({
    platform,
    text: platform === "linkedin"
      ? `${topic}\n\nAt ${business}, we work to help ${audience.toLowerCase()} with ${offer.toLowerCase()}. We are sharing this update to start a useful conversation with our community.`
      : `${topic}\n\nLooking for ${offer.toLowerCase()}? ${business} is here to help ${audience.toLowerCase()}. Get in touch to learn more.`,
    hashtags: ["#SmallBusiness", "#" + business.replace(/[^a-z0-9]/gi, "")],
    call_to_action: "Message us to learn more."
  }));
}

async function requestEmanDrafts(request) {
  const response = await fetch(EMAN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(request)
  });
  if (!response.ok) {
    if (response.status === 404 || response.status === 405) {
      throw new Error("The secure EMAN server endpoint is not deployed yet. Use Demo preview while the backend connection is built.");
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error("Your session is not authorized to use EMAN. Sign in through the secure BusinessFlow backend first.");
    }
    throw new Error("EMAN could not generate drafts (HTTP " + response.status + "). Please try again later.");
  }
  const result = await response.json();
  if (!Array.isArray(result.drafts) || result.review_required !== true) {
    throw new Error("The EMAN response did not match the expected reviewable-draft format.");
  }
  return result.drafts;
}

function setupContentStudio() {
  const form = studioElement("#content-form");
  const generate = studioElement("#generate-content");
  const preview = studioElement("#preview-content");
  if (!form || !generate || !preview) return;

  form.addEventListener("change", event => {
    if (!(event.target instanceof HTMLInputElement) || event.target.name !== "platforms") return;
    const checked = Array.from(form.querySelectorAll('input[name="platforms"]:checked'));
    if (checked.length > 4) {
      event.target.checked = false;
      studioToast("Choose no more than four platforms per request.");
    }
  });

  form.addEventListener("submit", event => event.preventDefault());

  preview.addEventListener("click", () => {
    if (!form.reportValidity()) return;
    const request = readStudioForm();
    if (!request || !request.platforms.length) {
      studioToast("Choose at least one platform.");
      return;
    }
    renderDrafts(createDemoDrafts(request), "demo");
  });

  generate.addEventListener("click", async () => {
    if (!form.reportValidity()) return;
    const request = readStudioForm();
    if (!request || !request.platforms.length) {
      studioToast("Choose at least one platform.");
      return;
    }
    generate.disabled = true;
    generate.textContent = "Connecting to EMAN…";
    try {
      const drafts = await requestEmanDrafts(request);
      renderDrafts(drafts, "eman");
    } catch (error) {
      studioToast(error instanceof Error ? error.message : "Could not connect to EMAN.");
    } finally {
      generate.disabled = false;
      generate.textContent = "Generate with EMAN";
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupContentStudio);
} else {
  setupContentStudio();
}
