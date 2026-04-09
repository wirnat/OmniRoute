import test from "node:test";
import assert from "node:assert/strict";

const { buildKiroPayload } = await import("../../open-sse/translator/request/openai-to-kiro.ts");
const { KiroExecutor } = await import("../../open-sse/executors/kiro.ts");

test("kiro payload tidak menyuntik context timestamp ke prompt user", () => {
  const payload = buildKiroPayload(
    "claude-sonnet-4.5",
    {
      messages: [
        { role: "system", content: "Anda adalah summary agent outlet barber." },
        { role: "user", content: "Ringkas percakapan ini." },
      ],
    },
    true,
    {}
  );

  const content = payload?.conversationState?.currentMessage?.userInputMessage?.content || "";
  assert.equal(content.includes("[Context: Current time is"), false);
  assert.equal(content.includes("[System Instructions]"), false);
  assert.equal(content.includes("Ringkas percakapan ini."), true);
});

test("kiro payload menggunakan conversationId acak tiap request", () => {
  const body = {
    messages: [{ role: "user", content: "Halo" }],
  };

  const p1 = buildKiroPayload("claude-sonnet-4.5", body, true, {});
  const p2 = buildKiroPayload("claude-sonnet-4.5", body, true, {});

  const id1 = p1?.conversationState?.conversationId;
  const id2 = p2?.conversationState?.conversationId;

  assert.equal(typeof id1, "string");
  assert.equal(typeof id2, "string");
  assert.notEqual(id1, id2);
});

test("kiro executor menonaktifkan upstream prompt caching header", () => {
  const executor = new KiroExecutor();
  const headers = executor.buildHeaders({ accessToken: "token-123" }, true);

  assert.equal(headers["x-amzn-bedrock-cache-control"], "disable");
  assert.equal("anthropic-beta" in headers, false);
});

test("kiro payload grounding_repair tidak menduplikasi userInputMessage di history", () => {
  const payload = buildKiroPayload(
    "claude-haiku-4.5",
    {
      messages: [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "bootstrap-fc-1-get-outlet-info",
              type: "function",
              function: { name: "get-outlet-info", arguments: "{}" },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "bootstrap-fc-1-get-outlet-info",
          content: '{"ok":true}',
        },
        { role: "user", content: "besok jam 12 siapa aja ada" },
        {
          role: "assistant",
          content:
            "Halo, sebelum saya cek ketersediaan barber besok jam 12, saya perlu tahu layanan yang diinginkan.",
        },
      ],
    },
    true,
    {}
  );

  const history = payload?.conversationState?.history || [];
  const current = payload?.conversationState?.currentMessage?.userInputMessage?.content || "";

  const userHistoryCount = history.filter((item) => item?.userInputMessage).length;

  assert.equal(userHistoryCount, 0);
  assert.equal(current.includes("besok jam 12 siapa aja ada"), true);
});
