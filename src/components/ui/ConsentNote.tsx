import { consentNoteText, type ConsentVerb } from '../../lib/notifications/consent'

/**
 * Fine print rendered under each public form's submit button.
 * 10DLC requires consent copy be visible at the moment of submission.
 * USER_FLOWS_SPEC.md §7.1.
 */
export function ConsentNote({ verb }: { verb: ConsentVerb }) {
  return (
    <p className="text-[11px] leading-snug text-ink-muted opacity-80 mt-3 px-2">
      {consentNoteText(verb)}
    </p>
  )
}
