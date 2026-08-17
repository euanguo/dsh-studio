/**
 * Terminal-dock self-healing mount utilities.
 *
 * The implementation lives in the shared `column-mount` module (the bottom
 * workbench uses the same machinery); this file only re-exports it so
 * existing panel-controls imports keep working.
 */
export {
  createMountScheduler,
  mutationNeedsMount,
} from '../../../shared/column-mount.ts'
