import { useRef, type ChangeEvent } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { cn } from './shim/cn.ts'
import { ProjectIconGlyph, projectIconChoices } from './ProjectIconGlyph.tsx'
import type { ProjectIconBuiltin } from './domain/project-icon.ts'
import type { ProjectIconNode, ProjectNode } from './tree.ts'
import type { WorkspaceBrowserProps } from './contract/slots.ts'
import { toast } from '@dsh-studio/shared/toast'
import { ProjectIconModalCss as css } from './styles.ts'

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
    if (file === undefined) return
    if (file.type !== 'image/png') {
      toast(t('project.icon.invalidPng'))
      return
    }
    if (file.size > 256 * 1024) {
      toast(t('project.icon.tooLarge'))
      return
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    if (signature.some((value, index) => bytes[index] !== value)) {
      toast(t('project.icon.invalidPng'))
      return
    }
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
      <div className={css.body}>
        <div className={css.currentRow}>
          <span className={css.currentLabel}>
            {t('project.icon.current')}:
          </span>
          <div className={css.currentTile}>
            <ProjectIconGlyph icon={currentIcon} size={20} />
          </div>
          <span className={css.currentName}>
            {project.label}
          </span>
        </div>

        <div>
          <div className={css.chooseLabel}>
            {t('project.icon.chooseBuiltin')}
          </div>
          <div className={css.choices}>
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
                  className={cn(css.choice, isSelected && css.choiceSelected)}
                >
                  <ProjectIconGlyph
                    icon={{ source: 'override', value: name, fallback: 'project' }}
                    size={20}
                  />
                  <span className={css.choiceName}>
                    {t(`project.icon.${name}` as never)}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div className={css.actions}>
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
