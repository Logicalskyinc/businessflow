const MAX_TASK_LENGTH = 4000;
const MAX_CONTEXT_BYTES = 24000;
const MAX_RESPONSE_BYTES = 256000;
const TIMEOUT_MS = 15000;

export class OyoSkyClientError extends Error {
  constructor(message, code = "oyosky_unavailable") {
    super(message);
    this.name = "OyoSkyClientError";
    this.code = code;
  }
}

function readConfiguration() {
  const rawUrl = process.env.OYOSKY_SERVICE_URL?.trim() ?? "";
  const token = process.env.OYOSKY_BUSINESSFLOW_SERVICE_TOKEN?.trim() ?? "";
  if (!rawUrl || !token) {
    throw new OyoSkyClientError(
      "OYOSKY is not connected. The server-side service URL or credential is not configured.",
      "oyosky_not_configured"
    );
  }

  let base;
  try { base = new URL(rawUrl); }
  catch { throw new OyoSkyClientError("OYOSKY_SERVICE_URL must be a valid HTTPS origin.", "oyosky_invalid_config"); }

  if (base.protocol !== "https:" || !base.hostname || base.username || base.password ||
      base.search || base.hash || (base.pathname !== "/" && base.pathname !== "")) {
    throw new OyoSkyClientError("OYOSKY_SERVICE_URL must be a clean HTTPS origin.", "oyosky_invalid_config");
  }
  return { url: new URL("/integrations/businessflow/reason", base).toString(), token };
}

async function readBoundedBody(response) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new OyoSkyClientError("OYOSKY returned a response larger than BusinessFlow accepts.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

function formatAssessment(result) {
  const plan = result.plan && typeof result.plan === "object" ? result.plan : {};
  const analysis = result.analysis && typeof result.analysis === "object" ? result.analysis : {};
  const steps = Array.isArray(plan.plan) ? plan.plan : [];
  const uncertainties = Array.isArray(analysis.uncertainties) ? analysis.uncertainties : [];
  const lines = [
    "OYOSKY / ATLAS ASSESSMENT",
    "Status: " + String(result.status || "unknown"),
    "",
    "Proposed plan:"
  ];

  if (!steps.length) lines.push("- OYOSKY did not return any plan steps.");
  for (const step of steps.slice(0, 8)) {
    if (!step || typeof step !== "object") continue;
    const description = typeof step.description === "string" ? step.description.trim() : "";
    if (description) lines.push(String(step.step ?? "?") + ". " + description.slice(0, 500));
  }

  if (uncertainties.length) {
    lines.push("", "Evidence gaps and uncertainties:");
    for (const item of uncertainties.slice(0, 8)) {
      lines.push("- " + String(item).slice(0, 400));
    }
  }

  lines.push(
    "",
    "Orchestration: " + String(result.orchestrator || "ORBIT"),
    "Safety: no action was executed and no OYOSKY memory was written.",
    "This is OYOSKY's current deterministic reasoning assessment, not a response from trained OYOSKY model weights."
  );
  return lines.join("\n").slice(0, 7900);
}

export async function askOyoSky(task, context) {
  if (typeof task !== "string" || !task.trim() || task.length > MAX_TASK_LENGTH) {
    throw new OyoSkyClientError("The OYOSKY task must contain 1 to 4,000 characters.", "invalid_oyosky_request");
  }
  if (context !== undefined && (context === null || typeof context !== "object" || Array.isArray(context))) {
    throw new OyoSkyClientError("The OYOSKY workspace context must be an object.", "invalid_oyosky_context");
  }
  const serializedContext = JSON.stringify(context ?? {});
  if (Buffer.byteLength(serializedContext, "utf8") > MAX_CONTEXT_BYTES) {
    throw new OyoSkyClientError("The selected workspace context is too large for OYOSKY.", "oyosky_context_too_large");
  }

  const { url, token } = readConfiguration();
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ task: task.trim(), context: context ?? {} }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch {
    throw new OyoSkyClientError("BusinessFlow could not reach OYOSKY. Your message is saved; retry or choose BusinessFlow Intelligence.");
  }

  if (!response.ok) {
    const code = response.status === 401 || response.status === 403
      ? "oyosky_auth_rejected"
      : "oyosky_request_failed";
    throw new OyoSkyClientError(
      response.status === 503
        ? "OYOSKY is not ready to accept BusinessFlow requests."
        : "OYOSKY could not complete this request (HTTP " + response.status + ").",
      code
    );
  }

  const raw = await readBoundedBody(response);
  let result;
  try { result = JSON.parse(raw.toString("utf8")); }
  catch { throw new OyoSkyClientError("OYOSKY returned an invalid response."); }

  if (!result || result.success !== true) {
    throw new OyoSkyClientError("OYOSKY could not produce a reasoning assessment.");
  }
  if (!result.side_effects ||
      result.side_effects.execution_performed !== false ||
      result.side_effects.memory_written !== false) {
    throw new OyoSkyClientError("OYOSKY response failed BusinessFlow's read-only safety checks.");
  }
  return formatAssessment(result);
}
