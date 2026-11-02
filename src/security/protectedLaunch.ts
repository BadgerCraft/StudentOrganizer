/** Main owns this fixed marker and prevents its removal in a protected window. Added markers can only deny access. */
export function protectedLaunchMarker(): boolean { return typeof location !== 'undefined' && location.hash === '#encrypted-workspace'; }
