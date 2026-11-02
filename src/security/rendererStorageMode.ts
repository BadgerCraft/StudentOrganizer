import { protectedLaunchMarker } from './protectedLaunch';
export type RendererStorageMode = 'legacy' | 'bootstrapping' | 'encrypted' | 'locked';
let mode: RendererStorageMode = 'legacy';
/** Only startup changes mode after an authenticated native launch-status response. */
export function setRendererStorageMode(next: RendererStorageMode): void { mode = next; }
export function rendererStorageMode(): RendererStorageMode { return mode; }
export function memoryDatabaseRequired(): boolean { return protectedLaunchMarker() || mode !== 'legacy' || (typeof window !== 'undefined' && Boolean(window.desktopEncryption)); }
