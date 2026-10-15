import { z } from "zod";
import { RUN_ID_PATTERN } from "@/lib/run-store-id";
import { MAX_ERROR_MESSAGE_CHARACTERS, MODEL_IDS, RUN_ERROR_KINDS } from "@/lib/types";

/**
 * Outcomes only the browser can see: the server logs a run's own failure, but not that the page never collected
 * it, lost the server, or gave up. The page reports these so a run that produced nothing on a phone leaves a
 * trace that says why. No prompt content is ever included.
 */
export const CLIENT_EVENT_NAMES = [
  /** The page saw the run end `failed` on the server. */
  "run_failed",
  /** The page could not reach the server, or the run did not finish, before the page's deadline. */
  "run_lost",
  /** The server answered 404 for a run the page was following. */
  "run_unavailable",
  /** Starting the run was refused (a 4xx or 5xx on the POST). */
  "run_start_failed",
  /** A run in progress when the page was last left was older than the resume window when the page came back. */
  "run_abandoned",
] as const;

export type ClientEventName = (typeof CLIENT_EVENT_NAMES)[number];

export const clientEventSchema = z.object({
  event: z.enum(CLIENT_EVENT_NAMES),
  runId: z.string().regex(RUN_ID_PATTERN).optional(),
  model: z.enum(MODEL_IDS).optional(),
  kind: z.enum(RUN_ERROR_KINDS).optional(),
  message: z.string().max(MAX_ERROR_MESSAGE_CHARACTERS + 1).optional(),
  statusCode: z.number().int().min(100).max(599).optional(),
  lastStep: z.string().max(120).optional(),
  /** How long the page had followed the run, in milliseconds. */
  followedMs: z.number().int().min(0).optional(),
  /** How old the abandoned run was, in milliseconds. */
  ageMs: z.number().int().min(0).optional(),
  visibility: z.enum(["visible", "hidden"]).optional(),
  online: z.boolean().optional(),
  /** Opened from the home screen as an installed web app. */
  standalone: z.boolean().optional(),
});

export type ClientEvent = z.infer<typeof clientEventSchema>;

/** Largest accepted body; the schema's fields never need more. */
export const MAX_CLIENT_EVENT_BYTES = 4_096;
