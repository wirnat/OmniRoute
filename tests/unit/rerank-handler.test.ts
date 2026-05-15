import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  getAllRerankModels,
  getRerankProvider,
  parseRerankModel,
} from "../../open-sse/config/rerankRegistry.ts";
import { handleRerank } from "../../open-sse/handlers/rerank.ts";

describe("rerankRegistry — nvidia", () => {
  it("keeps the required upstream nvidia model namespace", () => {
    const result = parseRerankModel("nvidia/rerank-qa-mistral-4b");

    assert.equal(result.provider, "nvidia");
    assert.equal(result.model, "nvidia/rerank-qa-mistral-4b");
  });

  it("publishes nvidia rerank models without duplicating the provider prefix", () => {
    const nvidiaModels = getAllRerankModels().filter((model) => model.provider === "nvidia");

    assert.ok(nvidiaModels.some((model) => model.id === "nvidia/rerank-qa-mistral-4b"));
    assert.ok(nvidiaModels.every((model) => !model.id.startsWith("nvidia/nvidia/")));
  });

  it("uses NVIDIA's retrieval reranking endpoint", () => {
    const provider = getRerankProvider("nvidia");

    assert.equal(provider?.baseUrl, "https://ai.api.nvidia.com/v1/retrieval/nvidia/reranking");
  });
});

describe("handleRerank — nvidia", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends NVIDIA rerank requests in the expected upstream format", async () => {
    let capturedUrl: string | URL | Request | null = null;
    let capturedBody: unknown = null;

    globalThis.fetch = async (url, init) => {
      capturedUrl = url;
      capturedBody = JSON.parse(String(init?.body));

      return Response.json({
        rankings: [
          { index: 1, logit: 7.5 },
          { index: 0, logit: 2.25 },
        ],
      });
    };

    const response = await handleRerank({
      model: "nvidia/rerank-qa-mistral-4b",
      query: "Apa itu OmniRoute?",
      documents: ["Dokumen umum", "OmniRoute adalah unified AI proxy/router."],
      top_n: 2,
      return_documents: true,
      credentials: { apiKey: "test-key" },
    });

    const result = await response.json();

    assert.equal(capturedUrl, "https://ai.api.nvidia.com/v1/retrieval/nvidia/reranking");
    assert.deepEqual(capturedBody, {
      model: "nvidia/rerank-qa-mistral-4b",
      query: { text: "Apa itu OmniRoute?" },
      passages: [{ text: "Dokumen umum" }, { text: "OmniRoute adalah unified AI proxy/router." }],
      top_n: 2,
    });
    assert.deepEqual(result.results, [
      { index: 1, relevance_score: 7.5, document: { text: "" } },
      { index: 0, relevance_score: 2.25, document: { text: "" } },
    ]);
  });
});
