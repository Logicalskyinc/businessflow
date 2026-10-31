import express from "express";
import helmet from "helmet";
import { businessIntelligenceRouter } from "./modules/business-intelligence/business-intelligence.routes.js";
import { conversationRouter } from "./modules/business-intelligence/conversation.routes.js";
import { businessFlowAiRouter } from "./modules/business-intelligence/businessflow-ai.routes.js";

const app = express();
const port = Number.parseInt(process.env.PORT ?? "3000", 10);

app.disable("x-powered-by");
app.use(helmet());

const allowedOrigins = new Set(
  (process.env.BUSINESSFLOW_ALLOWED_ORIGINS ?? "https://logicalskyinc.github.io,https://growthflow-7tyx.onrender.com,https://businessflow-gba5.onrender.com")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean)
);

app.use((request, response, next) => {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
    response.setHeader("Access-Control-Max-Age", "600");
  }

  if (request.method === "OPTIONS") {
    if (origin && !allowedOrigins.has(origin)) {
      return response.status(403).json({ error: "origin_not_allowed" });
    }
    return response.status(204).end();
  }

  return next();
});

app.use(express.json({ limit: "1mb", strict: true }));

app.get("/health", (_request, response) => {
  response.status(200).json({
    status: "ok",
    service: "businessflow-backend",
    mode: "foundation"
  });
});

app.use("/api/business-intelligence", businessIntelligenceRouter);
app.use("/api/business-intelligence/conversations", conversationRouter);
app.use("/api/v1/ai", businessFlowAiRouter);

app.use((request, response) => {
  response.status(404).json({
    error: "not_found",
    message: "The requested endpoint does not exist."
  });
});

app.use((error, _request, response, _next) => {
  if (error?.code === "23514" && String(error.message).includes("businessflow_workspace_limit_reached")) {
    return response.status(409).json({ error: "business_limit_reached", message: "Your Starter plan includes 2 businesses. Upgrade your plan to add another." });
  }

  if (error?.type === "entity.too.large") {
    return response.status(413).json({
      error: "payload_too_large",
      message: "Request body exceeds the 1 MB limit."
    });
  }

  if (error instanceof SyntaxError && "body" in error) {
    return response.status(400).json({
      error: "invalid_json",
      message: "Request body must contain valid JSON."
    });
  }

  console.error("BusinessFlow API error:", error);
  return response.status(500).json({
    error: "internal_error",
    message: "The server could not complete the request."
  });
});

if (process.env.NODE_ENV !== "test") {
  app.listen(port, "0.0.0.0", () => {
    console.log(`BusinessFlow backend listening on port ${port}`);
  });
}

export { app };
