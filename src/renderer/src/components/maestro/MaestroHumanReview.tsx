import { ExternalLink, Loader2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { MaestroHumanReview as MaestroHumanReviewRecord } from '../../../../shared/maestro-human-review'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { TechnicalDisclosure } from './MaestroRunProgressSections'
import type { MaestroHumanReviewTransitionInput } from './useMaestroHumanReview'

const APPROVAL_LIFETIME_MS = 24 * 60 * 60 * 1_000

const STATE_LABELS: Record<MaestroHumanReviewRecord['state'], string> = {
  staged: 'Staged',
  needs_input: 'Needs input',
  approved_for_submit: 'Approved for submit',
  submitted: 'Submitted',
  rejected: 'Rejected',
  expired: 'Approval expired'
}

export function urgentHumanReviewCount(reviews: readonly MaestroHumanReviewRecord[]): number {
  return reviews.filter((review) =>
    ['staged', 'needs_input', 'approved_for_submit', 'expired'].includes(review.state)
  ).length
}

type HumanReviewProps = {
  status: 'loading' | 'ready' | 'error'
  reviews: readonly MaestroHumanReviewRecord[]
  error: string | null
  onRefresh: () => Promise<void>
  onTransition: (request: MaestroHumanReviewTransitionInput) => Promise<void>
  onFocusBrowser: (review: MaestroHumanReviewRecord) => Promise<void>
}

function receiptId(action: string): string {
  return `${action}-${crypto.randomUUID()}`
}

function technicalEntries(review: MaestroHumanReviewRecord) {
  return [
    { label: 'Review', value: review.review_id },
    { label: 'Task', value: review.task_id },
    { label: 'Dispatch', value: review.dispatch_id },
    ...review.references.documents.map((document) => ({
      label: 'Document',
      value: `${document.document_ref}@${document.revision}`
    })),
    ...review.references.fields.map((field) => ({
      label: 'Field',
      value: `${field.document_ref}:${field.field_path}`
    })),
    ...(review.references.browser
      ? [
          { label: 'Surface', value: review.references.browser.surface_id },
          { label: 'Page', value: review.references.browser.browser_page_id }
        ]
      : [])
  ]
}

export function MaestroHumanReview(props: HumanReviewProps): React.JSX.Element {
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null)
  const selectedReview = useMemo(
    () => props.reviews.find((review) => review.review_id === selectedReviewId) ?? null,
    [props.reviews, selectedReviewId]
  )

  return (
    <section className="space-y-1.5" aria-label="Application review">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
          Application review
        </h3>
        {props.status === 'ready' ? <Badge variant="outline">{props.reviews.length}</Badge> : null}
      </div>
      <HumanReviewList {...props} onSelect={setSelectedReviewId} />
      <Sheet
        open={selectedReview !== null}
        onOpenChange={(open) => !open && setSelectedReviewId(null)}
      >
        {selectedReview ? (
          <HumanReviewSheet
            review={selectedReview}
            onTransition={props.onTransition}
            onFocusBrowser={props.onFocusBrowser}
          />
        ) : null}
      </Sheet>
    </section>
  )
}

function HumanReviewList(
  props: HumanReviewProps & { onSelect: (reviewId: string) => void }
): React.JSX.Element {
  if (props.status === 'loading') {
    return (
      <div
        className="flex items-center gap-2 py-2 text-xs text-muted-foreground"
        aria-live="polite"
      >
        <Loader2 className="size-3.5 animate-spin" /> Loading review items…
      </div>
    )
  }
  if (props.status === 'error') {
    return (
      <div className="rounded-md border border-border bg-muted/25 p-2 text-xs" role="alert">
        <p className="text-foreground">Review items are unavailable.</p>
        <p className="mt-0.5 text-muted-foreground">{props.error}</p>
        <Button className="mt-2" size="xs" variant="outline" onClick={() => void props.onRefresh()}>
          Retry
        </Button>
      </div>
    )
  }
  if (props.reviews.length === 0) {
    return <p className="py-1 text-xs text-muted-foreground">No applications need review.</p>
  }
  return (
    <div className="divide-y divide-border/80 border-y border-border/80">
      {props.reviews.map((review) => (
        <button
          key={review.review_id}
          type="button"
          className="flex w-full items-start gap-2 px-1 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => props.onSelect(review.review_id)}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium text-foreground">
              {review.title}
            </span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {review.summary}
            </span>
          </span>
          <Badge variant="outline" className="shrink-0">
            {STATE_LABELS[review.state]}
          </Badge>
        </button>
      ))}
    </div>
  )
}

function HumanReviewSheet({
  review,
  onTransition,
  onFocusBrowser
}: {
  review: MaestroHumanReviewRecord
  onTransition: HumanReviewProps['onTransition']
  onFocusBrowser: HumanReviewProps['onFocusBrowser']
}): React.JSX.Element {
  const [resolutions, setResolutions] = useState<Record<string, string>>({})
  const [submissionReference, setSubmissionReference] = useState('')
  const [rejectionReason, setRejectionReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const allDecisionsResolved = review.decisions.every((decision) =>
    resolutions[decision.decision_id]?.trim()
  )

  const runAction = async (action: () => Promise<void>): Promise<void> => {
    setPending(true)
    setError(null)
    try {
      await action()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Review action failed.')
    } finally {
      setPending(false)
    }
  }

  return (
    <SheetContent
      className="scrollbar-sleek overflow-y-auto"
      aria-describedby="maestro-review-description"
    >
      <SheetHeader className="border-b border-border pr-12">
        <div className="flex items-center gap-2">
          <SheetTitle>{review.title}</SheetTitle>
          <Badge variant="outline">{STATE_LABELS[review.state]}</Badge>
        </div>
        <SheetDescription id="maestro-review-description">{review.summary}</SheetDescription>
      </SheetHeader>
      <div className="scrollbar-sleek flex-1 space-y-4 overflow-y-auto p-4">
        <ReviewReferences review={review} />
        {review.state === 'staged' || review.state === 'needs_input' ? (
          <DecisionForm review={review} resolutions={resolutions} onChange={setResolutions} />
        ) : null}
        {review.state === 'approved_for_submit' ? (
          <label className="block space-y-1.5 text-xs font-medium text-foreground">
            Submission receipt reference
            <Input
              value={submissionReference}
              onChange={(event) => setSubmissionReference(event.target.value)}
              placeholder="Receipt or confirmation reference…"
              spellCheck={false}
            />
          </label>
        ) : null}
        {['staged', 'needs_input', 'approved_for_submit'].includes(review.state) ? (
          <label className="block space-y-1.5 text-xs font-medium text-foreground">
            Rejection reason
            <Textarea
              value={rejectionReason}
              onChange={(event) => setRejectionReason(event.target.value)}
              placeholder="Why this application cannot proceed…"
            />
          </label>
        ) : null}
        {error ? (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {review.references.browser ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => void runAction(() => onFocusBrowser(review))}
            >
              <ExternalLink /> Browser Focus
            </Button>
          ) : null}
          <ReviewPrimaryAction
            review={review}
            pending={pending}
            allDecisionsResolved={allDecisionsResolved}
            resolutions={resolutions}
            submissionReference={submissionReference}
            runAction={runAction}
            onTransition={onTransition}
          />
          {['staged', 'needs_input', 'approved_for_submit'].includes(review.state) ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending || !rejectionReason.trim()}
              onClick={() =>
                void runAction(() =>
                  onTransition({
                    request_id: receiptId('reject-request'),
                    review_id: review.review_id,
                    action: 'reject',
                    receipt_id: receiptId('reject'),
                    reason: rejectionReason.trim()
                  })
                )
              }
            >
              Reject
            </Button>
          ) : null}
        </div>
        <ReceiptSummary review={review} />
        <TechnicalDisclosure entries={technicalEntries(review)} />
      </div>
    </SheetContent>
  )
}

function DecisionForm({
  review,
  resolutions,
  onChange
}: {
  review: MaestroHumanReviewRecord
  resolutions: Record<string, string>
  onChange: (value: Record<string, string>) => void
}): React.JSX.Element | null {
  if (review.decisions.length === 0) {
    return null
  }
  return (
    <fieldset className="space-y-3">
      <legend className="text-xs font-semibold text-foreground">Decisions required</legend>
      {review.decisions.map((decision) => (
        <label key={decision.decision_id} className="block space-y-1.5 text-xs text-foreground">
          {decision.prompt}
          <Textarea
            value={resolutions[decision.decision_id] ?? ''}
            onChange={(event) =>
              onChange({ ...resolutions, [decision.decision_id]: event.target.value })
            }
            placeholder="Record the human decision…"
          />
        </label>
      ))}
    </fieldset>
  )
}

function ReviewReferences({ review }: { review: MaestroHumanReviewRecord }): React.JSX.Element {
  return (
    <section aria-label="Review scope" className="space-y-2">
      <h3 className="text-xs font-semibold text-foreground">Review scope</h3>
      {[
        ...review.references.documents.map((entry) => entry.title),
        ...review.references.fields.map((entry) => entry.label)
      ].map((label) => (
        <p key={label} className="text-xs text-muted-foreground">
          {label}
        </p>
      ))}
      {review.references.browser ? (
        <p className="text-xs text-muted-foreground">Exact Browser surface attached</p>
      ) : null}
    </section>
  )
}

function ReviewPrimaryAction({
  review,
  pending,
  allDecisionsResolved,
  resolutions,
  submissionReference,
  runAction,
  onTransition
}: {
  review: MaestroHumanReviewRecord
  pending: boolean
  allDecisionsResolved: boolean
  resolutions: Record<string, string>
  submissionReference: string
  runAction: (action: () => Promise<void>) => Promise<void>
  onTransition: HumanReviewProps['onTransition']
}): React.JSX.Element | null {
  if (review.state === 'staged' || review.state === 'needs_input') {
    return (
      <Button
        size="sm"
        disabled={pending || !allDecisionsResolved}
        onClick={() =>
          void runAction(() =>
            onTransition({
              request_id: receiptId('approve-request'),
              review_id: review.review_id,
              action: 'approve',
              receipt_id: receiptId('approve'),
              decision_resolutions: review.decisions.map((decision) => ({
                decision_id: decision.decision_id,
                resolution: (resolutions[decision.decision_id] ?? '').trim()
              })),
              expires_at: new Date(Date.now() + APPROVAL_LIFETIME_MS).toISOString()
            })
          )
        }
      >
        Approve for submit
      </Button>
    )
  }
  if (review.state !== 'approved_for_submit') {
    return null
  }
  return (
    <Button
      size="sm"
      disabled={pending || !submissionReference.trim()}
      onClick={() =>
        void runAction(() =>
          onTransition({
            request_id: receiptId('submit-request'),
            review_id: review.review_id,
            action: 'submit',
            receipt_id: receiptId('submit'),
            submission_reference: submissionReference.trim()
          })
        )
      }
    >
      Record submission
    </Button>
  )
}

function ReceiptSummary({
  review
}: {
  review: MaestroHumanReviewRecord
}): React.JSX.Element | null {
  const text = review.submission_receipt
    ? `Submission recorded ${new Date(review.submission_receipt.recorded_at).toLocaleString()}.`
    : review.approval_receipt
      ? `Human approval recorded. Valid until ${new Date(review.approval_receipt.expires_at).toLocaleString()}.`
      : review.rejection_receipt
        ? `Rejected: ${review.rejection_receipt.reason}`
        : review.expiration_receipt
          ? 'The human approval expired before submission.'
          : null
  return text ? (
    <p className="text-xs text-muted-foreground" role="status">
      {text}
    </p>
  ) : null
}
