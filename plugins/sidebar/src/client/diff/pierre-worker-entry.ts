/**
 * Bundled entry for the @pierre/diffs highlight worker.
 *
 * The worker's top-level module code registers the worker message handlers,
 * so a plain side-effect import is enough. esbuild would normally drop it
 * (the package's `sideEffects` list does not cover this file) — the worker
 * chunk build therefore passes `ignoreAnnotations: true` (build-config.mjs).
 *
 * The chunk is bundled into `dist/plugins/sidebar-host/client-pierre-worker.js`
 * (ESM), served through the sidebar-host /sidebar/bundle route and loaded by
 * `createPierreDiffWorker` in pierre-adapter.tsx.
 *
 * We cannot use `new URL(..., import.meta.url)` in the client bundle (it is
 * emitted in cjs module-factory format, where import.meta is empty), so the
 * worker is served as an explicit chunk instead.
 */
import '@pierre/diffs/worker/worker.js'
