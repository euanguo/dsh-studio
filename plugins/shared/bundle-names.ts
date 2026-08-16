/**
 * Canonical lazy chunk names shared by the host bundle route and the
 * client chunk loader — one list, so the servable set and the requested
 * set cannot drift (a client requesting an unlisted name would 404).
 */
export const CHUNK_NAMES = ['docx', 'xlsx', 'pptx', 'terminal', 'editor', 'mermaid', 'pierre-worker'] as const
export type ChunkName = (typeof CHUNK_NAMES)[number]
