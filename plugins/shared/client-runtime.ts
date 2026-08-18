/**
 * Compatibility entry point for the shared runtime primitives.
 * The implementation lives in `runtime.ts`; keeping this export preserves
 * existing consumers while ensuring every registry and generation gate uses
 * one module-level implementation.
 */
export * from './runtime.ts'
