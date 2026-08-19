/** Map a Node host platform to the names used by Node.js distributions. */
export function nodeDistributionPlatform(
  platform: string = process.platform,
): string {
  return platform === 'win32' ? 'win' : platform
}

/** Resolve the requested Node distribution platform for packaging. */
export function resolveNodeDistributionPlatform(
  environment: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform,
): string {
  return environment.DSH_STUDIO_NODE_PLATFORM
    ?? nodeDistributionPlatform(platform)
}
