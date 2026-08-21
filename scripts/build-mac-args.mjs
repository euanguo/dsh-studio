import { parseDshStudioChannel } from '../src/data-root.ts'

/**
 * Parse the positional architecture and optional package channel used by the
 * macOS build wrapper.
 * @param {readonly string[]} args - arguments after the build script name.
 * @returns {{ requestedArch: string | undefined, channel: 'stable' | 'dev' | undefined }}
 */
export function parseMacBuildArguments(args) {
  let requestedArch
  let channel
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? ''
    if (argument === '--') continue
    if (argument === '--channel') {
      const value = args[index + 1]
      if (value === undefined || value === '' || value.startsWith('-')) {
        throw new Error('--channel needs a value')
      }
      if (channel !== undefined) throw new Error('macOS build channel specified more than once')
      channel = parseDshStudioChannel(value)
      index += 1
      continue
    }
    if (argument.startsWith('--channel=')) {
      if (channel !== undefined) throw new Error('macOS build channel specified more than once')
      channel = parseDshStudioChannel(argument.slice('--channel='.length))
      continue
    }
    if (argument.startsWith('-')) throw new Error(`unsupported macOS build option: ${argument}`)
    if (requestedArch !== undefined) throw new Error(`unexpected macOS build argument: ${argument}`)
    requestedArch = argument
  }
  return { requestedArch, channel }
}
