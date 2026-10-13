import { modelAcceptsImages } from "@/lib/models";
import { optimizeRequestSchema, type ImageAttachment, type OptimizeRequest } from "@/lib/types";

/** The bytes at the start of each accepted image type, so a mislabelled file is rejected before it reaches a provider. */
function matchesSignature(attachment: ImageAttachment): boolean {
  let head: string;
  try {
    head = atob(attachment.data.slice(0, 24));
  } catch {
    return false;
  }
  const byte = (index: number) => head.charCodeAt(index);
  switch (attachment.type) {
    case "image/jpeg":
      return byte(0) === 0xff && byte(1) === 0xd8 && byte(2) === 0xff;
    case "image/png":
      return byte(0) === 0x89 && head.slice(1, 4) === "PNG";
    case "image/gif":
      return head.slice(0, 4) === "GIF8";
    case "image/webp":
      return head.slice(0, 4) === "RIFF" && head.slice(8, 12) === "WEBP";
  }
}

export type ValidationOutcome =
  | { ok: true; value: OptimizeRequest }
  | { ok: false; status: number; message: string };

/**
 * Pure request validation for `POST /api/optimize`. `allowedModels` restricts to providers whose key is
 * configured; `refineAllowed` is the server feature flag.
 */
export function validateOptimizeBody(body: unknown, allowedModels: readonly string[], refineAllowed = false): ValidationOutcome {
  const parsed = optimizeRequestSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request.";
    return { ok: false, status: 400, message };
  }
  if (parsed.data.refine !== undefined) {
    if (!refineAllowed) return { ok: false, status: 400, message: "Refine is not enabled on this server." };
    if (!parsed.data.judge) return { ok: false, status: 400, message: "Refine requires the Jev judge: without it every preview candidate ties." };
  }
  if (!allowedModels.includes(parsed.data.model)) {
    return {
      ok: false,
      status: 400,
      message: `Model '${parsed.data.model}' is not available: its provider key is not configured.`,
    };
  }
  const attachments = parsed.data.attachments ?? [];
  if (attachments.length > 0 && !modelAcceptsImages(parsed.data.model)) {
    return { ok: false, status: 400, message: `Model '${parsed.data.model}' does not accept image attachments.` };
  }
  const mislabelled = attachments.find((attachment) => !matchesSignature(attachment));
  if (mislabelled !== undefined) {
    return { ok: false, status: 400, message: `Attachment '${mislabelled.name}' is not a ${mislabelled.type.slice("image/".length).toUpperCase()} image.` };
  }
  return { ok: true, value: attachments.length === 0 ? { ...parsed.data, attachments: undefined } : parsed.data };
}
