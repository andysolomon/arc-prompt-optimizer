"use client";

import { X } from "lucide-react";
import { dataUrl, formatBytes, type LocalAttachment } from "@/lib/client/images";

/** Thumbnails of the attached images, with a remove control when `onRemove` is given. */
export function AttachmentStrip({ attachments, onRemove }: { attachments: readonly LocalAttachment[]; onRemove?: (id: string) => void }) {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label="Attached images">
      {attachments.map((attachment) => (
        <li key={attachment.id} className="relative flex items-center gap-2 rounded-lg border border-border bg-background p-1.5 pr-2.5 text-xs" data-testid="attachment">
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL preview; next/image cannot optimize it */}
          <img src={dataUrl(attachment)} alt={attachment.name} className="size-12 rounded-md object-cover" />
          <span className="flex max-w-[160px] flex-col leading-tight">
            <span className="truncate font-medium" title={attachment.name}>
              {attachment.name}
            </span>
            <span className="text-muted-foreground">
              {attachment.width}×{attachment.height} · {formatBytes(attachment.bytes)}
            </span>
          </span>
          {onRemove ? (
            <button
              type="button"
              onClick={() => onRemove(attachment.id)}
              aria-label={`Remove ${attachment.name}`}
              className="ml-1 inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X aria-hidden="true" className="size-3.5" />
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
