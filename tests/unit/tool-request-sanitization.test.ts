import test from "node:test";
import assert from "node:assert/strict";

const {
  coerceSchemaNumericFields,
  sanitizeToolDescription,
  coerceToolSchemas,
  sanitizeToolDescriptions,
  injectEmptyReasoningContentForToolCalls,
} = await import("../../open-sse/translator/helpers/schemaCoercion.ts");
const { translateRequest } = await import("../../open-sse/translator/index.ts");
const { FORMATS } = await import("../../open-sse/translator/formats.ts");

test("tool sanitization: coerces numeric JSON Schema fields recursively", () => {
  const schema = {
    type: "object",
    properties: {
      count: { type: "integer", minimum: "1", maximum: "10" },
      items: {
        type: "array",
        minItems: "2",
        items: { type: "string", minLength: "3" },
      },
    },
  };

  const result = coerceSchemaNumericFields(schema);
  assert.equal((result as any).properties.count.minimum, 1);
  (assert as any).equal((result as any).properties.count.maximum, 10);
  (assert as any).equal((result as any).properties.items.minItems, 2);
  assert.equal((result as any).properties.items.items.minLength, 3);
});

test("tool sanitization: preserves non-numeric JSON Schema strings", () => {
  const schema = {
    type: "object",
    properties: {
      value: { type: "string", minimum: "abc" },
    },
  };

  const result = coerceSchemaNumericFields(schema);
  assert.equal((result as any).properties.value.minimum, "abc");
});

test("tool sanitization: normalizes descriptions across OpenAI, Claude, and Gemini shapes", () => {
  const openAITool = sanitizeToolDescription({
    type: "function",
    function: { name: "sum", description: null, parameters: {} },
  });
  const claudeTool = sanitizeToolDescription({
    name: "sum",
    description: 42,
    input_schema: { type: "object" },
  });
  const geminiTool = sanitizeToolDescription({
    functionDeclarations: [{ name: "sum", description: false, parameters: {} }],
  });

  (assert as any).equal(((openAITool as any).function as any).description, "");
  assert.equal((claudeTool as any).description, "42");
  assert.equal((geminiTool as any).functionDeclarations[0].description, "false");
});

test("tool sanitization: coerces schemas and descriptions in tool arrays", () => {
  const tools = sanitizeToolDescriptions(
    coerceToolSchemas([
      {
        type: "function",
        function: {
          name: "sum",
          description: 5,
          parameters: {
            type: "object",
            properties: {
              count: { type: "integer", minimum: "1" },
            },
          },
        },
      },
    ])
  );

  assert.equal(tools[0].function.description, "5");
  assert.equal(tools[0].function.parameters.properties.count.minimum, 1);
});

test("translateRequest sanitizes tools before Claude output", () => {
  const translated = translateRequest(
    FORMATS.OPENAI,
    FORMATS.CLAUDE,
    "claude-sonnet-4-6",
    {
      messages: [{ role: "user", content: "hello" }],
      tools: [
        {
          type: "function",
          function: {
            name: "sum",
            description: null,
            parameters: {
              type: "object",
              properties: {
                count: { type: "integer", minimum: "1", maximum: "9" },
              },
            },
          },
        },
      ],
    },
    false,
    null,
    "claude"
  );

  assert.equal(translated.tools[0].description, "");
  assert.equal(translated.tools[0].input_schema.properties.count.minimum, 1);
  assert.equal(translated.tools[0].input_schema.properties.count.maximum, 9);
});

test("translateRequest maps OpenAI json_schema response_format to Claude output_config.format", () => {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      direct_reply: { type: "boolean" },
    },
    required: ["direct_reply"],
  };

  const translated = translateRequest(
    FORMATS.OPENAI,
    FORMATS.CLAUDE,
    "claude-haiku-4-5",
    {
      messages: [{ role: "user", content: "hello" }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "planner_reply",
          schema,
          strict: true,
        },
      },
    },
    false,
    null,
    "claude"
  );

  assert.deepEqual(translated.output_config.format, {
    type: "json_schema",
    schema,
  });
  assert.equal(
    translated.system.some((block) =>
      String(block.text || "").includes("strictly follows this JSON schema")
    ),
    false
  );
});

test("translateRequest maps Responses structured output and strict tools to Claude native payload", () => {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      direct_reply: { type: "boolean" },
    },
    required: ["direct_reply"],
  };

  const translated = translateRequest(
    FORMATS.OPENAI_RESPONSES,
    FORMATS.CLAUDE,
    "claude-haiku-4-5",
    {
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "hello" }],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "planner_reply",
          schema,
          strict: true,
        },
      },
      tools: [
        {
          type: "function",
          name: "commit_booking",
          description: "Commit the booking draft",
          parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
          strict: true,
        },
      ],
    },
    false,
    null,
    "claude"
  );

  assert.deepEqual(translated.output_config.format, {
    type: "json_schema",
    schema,
  });
  assert.equal(translated.tools[0].name, "proxy_commit_booking");
  assert.equal(translated.tools[0].strict, true);
  assert.deepEqual(translated.tools[0].input_schema, {
    type: "object",
    additionalProperties: false,
    properties: {},
    required: [],
  });
});

test("translateRequest sanitizes OpenAI tool payloads on passthrough", () => {
  const translated = translateRequest(
    FORMATS.OPENAI,
    FORMATS.OPENAI,
    "gpt-5.2",
    {
      messages: [{ role: "user", content: "hello" }],
      tools: [
        {
          type: "function",
          function: {
            name: "sum",
            description: 7,
            parameters: {
              type: "object",
              properties: {
                count: { type: "integer", minimum: "2" },
              },
            },
          },
        },
      ],
    },
    false,
    null,
    "openai"
  );

  assert.equal(translated.tools[0].function.description, "7");
  assert.equal(translated.tools[0].function.parameters.properties.count.minimum, 2);
});

test("tool sanitization: injects empty reasoning_content only for DeepSeek tool-call history", () => {
  const messages = [
    { role: "user", content: "hello" },
    {
      role: "assistant",
      tool_calls: [{ id: "call_1", type: "function", function: { name: "sum", arguments: "{}" } }],
    },
  ];

  const deepseekMessages = injectEmptyReasoningContentForToolCalls(messages, "deepseek");
  const openaiMessages = injectEmptyReasoningContentForToolCalls(messages, "openai");

  assert.equal(deepseekMessages[1].reasoning_content, "");
  assert.equal(openaiMessages[1].reasoning_content, undefined);
});

test("translateRequest injects reasoning_content for DeepSeek assistant tool calls", () => {
  const translated = translateRequest(
    FORMATS.OPENAI,
    FORMATS.OPENAI,
    "deepseek-reasoner",
    {
      messages: [
        { role: "user", content: "hello" },
        {
          role: "assistant",
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "sum", arguments: "{}" } },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: "3" },
      ],
    },
    false,
    null,
    "deepseek"
  );

  assert.equal(translated.messages[1].reasoning_content, "");
});
