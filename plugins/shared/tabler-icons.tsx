/**
 * Tabler 图标统一出口（@tabler/icons-react）+ 彩色文件图标
 * （@react-symbols/icons，按扩展名/目录名着色，VSCode 风格）。
 *
 * 纪律（与参考项目 components/icons.tsx 一致）：
 * - UI 操作图标：Tabler，默认 16×16、stroke 1.5（chrome 光学平衡），
 *   颜色继承 currentColor（跟随主题语义色）；
 * - 文件/目录图标：@react-symbols/icons 彩色（FileGlyph 一行接入）。
 */
import type { ReactNode } from 'react'
import {
  DefaultFolderOpenedIcon,
  getIconForFile,
  getIconForFolder,
} from '@react-symbols/icons/utils'
import {
  IconCheck as TbCheck,
  IconChevronDown as TbChevronDown,
  IconChevronRight as TbChevronRight,
  IconCircleMinus as TbCircleMinus,
  IconCirclePlus as TbCirclePlus,
  IconCircleX as TbCircleX,
  IconCopy as TbCopy,
  IconEye as TbEye,
  IconExternalLink as TbExternalLink,
  IconFile as TbFile,
  IconFileCode as TbFileCode,
  IconFileDiff as TbFileDiff,
  IconFileText as TbFileText,
  IconAdjustments as TbAdjustments,
  IconArchive as TbArchive,
  IconCheck as TbCheck2,
  IconDots as TbDots,
  IconEdit as TbEdit,
  IconFiles as TbFiles,
  IconFolderPlus as TbFolderPlus,
  IconSearch as TbSearch,
  IconTriangle as TbTriangle,
  IconFolder as TbFolder,
  IconFolderOpen as TbFolderOpen,
  IconGitBranch as TbGitBranch,
  IconGitCommit as TbGitCommit,
  IconGitPullRequest as TbGitPullRequest,
  IconHistory as TbHistory,
  IconLayoutList as TbLayoutList,
  IconLink as TbLink,
  IconList as TbList,
  IconListTree as TbListTree,
  IconMinus as TbMinus,
  IconPlus as TbPlus,
  IconRefresh as TbRefresh,
  IconRotateClockwise as TbRotateClockwise,
  IconSquareMinus as TbSquareMinus,
  IconSquarePlus as TbSquarePlus,
  IconSquareX as TbSquareX,
  IconTerminal2 as TbTerminal2,
  IconTrash as TbTrash,
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
/** Close glyph (Tabler `X`), aliased for call sites that use IconClose. */
export const IconClose = tabler(TbX)
/** Text-file glyph (Tabler `FileText`). */
export const IconFileText = tabler(TbFileText)
export const IconFile = tabler(TbFile)
export const IconFileCode = tabler(TbFileCode)

export type { IconProps }

/* ------------------------------------------------------------------ */
/* 文件/目录图标：按扩展名映射                                          */
/* ------------------------------------------------------------------ */

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
    <span className={className} aria-hidden="true" data-icon-vendor="react-symbols">
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
      <span className={className} aria-hidden="true">
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
