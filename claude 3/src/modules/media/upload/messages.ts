/** User-facing copy for CLIENT-side conditions only. Server-returned messages are shown as-is. */
export const MESSAGES = {
  unsupportedType: "This file type isn't supported.",
  emptyFile: "This file looks empty.",
  unreadable: "Couldn't read this file. Try selecting it again.",
  connection: "Couldn't add this one. Check your connection and try again.",
  sessionEnded: "Your session ended. Sign in to continue.",
  uploadRejected: "This one didn't go through. Please add it again.",
  generic: "Something went wrong. Please try again.",
  keepOpen: "Keep Trip Chalo open until this finishes.",
} as const;

export function videoTooBigMessage(limitMb: number): string {
  return `That's a big one. Clips can be up to ${limitMb} MB.`;
}

export function photoTooBigMessage(limitMb: number): string {
  return `That photo is too big. Photos can be up to ${limitMb} MB.`;
}
