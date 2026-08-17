/**
 * Installed chrome icons (@tabler/icons-react, 16×16, stroke 1.5) plus
 * colored file/directory glyphs (@react-symbols/icons).
 *
 * Official primitives icons are not required. Sidebar chrome uses this set
 * so glyphs stay the same optical weight as the rest of the product.
 */
import type { ReactNode } from 'react'
import {
  DefaultFolderOpenedIcon,
  getIconForFile,
  getIconForFolder,
} from '@react-symbols/icons/utils'
import {
  IconAdjustments as TbAdjustments,
  IconArchive as TbArchive,
  IconCheck as TbCheck,
  IconChevronDown as TbChevronDown,
  IconChevronRight as TbChevronRight,
  IconCircleMinus as TbCircleMinus,
  IconCirclePlus as TbCirclePlus,
  IconCircleX as TbCircleX,
  IconCopy as TbCopy,
  IconDots as TbDots,
  IconEdit as TbEdit,
  IconExternalLink as TbExternalLink,
  IconEye as TbEye,
  IconFile as TbFile,
  IconFileCode as TbFileCode,
  IconFileDiff as TbFileDiff,
  IconFileText as TbFileText,
  IconFiles as TbFiles,
  IconFolder as TbFolder,
  IconFolderOpen as TbFolderOpen,
  IconFolderPlus as TbFolderPlus,
  IconGitBranch as TbGitBranch,
  IconGitCommit as TbGitCommit,
  IconGitPullRequest as TbGitPullRequest,
  IconHistory as TbHistory,
  IconLayoutBottombarFilled as TbLayoutBottombarFilled,
  IconLayoutList as TbLayoutList,
  IconLayoutSidebarRightFilled as TbLayoutSidebarRightFilled,
  IconLink as TbLink,
  IconList as TbList,
  IconListTree as TbListTree,
  IconMaximize as TbMaximize,
  IconMessagePlus as TbMessagePlus,
  IconMinus as TbMinus,
  IconPlus as TbPlus,
  IconRefresh as TbRefresh,
  IconRotateClockwise as TbRotateClockwise,
  IconSearch as TbSearch,
  IconSquareMinus as TbSquareMinus,
  IconSquarePlus as TbSquarePlus,
  IconSquareX as TbSquareX,
  IconTerminal2 as TbTerminal2,
  IconTrash as TbTrash,
  IconTriangle as TbTriangle,
  IconWorld as TbWorld,
  IconX as TbX,
  type Icon as TablerIcon,
  type IconProps,
} from '@tabler/icons-react'

const DEFAULT_SIZE = 16
const DEFAULT_STROKE = 1.5

type AppIcon = (props: IconProps) => JSX.Element

/** Wrap a Tabler icon with the product defaults (16px / stroke 1.5). */
function tabler(Component: TablerIcon): AppIcon {
  return (props) => (
    <Component
      size={DEFAULT_SIZE}
      stroke={DEFAULT_STROKE}
      aria-hidden="true"
      {...props}
    />
  )
}

export const IconCheck = tabler(TbCheck)
export const IconChevronDown = tabler(TbChevronDown)
export const IconChevronRight = tabler(TbChevronRight)
export const IconPlus = tabler(TbPlus)
export const IconMinus = tabler(TbMinus)
export const IconTrash = tabler(TbTrash)
export const IconCopy = tabler(TbCopy)
export const IconRefresh = tabler(TbRefresh)
export const IconEye = tabler(TbEye)
export const IconHistory = tabler(TbHistory)
export const IconTerminal = tabler(TbTerminal2)
export const IconGitBranch = tabler(TbGitBranch)
export const IconGitCommit = tabler(TbGitCommit)
export const IconGitPull = tabler(TbGitPullRequest)
export const IconRotate = tabler(TbRotateClockwise)
export const IconFiles = tabler(TbFiles)
export const IconList = tabler(TbList)
export const IconListTree = tabler(TbListTree)
export const IconSidebarRightFilled = tabler(TbLayoutSidebarRightFilled)
export const IconBottombarFilled = tabler(TbLayoutBottombarFilled)
export const IconLayoutList = tabler(TbLayoutList)
export const IconFolder = tabler(TbFolder)
export const IconFolderOpen = tabler(TbFolderOpen)
export const IconFileDiff = tabler(TbFileDiff)
export const IconExternalLink = tabler(TbExternalLink)
export const IconCirclePlus = tabler(TbCirclePlus)
export const IconCircleMinus = tabler(TbCircleMinus)
export const IconCircleX = tabler(TbCircleX)
export const IconSquarePlus = tabler(TbSquarePlus)
export const IconSquareMinus = tabler(TbSquareMinus)
export const IconSquareX = tabler(TbSquareX)
export const IconDots = tabler(TbDots)
export const IconEdit = tabler(TbEdit)
export const IconSearch = tabler(TbSearch)
export const IconArchive = tabler(TbArchive)
export const IconAdjustments = tabler(TbAdjustments)
export const IconTriangle = tabler(TbTriangle)
export const IconFolderPlus = tabler(TbFolderPlus)
export const IconClose = tabler(TbX)
export const IconFileText = tabler(TbFileText)
export const IconFile = tabler(TbFile)
export const IconFileCode = tabler(TbFileCode)
export const IconMaximize = tabler(TbMaximize)
export const IconWorld = tabler(TbWorld)
export const IconMessagePlus = tabler(TbMessagePlus)

/**
 * Left-panel toggle glyph: a frame with a filled strip along its LEFT edge.
 * Tabler only ships arrow-bearing left variants.
 */
export const IconSidebarLeftFilled = ({
  size = DEFAULT_SIZE,
  className,
}: {
  size?: number
  className?: string
}): JSX.Element => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
    className={className}
  >
    <path d="M18 3a3 3 0 0 1 2.995 2.824l.005 .176v12a3 3 0 0 1 -2.824 2.995l-.176 .005h-12a3 3 0 0 1 -2.995 -2.824l-.005 -.176v-12a3 3 0 0 1 2.824 -2.995l.176 -.005h12zm0 2h-9v14h9a1 1 0 0 0 .993 -.883l.007 -.117v-12a1 1 0 0 0 -.883 -.993l-.117 -.007z" />
  </svg>
)

export type { IconProps }

export { getIconForFile, getIconForFolder } from '@react-symbols/icons/utils'

export type FileGlyphKind = 'directory' | 'file' | 'symlink'

/** Colored file/directory glyph (VSCode Material style, 16px). */
export function FileGlyph({
  path,
  kind,
  expanded = false,
  className,
}: {
  path: string
  kind: FileGlyphKind
  expanded?: boolean
  className?: string
}): JSX.Element {
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? 'file'
  const wrap = (icon: ReactNode): JSX.Element => (
    <span className={className} aria-hidden="true" data-icon-vendor="react-symbols" style={{ display: 'inline-flex', alignItems: 'center' }}>
      {icon}
    </span>
  )
  if (kind === 'directory') {
    if (expanded) {
      return wrap(<DefaultFolderOpenedIcon width={DEFAULT_SIZE} height={DEFAULT_SIZE} />)
    }
    return wrap(getIconForFolder({
      folderName: name,
      width: DEFAULT_SIZE,
      height: DEFAULT_SIZE,
    }))
  }
  if (kind === 'symlink') {
    return (
      <span className={className} aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center' }}>
        <TbLink size={DEFAULT_SIZE} stroke={DEFAULT_STROKE} />
      </span>
    )
  }
  return wrap(getIconForFile({
    fileName: name,
    autoAssign: true,
    width: DEFAULT_SIZE,
    height: DEFAULT_SIZE,
  }))
}
