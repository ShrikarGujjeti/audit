declare module "react/jsx-runtime" { export const jsx: any; export const jsxs: any; export const Fragment: any; }
declare namespace JSX { interface IntrinsicAttributes { key?: string | number } interface IntrinsicElements { [k: string]: any; input: { onChange?: (e: { target: HTMLInputElement }) => void; [k: string]: any } } interface Element {} }
declare module "react" {
  export function useState<T>(init: T | (() => T)): [T, (v: T | ((p: T) => T)) => void];
  export function useRef<T>(init: T): { current: T };
  export function useRef<T>(init: T | null): { current: T | null };
  export function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;
  export function useSyncExternalStore<T>(sub: (l: () => void) => () => void, get: () => T, getServer?: () => T): T;
}
declare module "next/navigation" { export function useRouter(): { refresh(): void }; }
declare module "@/lib/supabase/client" { export function createClient(): { auth: { getUser(): Promise<{ data: { user: unknown } | null; error: unknown }> } }; }
declare module "@/lib/supabase/server" { export function createClient(): Promise<any>; }
declare module "@/modules/auth/session" { export function getCurrentUserId(): Promise<string | null>; }
declare module "@/modules/media/actions" {
  export function requestMediaUploadAction(input: { tripId: string; mimeType: string; fileSizeBytes: number; originalFilename?: string | null; capturedAt?: string | null; width?: number | null; height?: number | null; durationSeconds?: number | null }): Promise<{ error?: string; mediaId?: string; uploadUrl?: string }>;
  export function confirmMediaUploadAction(input: { mediaId: string }): Promise<{ error?: string; success?: string }>;
}
interface BeforeUnloadEvent { returnValue: any }
