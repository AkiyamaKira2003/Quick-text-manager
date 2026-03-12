'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export type PromptDialogSubmit = {
  value: string
  note: string
}

type PromptDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  label: string
  noteLabel?: string
  defaultValue?: string
  defaultNote?: string
  placeholder?: string
  notePlaceholder?: string
  extraNoteLabel?: string
  extraNotePlaceholder?: string
  extraNoteBuilder?: (text: string) => string
  submitLabel?: string
  cancelLabel?: string
  savingLabel?: string
  requiredTextError?: string
  saveFailedError?: string
  onSubmit: (payload: PromptDialogSubmit) => Promise<void> | void
}

export function PromptDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  noteLabel = 'Note',
  defaultValue = '',
  defaultNote = '',
  placeholder = 'Enter text',
  notePlaceholder = 'Optional note',
  extraNoteLabel = '',
  extraNotePlaceholder = '',
  extraNoteBuilder,
  submitLabel = 'Save',
  cancelLabel = 'Cancel',
  savingLabel = 'Saving...',
  requiredTextError = 'Text is required.',
  saveFailedError = 'Save failed.',
  onSubmit,
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue)
  const [note, setNote] = useState(defaultNote)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorText, setErrorText] = useState('')

  useEffect(() => {
    if (!open) return
    setValue(defaultValue)
    setNote(defaultNote)
    setErrorText('')
    setIsSubmitting(false)
  }, [open, defaultValue, defaultNote])

  const canSubmit = useMemo(() => value.trim().length > 0 && !isSubmitting, [value, isSubmitting])
  const extraNote = useMemo(() => (extraNoteBuilder ? extraNoteBuilder(value) : ''), [extraNoteBuilder, value])
  const showExtraNote = !!extraNoteBuilder && !!extraNoteLabel

  const handleSubmit = async () => {
    const trimmedValue = value.trim()
    if (!trimmedValue) {
      setErrorText(requiredTextError)
      return
    }

    setIsSubmitting(true)
    setErrorText('')

    try {
      await onSubmit({ value: trimmedValue, note: note.trim() })
      onOpenChange(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : saveFailedError
      setErrorText(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] bg-[var(--qt-surface-strong)] border-[var(--qt-border)] text-[var(--qt-fg)]">
        <DialogHeader>
          <DialogTitle className="text-[var(--qt-fg)]">{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="prompt-input">{label}</Label>
            <Input
              id="prompt-input"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={placeholder}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                void handleSubmit()
              }}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="prompt-note">{noteLabel}</Label>
            <Input
              id="prompt-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={notePlaceholder}
            />
          </div>

          {showExtraNote ? (
            <div className="grid gap-2">
              <Label htmlFor="prompt-extra-note">{extraNoteLabel}</Label>
              <Input
                id="prompt-extra-note"
                value={extraNote}
                readOnly
                placeholder={extraNotePlaceholder}
                className="text-[11px] tracking-wide text-cyan-300 placeholder:text-[var(--qt-muted)]"
              />
            </div>
          ) : null}
        </div>

        {errorText ? <p className="text-sm text-red-300">{errorText}</p> : null}

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            {cancelLabel}
          </Button>
          <Button
            type="submit"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            className="bg-[var(--qt-primary)] text-[var(--qt-on-primary)] hover:brightness-105"
          >
            {isSubmitting ? savingLabel : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
