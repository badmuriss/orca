import { Eye, FileText, Link2, Save, SquarePen, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { MAESTRO_NOTE_MAX_BYTES, noteByteCount } from './maestro-canvas-view-model'
import { MaestroMarkdown } from './MaestroMarkdown'
import {
  maestroAnnotationTones,
  readMaestroAnnotationTone,
  writeMaestroAnnotationTone
} from './maestro-annotation-tone'
import { translate } from '@/i18n/i18n'

type MaestroNoteEditorProps = {
  title: string
  markdown: string
  revision: number | null
  contextSnapshotRevision?: string
  onSave: (value: { title: string; markdown: string }) => void
  onDismiss: () => void
  onPinContext?: () => void
}

export function MaestroNoteEditor({
  title: initialTitle,
  markdown: initialMarkdown,
  revision,
  contextSnapshotRevision,
  onSave,
  onDismiss,
  onPinContext
}: MaestroNoteEditorProps): React.JSX.Element {
  const [title, setTitle] = useState(initialTitle)
  const [markdown, setMarkdown] = useState(initialMarkdown)
  const [preview, setPreview] = useState(false)
  const dirty = title !== initialTitle || markdown !== initialMarkdown
  const isNewNote = revision === null
  const byteCount = noteByteCount(markdown)
  const overLimit = byteCount > MAESTRO_NOTE_MAX_BYTES
  const tone = readMaestroAnnotationTone(markdown)

  return (
    <section
      className="w-[min(30rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-card shadow-[0_10px_24px_rgb(0_0_0/0.18)]"
      aria-label={translate(
        'auto.components.maestro.MaestroNoteEditor.834ca7c7cb',
        'Maestro note editor'
      )}
    >
      <header className="flex items-center gap-2 border-b border-border bg-[color:var(--maestro-chrome)] px-3 py-2">
        <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[13px] font-medium leading-4 text-foreground">
            {translate('auto.components.maestro.MaestroNoteEditor.c588409bdb', 'Edit context note')}
          </h2>
          <p className="mt-0.5 truncate text-[11px] leading-4 text-muted-foreground">
            {isNewNote
              ? translate(
                  'auto.components.maestro.MaestroNoteEditor.2c2ccad051',
                  'New note · Unsaved'
                )
              : translate(
                  'auto.components.maestro.MaestroNoteEditor.1650714d92',
                  'Revision {{value0}} · {{value1}}',
                  { value0: revision, value1: dirty ? 'Unsaved changes' : 'Saved' }
                )}
          </p>
        </div>
        <span
          className="shrink-0 rounded-full border border-border bg-background px-1.5 py-px text-[10px] leading-4 text-muted-foreground"
          data-maestro-save-state
        >
          {isNewNote || dirty
            ? translate('auto.components.maestro.MaestroNoteEditor.647a89bdc6', 'Unsaved')
            : translate('auto.components.maestro.MaestroNoteEditor.caff65eb90', 'Saved')}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={translate(
            'auto.components.maestro.MaestroNoteEditor.7f8fbea5c4',
            'Dismiss note editor'
          )}
          onClick={onDismiss}
        >
          <X className="size-3.5" />
        </Button>
      </header>
      <div className="space-y-3 p-3">
        <label className="block text-xs font-medium text-foreground">
          {translate('auto.components.maestro.MaestroNoteEditor.3292b88350', 'Title')}
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="mt-1 h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            aria-label={translate(
              'auto.components.maestro.MaestroNoteEditor.2c902d3f85',
              'Note title'
            )}
          />
        </label>
        {/* Written into the Markdown as a callout marker; the document contract is untouched. */}
        <div className="space-y-1">
          <span className="block text-xs font-medium text-foreground">
            {translate('auto.components.maestro.MaestroNoteEditor.a8567bc727', 'Attention level')}
          </span>
          <div
            className="flex flex-wrap gap-1"
            role="group"
            aria-label={translate(
              'auto.components.maestro.MaestroNoteEditor.ecfca8d7c5',
              'Annotation attention level'
            )}
          >
            {maestroAnnotationTones().map((entry) => (
              <button
                key={entry.tone}
                type="button"
                data-maestro-tone={entry.tone}
                aria-pressed={tone === entry.tone}
                title={entry.hint}
                className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] leading-4 outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  tone === entry.tone
                    ? 'text-foreground'
                    : 'border-border text-muted-foreground hover:bg-accent'
                }`}
                style={
                  tone === entry.tone
                    ? {
                        borderColor: 'var(--maestro-tone)',
                        background: 'color-mix(in srgb, var(--maestro-tone) 12%, transparent)'
                      }
                    : undefined
                }
                onClick={() => setMarkdown(writeMaestroAnnotationTone(markdown, entry.tone))}
              >
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: 'var(--maestro-tone)' }}
                  aria-hidden
                />
                {entry.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <div
            className="flex items-center gap-1 rounded-md border border-border p-0.5"
            role="group"
            aria-label={translate(
              'auto.components.maestro.MaestroNoteEditor.df300192fd',
              'Markdown view'
            )}
          >
            <Button
              type="button"
              variant={preview ? 'ghost' : 'secondary'}
              size="xs"
              aria-pressed={!preview}
              onClick={() => setPreview(false)}
            >
              <SquarePen />{' '}
              {translate('auto.components.maestro.MaestroNoteEditor.91a28339b1', 'Edit')}
            </Button>
            <Button
              type="button"
              variant={preview ? 'secondary' : 'ghost'}
              size="xs"
              aria-pressed={preview}
              onClick={() => setPreview(true)}
            >
              <Eye /> {translate('auto.components.maestro.MaestroNoteEditor.28189ff86e', 'Preview')}
            </Button>
          </div>
          <span
            className={`font-mono text-[10px] tabular-nums ${overLimit ? 'text-destructive' : 'text-muted-foreground'}`}
            aria-live="polite"
          >
            {byteCount.toLocaleString()} / {MAESTRO_NOTE_MAX_BYTES.toLocaleString()}{' '}
            {translate('auto.components.maestro.MaestroNoteEditor.3c3d3d0ee3', 'bytes')}
          </span>
        </div>
        {preview ? (
          <div
            className="min-h-36 rounded-md border border-border bg-editor-surface p-3"
            data-maestro-markdown-preview
          >
            <MaestroMarkdown content={markdown || '*Nothing written yet.*'} />
          </div>
        ) : (
          <Textarea
            value={markdown}
            onChange={(event) => setMarkdown(event.target.value)}
            className="min-h-36 resize-y font-mono text-xs leading-5"
            aria-label={translate(
              'auto.components.maestro.MaestroNoteEditor.88f76301f2',
              'Note Markdown'
            )}
            aria-invalid={overLimit}
          />
        )}
        <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
          <div className="min-w-0 text-xs text-muted-foreground">
            {contextSnapshotRevision ? (
              <span className="inline-flex items-center gap-1.5">
                <Link2 className="size-3.5" aria-hidden />
                {translate(
                  'auto.components.maestro.MaestroNoteEditor.5ea8b506fd',
                  'Pinned context'
                )}{' '}
                {contextSnapshotRevision}
              </span>
            ) : (
              translate(
                'auto.components.maestro.MaestroNoteEditor.effcf5f478',
                'Not linked to execution context'
              )
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {onPinContext ? (
              <Button type="button" variant="outline" size="xs" onClick={onPinContext}>
                {translate('auto.components.maestro.MaestroNoteEditor.80de284c29', 'Link context')}
              </Button>
            ) : null}
            <Button
              type="button"
              size="xs"
              disabled={(!dirty && !isNewNote) || overLimit}
              onClick={() => onSave({ title: title.trim() || 'Untitled note', markdown })}
            >
              <Save /> {translate('auto.components.maestro.MaestroNoteEditor.bbb45243b5', 'Save')}
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
