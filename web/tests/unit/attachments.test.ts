import { describe, expect, it } from "vitest";
import { AiSdkCompletionAdapter, promptWithImages } from "@/lib/adapter";
import type { ServerEnv } from "@/lib/env";
import { MODELS, availableModels, modelAcceptsImages } from "@/lib/models";
import { newRunRecord, runMeta } from "@/lib/run-job";
import { MAX_ATTACHMENT_BYTES, base64Bytes, imageAttachmentSchema, type ImageAttachment } from "@/lib/types";
import { validateOptimizeBody } from "@/lib/validate";

// A 1×1 PNG and the first bytes of a JPEG, both real signatures.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]).toString("base64");
const png: ImageAttachment = { name: "dot.png", type: "image/png", data: PNG };
const base = { prompt: "Describe this image.", model: "anthropic/claude-sonnet-4-5", judge: false };
const all = MODELS.map((model) => model.id);

describe("image attachment schema", () => {
  it("accepts the four image types with base64 data within the size limit", () => {
    expect(imageAttachmentSchema.safeParse(png).success).toBe(true);
    expect(imageAttachmentSchema.safeParse({ ...png, type: "image/svg+xml" }).success).toBe(false);
    expect(imageAttachmentSchema.safeParse({ ...png, data: "data:image/png;base64,abc" }).success).toBe(false);
    const oversized = "A".repeat(Math.ceil((MAX_ATTACHMENT_BYTES + 3) / 3) * 4);
    expect(imageAttachmentSchema.safeParse({ ...png, data: oversized }).success).toBe(false);
  });

  it("measures decoded bytes without decoding", () => {
    expect(base64Bytes(PNG)).toBe(Buffer.from(PNG, "base64").length);
    expect(base64Bytes("QQ==")).toBe(1);
    expect(base64Bytes("QUI=")).toBe(2);
    expect(base64Bytes("QUJD")).toBe(3);
  });
});

describe("validateOptimizeBody with attachments", () => {
  it("accepts attachments on a vision model and drops an empty list", () => {
    expect(validateOptimizeBody({ ...base, attachments: [png] }, all)).toMatchObject({ ok: true, value: { attachments: [png] } });
    const empty = validateOptimizeBody({ ...base, attachments: [] }, all);
    expect(empty.ok && empty.value.attachments).toBeUndefined();
  });

  it("rejects attachments on models that do not take images", () => {
    expect(validateOptimizeBody({ ...base, model: "minimax/MiniMax-M2.7", attachments: [png] }, all)).toMatchObject({ ok: false, status: 400, message: "Model 'minimax/MiniMax-M2.7' does not accept image attachments." });
    expect(validateOptimizeBody({ ...base, model: "minimax/MiniMax-M3", attachments: [png] }, all)).toMatchObject({ ok: true });
  });

  it("rejects too many images, a total over the limit, and a file whose bytes do not match its type", () => {
    expect(validateOptimizeBody({ ...base, attachments: [png, png, png, png] }, all)).toMatchObject({ ok: false, status: 400, message: "At most 3 images can be attached." });
    const big = "A".repeat(Math.ceil(1_200_000 / 3) * 4);
    expect(validateOptimizeBody({ ...base, attachments: [{ ...png, data: big }, { ...png, data: big }, { ...png, data: big }] }, all)).toMatchObject({ ok: false, status: 400, message: "Attached images must total at most 3 MB." });
    expect(validateOptimizeBody({ ...base, attachments: [{ ...png, name: "photo.jpg", type: "image/jpeg" }] }, all)).toMatchObject({ ok: false, status: 400, message: "Attachment 'photo.jpg' is not a JPEG image." });
    expect(validateOptimizeBody({ ...base, attachments: [{ name: "a.jpg", type: "image/jpeg", data: JPEG_HEAD }] }, all)).toMatchObject({ ok: true });
  });
});

describe("models", () => {
  it("marks the first-party providers and MiniMax M3 as vision and the other gateway models as text-only", () => {
    expect(MODELS.filter((model) => model.vision).map((model) => model.id)).toEqual(["anthropic/claude-sonnet-4-5", "anthropic/claude-haiku-4-5", "openai/gpt-5-mini", "google/gemini-2.5-flash", "minimax/MiniMax-M3"]);
    expect(modelAcceptsImages("minimax/MiniMax-M2.7")).toBe(false);
    expect(modelAcceptsImages("google/gemini-2.5-flash")).toBe(true);
    expect(modelAcceptsImages("opencode-go/glm-5.3")).toBe(false);
    expect(modelAcceptsImages("nope")).toBe(false);
    expect(availableModels({ OPENAI_API_KEY: "k" })).toEqual([{ id: "openai/gpt-5-mini", label: "GPT-5 mini", provider: "openai", vision: true }]);
  });
});

describe("AiSdkCompletionAdapter with attachments", () => {
  const env: ServerEnv = { ANTHROPIC_API_KEY: "k" };

  it("sends the prompt and the images as one user message, and a plain prompt without them", async () => {
    const calls: Record<string, unknown>[] = [];
    const generate = async (args: Record<string, unknown>) => {
      calls.push(args);
      return { text: "out", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1 } };
    };
    const withImages = new AiSdkCompletionAdapter("anthropic/claude-sonnet-4-5", env, generate as never, [png]);
    await withImages.complete({ prompt: "Describe it." });
    expect(calls[0]).not.toHaveProperty("prompt");
    expect(calls[0]!.messages).toEqual(promptWithImages("Describe it.", [png]));
    expect(promptWithImages("Describe it.", [png])).toEqual([
      { role: "user", content: [{ type: "text", text: "Describe it." }, { type: "image", image: PNG, mediaType: "image/png" }] },
    ]);
    const plain = new AiSdkCompletionAdapter("anthropic/claude-sonnet-4-5", env, generate as never);
    await plain.complete({ prompt: "Describe it." });
    expect(calls[1]).toMatchObject({ prompt: "Describe it." });
    expect(calls[1]).not.toHaveProperty("messages");
  });
});

describe("run records and logs with attachments", () => {
  it("keep the count and the metadata, never the image data", () => {
    const input = { ...base, model: "anthropic/claude-sonnet-4-5" as const, rewrite: true, attachments: [png] };
    expect(runMeta("r", "job", input).attachments).toBe(1);
    const record = newRunRecord("r", input);
    expect(record.attachments).toEqual([{ name: "dot.png", type: "image/png", bytes: base64Bytes(PNG) }]);
    expect(JSON.stringify(record)).not.toContain(PNG);
    expect(newRunRecord("r", { ...input, attachments: undefined }).attachments).toBeUndefined();
  });
});
