export type GitReviewLineType = 'context' | 'addition' | 'deletion'

export interface GitReviewLine {
  key: string
  type: GitReviewLineType
  content: string
  oldLine: number | null
  newLine: number | null
}

export type GitReviewFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'binary'

export interface GitReviewFile {
  path: string
  oldPath: string | null
  status: GitReviewFileStatus
  additions: number
  deletions: number
  lines: GitReviewLine[]
}

export interface GitReviewCommitSummary {
  id: string
  shortId: string
  subject: string
  author: string
  authoredAt: string
}

export interface GitReviewCommit extends GitReviewCommitSummary {
  message: string
  files: GitReviewFile[]
}
