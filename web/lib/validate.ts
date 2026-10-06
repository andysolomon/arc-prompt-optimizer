import { optimizeRequestSchema, type OptimizeRequest } from "@/lib/types";

export type ValidationOutcome =
  | { ok: true; value: OptimizeRequest }
  | { ok: false; status: number; message: string };

/** Pure request validation for `POST /api/optimize`. `allowedModels` restricts to providers whose key is configured. */
export function validateOptimizeBody(body: unknown, allowedModels: readonly string[]): ValidationOutcome {
  const parsed = optimizeRequestSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request.";
    return { ok: false, status: 400, message };
  }
  if (!allowedModels.includes(parsed.data.model)) {
    return {
      ok: false,
      status: 400,
      message: `Model '${parsed.data.model}' is not available: its provider key is not configured.`,
    };
  }
  return { ok: true, value: parsed.data };
}
