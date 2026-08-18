import { useRef, type ChangeEvent } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { ProjectIconGlyph, projectIconChoices } from './ProjectIconGlyph.tsx'
import type { ProjectIconBuiltin } from './domain/project-icon.ts'
import type { ProjectIconNode, ProjectNode } from './tree.ts'
import type { WorkspaceBrowserProps } from './contract/slots.ts'

export interface ProjectIconModalProps {
  open: boolean
  project: ProjectNode | null
  onClose: () => void
  onSetBuiltin: (name: ProjectIconBuiltin) => void
  onUploadPng: (dataUrl: string) => void
  onRefresh: () => void
  onReset: () => void
  t: WorkspaceBrowserProps['t']
}

export function ProjectIconModal({
  open,
  project,
  onClose,
  onSetBuiltin,
  onUploadPng,
  onRefresh,
  onReset,
  t,
}: ProjectIconModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  if (project === null) return null

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (file === undefined || file.type !== 'image/png' || file.size > 256 * 1024) return
    const bytes = new Uint8Array(await file.arrayBuffer())
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    if (signature.some((value, index) => bytes[index] !== value)) return
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    onUploadPng(`data:image/png;base64,${btoa(binary)}`)
    onClose()
  }

  const currentIcon: ProjectIconNode = project.icon ?? {
    source: 'fallback',
    value: project.isGit ? 'project' : 'directory',
    fallback: project.isGit ? 'project' : 'directory',
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeLabel={t('close')}
      title={t('project.icon.set')}
      footer={<Button variant="outline" onClick={onClose}>{t('close')}</Button>}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png"
        hidden
        onChange={(event) => { void onFileChange(event) }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '4px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--dsw-alias-label-secondary)' }}>
            {t('project.icon.current')}:
          </span>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              borderRadius: 8,
              background: 'var(--dsw-alias-interactive-bg-hover)',
              border: '1px solid var(--dsw-alias-border-l1)',
            }}
          >
            <ProjectIconGlyph icon={currentIcon} size={20} />
          </div>
          <span style={{ fontSize: 13, color: 'var(--dsw-alias-label-primary)', fontWeight: 500 }}>
            {project.label}
          </span>
        </div>

        <div>
          <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', marginBottom: 8 }}>
            {t('project.icon.chooseBuiltin')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {projectIconChoices.map(name => {
              const isSelected = currentIcon.value === name
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => {
                    onSetBuiltin(name as ProjectIconBuiltin)
                    onClose()
                  }}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    padding: '10px 4px',
                    borderRadius: 8,
                    border: isSelected
                      ? '1px solid var(--dsw-alias-state-business-primary)'
                      : '1px solid var(--dsw-alias-border-l1)',
                    background: isSelected
                      ? 'var(--dsw-alias-interactive-bg-hover)'
                      : 'transparent',
                    cursor: 'pointer',
                    color: 'var(--dsw-alias-label-primary)',
                  }}
                >
                  <ProjectIconGlyph
                    icon={{ source: 'override', value: name, fallback: 'project' }}
                    size={20}
                  />
                  <span style={{ fontSize: 11, color: 'var(--dsw-alias-label-secondary)' }}>
                    {t(`project.icon.${name}` as never)}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
          <Button
            variant="outline"
            onClick={() => { fileInputRef.current?.click() }}
          >
            {t('project.icon.upload')}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              onRefresh()
              onClose()
            }}
          >
            {t('project.icon.refresh')}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              onReset()
              onClose()
            }}
          >
            {t('project.icon.reset')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
