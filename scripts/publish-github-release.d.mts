export interface PublishGitHubReleaseOptions {
  assets: string[]
  releaseExists(tag: string): boolean
  run(command: string, args: string[]): void
  tag: string
}

export function releaseAssets(directory: string): string[]
export function publishGitHubRelease(options: PublishGitHubReleaseOptions): 'created' | 'updated'
