import { IMAGE_ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES, type ImageAttachment, type ImageAttachmentType } from "@/lib/types";

/** Longest edge after downscaling; Anthropic's guidance, and well within the other providers' limits. */
export const MAX_IMAGE_EDGE = 1568;
const JPEG_QUALITY = 0.85;

/** An attachment as held by the page: the wire fields plus a preview URL and a local id. */
export interface LocalAttachment extends ImageAttachment {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
}

export function dataUrl(attachment: ImageAttachment): string {
  return `data:${attachment.type};base64,${attachment.data}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function isAttachmentType(type: string): type is ImageAttachmentType {
  return (IMAGE_ATTACHMENT_TYPES as readonly string[]).includes(type);
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* fall through to an <img>, which some browsers need for GIF or unusual encodings */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`${file.name} is not an image this browser can read.`));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The browser could not encode the image."))), type, quality);
  });
}

async function toBase64(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let index = 0; index < buffer.length; index += 0x8000) binary += String.fromCharCode(...buffer.subarray(index, index + 0x8000));
  return btoa(binary);
}

/**
 * Downscales an image to {@link MAX_IMAGE_EDGE} and re-encodes it so it fits the per-image limit: PNG stays PNG
 * when that is small enough (it keeps transparency and sharp text), otherwise JPEG. A JPEG, PNG, WebP, or GIF
 * already within the limits is sent as is, so an animated GIF or an exact PNG is not re-encoded needlessly; other
 * decodable formats such as HEIC are always re-encoded.
 */
export async function prepareImage(file: File, maxBytes = MAX_ATTACHMENT_BYTES): Promise<LocalAttachment> {
  // Any image the browser can decode is accepted (iOS hands over HEIC photos); only the four wire types pass through unchanged.
  if (!file.type.startsWith("image/")) throw new Error(`${file.name || "That file"} is not a JPEG, PNG, WebP, or GIF image.`);
  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await decode(file);
  } catch {
    throw new Error(`${file.name || "That file"} is not a JPEG, PNG, WebP, or GIF image.`);
  }
  const width = "naturalWidth" in source ? source.naturalWidth : source.width;
  const height = "naturalHeight" in source ? source.naturalHeight : source.height;
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const name = file.name || "image";
  if (isAttachmentType(file.type) && file.size <= maxBytes && Math.max(width, height) <= MAX_IMAGE_EDGE) {
    if ("close" in source) source.close();
    return { id, name, type: file.type, data: await toBase64(file), width, height, bytes: file.size };
  }
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("The browser could not prepare the image.");
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  if ("close" in source) source.close();
  let blob: Blob | undefined;
  let type: ImageAttachmentType = "image/jpeg";
  if (file.type === "image/png") {
    const png = await toBlob(canvas, "image/png");
    if (png.size <= maxBytes) {
      blob = png;
      type = "image/png";
    }
  }
  if (blob === undefined) {
    blob = await toBlob(canvas, "image/jpeg", JPEG_QUALITY);
    for (let quality = JPEG_QUALITY - 0.15; blob.size > maxBytes && quality >= 0.4; quality -= 0.15) blob = await toBlob(canvas, "image/jpeg", quality);
  }
  if (blob.size > maxBytes) throw new Error(`${name} is still over ${formatBytes(maxBytes)} after resizing.`);
  const stem = name.replace(/\.[^.]+$/u, "");
  return { id, name: type === file.type ? name : `${stem}.${type === "image/png" ? "png" : "jpg"}`, type, data: await toBase64(blob), width: canvas.width, height: canvas.height, bytes: blob.size };
}
