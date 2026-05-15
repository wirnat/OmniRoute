import { CORS_HEADERS, handleCorsOptions } from "@/shared/utils/cors";
import { handleRerank } from "@omniroute/open-sse/handlers/rerank.ts";
import {
  getProviderCredentials,
  clearRecoveredProviderState,
  extractApiKey,
  isValidApiKey,
} from "@/sse/services/auth";
import { parseRerankModel } from "@omniroute/open-sse/config/rerankRegistry.ts";
import { errorResponse } from "@omniroute/open-sse/utils/error.ts";
import { HTTP_STATUS } from "@omniroute/open-sse/config/constants.ts";
import { enforceApiKeyPolicy } from "@/shared/utils/apiKeyPolicy";
import { v1RerankSchema } from "@/shared/validation/schemas";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";
import { getProviderNodes } from "@/lib/localDb";
import { saveCallLog } from "@/lib/usageDb";

function estimateTextTokens(value: unknown) {
  if (typeof value !== "string" || value.length === 0) return 0;
  return Math.ceil(value.length / 4);
}

function getRerankDocumentText(document: unknown) {
  if (typeof document === "string") return document;
  if (document && typeof document === "object" && "text" in document) {
    return typeof document.text === "string" ? document.text : "";
  }
  return "";
}

function estimateRerankInputTokens(body: unknown) {
  if (!body || typeof body !== "object") return 0;

  const queryTokens = "query" in body ? estimateTextTokens(body.query) : 0;
  const documentTokens =
    "documents" in body && Array.isArray(body.documents)
      ? body.documents.reduce(
          (total, document) => total + estimateTextTokens(getRerankDocumentText(document)),
          0
        )
      : 0;

  return queryTokens + documentTokens;
}

async function readResponseBodyForLog(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  const clone = response.clone();

  if (contentType.includes("application/json")) {
    return clone.json().catch(() => null);
  }

  const text = await clone.text().catch(() => "");
  return text.length > 0 ? text : null;
}

async function recordAndReturnRerankResponse({
  request,
  body,
  response,
  provider,
  model,
  startedAt,
}: {
  request: Request;
  body: unknown;
  response: Response;
  provider?: string | null;
  model?: string | null;
  startedAt: number;
}) {
  const responseBody = await readResponseBodyForLog(response);

  await saveCallLog({
    timestamp: new Date().toISOString(),
    method: request.method,
    path: new URL(request.url).pathname || "/api/v1/rerank",
    status: response.status,
    model: model || "-",
    requestedModel:
      body && typeof body === "object" && "model" in body ? String(body.model || "") : null,
    provider: provider || null,
    duration: Date.now() - startedAt,
    tokens: {
      prompt_tokens: estimateRerankInputTokens(body),
      completion_tokens: 0,
    },
    requestType: "rerank",
    requestBody: body || null,
    responseBody,
    error: response.ok ? null : responseBody,
  });

  return response;
}

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return handleCorsOptions();
}

/**
 * Build dynamic rerank provider from a local provider_node.
 * Local OpenAI-compatible backends (oMLX, vLLM, etc.) expose /v1/rerank
 * under the same base URL as chat.
 */
function buildDynamicRerankProvider(node: any) {
  // Strip trailing /v1 if present — we'll add /rerank
  let base = node.baseUrl || "";
  if (base.endsWith("/v1")) base = base.slice(0, -3);
  return {
    id: node.prefix,
    baseUrl: `${base}/v1/rerank`,
    authType: "apikey",
    authHeader: "bearer",
    providerId: node.id, // full provider connection ID for credential lookup
  };
}

/**
 * POST /v1/rerank - Cohere-compatible rerank endpoint
 *
 * Supports cloud providers (Cohere, Together, NVIDIA, Fireworks)
 * and local provider_nodes (oMLX, vLLM, etc.) via dynamic routing.
 */
export async function POST(request) {
  const startedAt = Date.now();

  // Optional API key validation
  if (process.env.REQUIRE_API_KEY === "true") {
    const apiKey = extractApiKey(request);
    if (!apiKey) {
      const response = errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
      return recordAndReturnRerankResponse({
        request,
        body: null,
        response,
        startedAt,
      });
    }
    const valid = await isValidApiKey(apiKey);
    if (!valid) {
      const response = errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
      return recordAndReturnRerankResponse({
        request,
        body: null,
        response,
        startedAt,
      });
    }
  }

  let rawBody;
  try {
    rawBody = await request.json();
  } catch {
    const response = errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
    return recordAndReturnRerankResponse({
      request,
      body: null,
      response,
      startedAt,
    });
  }

  const validation = validateBody(v1RerankSchema, rawBody);
  if (isValidationFailure(validation)) {
    const response = errorResponse(HTTP_STATUS.BAD_REQUEST, validation.error.message);
    return recordAndReturnRerankResponse({
      request,
      body: rawBody,
      response,
      model:
        rawBody && typeof rawBody === "object" && "model" in rawBody
          ? String(rawBody.model || "")
          : null,
      startedAt,
    });
  }
  const body = validation.data;

  // Enforce API key policies (model restrictions + budget limits)
  const policy = await enforceApiKeyPolicy(request, body.model);
  if (policy.rejection) {
    return recordAndReturnRerankResponse({
      request,
      body,
      response: policy.rejection,
      model: body.model,
      startedAt,
    });
  }

  // Load local provider_nodes for rerank routing (localhost only)
  let localProviders: ReturnType<typeof buildDynamicRerankProvider>[] = [];
  try {
    const nodes = await getProviderNodes();
    localProviders = (Array.isArray(nodes) ? nodes : [])
      .filter((n: any) => {
        try {
          const hostname = new URL(n.baseUrl).hostname;
          // Strictly matching 172.16.0.0/12 (Docker/local) and explicitly blocking ::1 per SSRF hardening
          return (
            hostname === "localhost" ||
            hostname === "127.0.0.1" ||
            /^172\.(1[6-9]|2[0-9]|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)
          );
        } catch {
          return false;
        }
      })
      .map((n) => {
        try {
          return buildDynamicRerankProvider(n);
        } catch {
          return null;
        }
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);
  } catch {
    // Non-critical — continue with cloud providers only
  }

  // Try cloud registry first
  const { provider, model: modelId } = parseRerankModel(body.model);

  if (provider) {
    // Cloud provider matched
    const credentials = await getProviderCredentials(provider);
    if (!credentials) {
      const response = errorResponse(
        HTTP_STATUS.BAD_REQUEST,
        `No credentials for provider: ${provider}`
      );
      return recordAndReturnRerankResponse({
        request,
        body,
        response,
        provider,
        model: modelId,
        startedAt,
      });
    }

    const response = await handleRerank({
      model: body.model,
      query: body.query,
      documents: body.documents,
      top_n: body.top_n,
      return_documents: body.return_documents,
      credentials,
    });
    if (response?.ok) {
      await clearRecoveredProviderState(credentials);
    }
    return recordAndReturnRerankResponse({
      request,
      body,
      response,
      provider,
      model: modelId,
      startedAt,
    });
  }

  // Try local provider_nodes (model format: prefix/model-name)
  const parts = body.model.split("/");
  if (parts.length >= 2) {
    const prefix = parts[0];
    const localModel = parts.slice(1).join("/");
    const localProvider = localProviders.find((p) => p.id === prefix);

    if (localProvider) {
      const credentials = await getProviderCredentials(localProvider.providerId);
      if (!credentials) {
        const response = errorResponse(
          HTTP_STATUS.BAD_REQUEST,
          `No credentials for local provider: ${prefix}`
        );
        return recordAndReturnRerankResponse({
          request,
          body,
          response,
          provider: prefix,
          model: localModel,
          startedAt,
        });
      }

      const token = credentials?.apiKey || credentials?.accessToken;
      try {
        const res = await fetch(localProvider.baseUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            model: localModel,
            query: body.query,
            documents: body.documents,
            top_n: body.top_n || body.documents.length,
            return_documents: body.return_documents !== false,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          const response = errorResponse(
            res.status,
            errData.message || errData.detail || `Provider returned HTTP ${res.status}`
          );
          return recordAndReturnRerankResponse({
            request,
            body,
            response,
            provider: prefix,
            model: localModel,
            startedAt,
          });
        }

        const data = await res.json();
        const response = Response.json(data, {
          headers: CORS_HEADERS,
        });
        return recordAndReturnRerankResponse({
          request,
          body,
          response,
          provider: prefix,
          model: localModel,
          startedAt,
        });
      } catch (err: any) {
        const response = errorResponse(500, `Rerank request failed: ${err.message}`);
        return recordAndReturnRerankResponse({
          request,
          body,
          response,
          provider: prefix,
          model: localModel,
          startedAt,
        });
      }
    }
  }

  const response = errorResponse(
    HTTP_STATUS.BAD_REQUEST,
    `Invalid rerank model: ${body.model}. Use format: provider/model`
  );
  return recordAndReturnRerankResponse({
    request,
    body,
    response,
    model: body.model,
    startedAt,
  });
}
