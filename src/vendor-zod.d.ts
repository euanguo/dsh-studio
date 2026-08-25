/**
 * Ambient fallback for the root typecheck program only. The sealed
 * capabilities sources derive their host schemas with real `zod`
 * (`plugins/capabilities/node_modules/zod`, resolved inside the capabilities
 * tsconfig program); when a pure module from that zone is pulled into this
 * program through a test import, only the import's existence is needed here.
 * Keep the surface minimal: real zod still wins wherever it resolves.
 */
declare module 'zod' {
  export const z: any
}
