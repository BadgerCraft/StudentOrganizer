/** Shared boundary for uploaded, restored and rendered student photos. */
export const MAX_PHOTO_BYTES = 64 * 1024;
export function isLocalPhoto(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_PHOTO_BYTES &&
    /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}
export function safePhotoSource(value: unknown): string | undefined {
  return isLocalPhoto(value) ? value : undefined;
}
