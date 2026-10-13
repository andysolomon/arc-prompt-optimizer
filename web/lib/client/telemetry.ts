import type { ClientEvent } from "@/lib/client-events";

export const CLIENT_EVENTS_ENDPOINT = "/api/client-events";

/** What the page can say about its own situation when a run went wrong. */
export function pageSituation(): Pick<ClientEvent, "visibility" | "online" | "standalone"> {
  if (typeof document === "undefined" || typeof window === "undefined") return {};
  return {
    visibility: document.visibilityState === "hidden" ? "hidden" : "visible",
    online: typeof navigator === "undefined" ? true : navigator.onLine,
    standalone: typeof window.matchMedia === "function" ? window.matchMedia("(display-mode: standalone)").matches : false,
  };
}

/**
 * Sends one run outcome to the server's log, fire and forget. `keepalive` lets the request finish when the page
 * is being unloaded, which is when a phone most often reports one. Failures are ignored: telemetry must never
 * get in the way of the page.
 */
export function reportClientEvent(event: ClientEvent, fetchFn: typeof fetch = fetch): void {
  try {
    void fetchFn(CLIENT_EVENTS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...pageSituation(), ...event }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* fetch unavailable */
  }
}
