// Claude API wrapper module.
// Every LLM call routes through `callLlm`, which records the prompt, response,
// model, token counts, and wall-clock latency to the LlmCallLog table for
// observability (see app_spec.txt §11).

import Anthropic from "@anthropic-ai/sdk";

import { prisma } from "@/lib/db";

export interface CallLlmOptions {
  purpose: string;
  prompt: string;
  model?: string;
  maxTokens?: number;
  system?: string;
}

export interface CallLlmResult {
  text: string;
  model: string;
  tokenInput: number;
  tokenOutput: number;
  latencyMs: number;
  logId: string;
}

const DEFAULT_MAX_TOKENS = 1024;

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    throw new Error("Missing required environment variable: ANTHROPIC_API_KEY");
  }
  cachedClient = new Anthropic({ apiKey });
  return cachedClient;
}

function readModel(override?: string): string {
  if (typeof override === "string" && override.length > 0) return override;
  const fromEnv = process.env.CLAUDE_MODEL;
  if (typeof fromEnv !== "string" || fromEnv.length === 0) {
    throw new Error("Missing required environment variable: CLAUDE_MODEL");
  }
  return fromEnv;
}

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

export async function callLlm(options: CallLlmOptions): Promise<CallLlmResult> {
  const { purpose, prompt, system, maxTokens } = options;
  if (typeof purpose !== "string" || purpose.length === 0) {
    throw new Error("callLlm requires a non-empty purpose");
  }
  if (typeof prompt !== "string" || prompt.length === 0) {
    throw new Error("callLlm requires a non-empty prompt");
  }

  const model = readModel(options.model);
  const client = getClient();

  const start = Date.now();
  const message = await client.messages.create({
    model,
    max_tokens: maxTokens ?? DEFAULT_MAX_TOKENS,
    ...(system ? { system } : {}),
    messages: [{ role: "user", content: prompt }],
  });
  const latencyMs = Date.now() - start;

  const text = extractText(message.content);
  const tokenInput = message.usage?.input_tokens ?? 0;
  const tokenOutput = message.usage?.output_tokens ?? 0;

  const log = await prisma.llmCallLog.create({
    data: {
      purpose,
      model,
      prompt,
      response: text,
      tokenInput,
      tokenOutput,
      latencyMs,
    },
    select: { id: true },
  });

  return {
    text,
    model,
    tokenInput,
    tokenOutput,
    latencyMs,
    logId: log.id,
  };
}
