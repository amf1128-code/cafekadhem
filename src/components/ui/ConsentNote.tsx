import { consentNoteText, type ConsentVerb } from '../../lib/notifications/consent'

/**
 * Fine print rendered under each public form's submit button.
 * 10DLC requires consent copy be visible at the moment of submission;
 * styled deliberately small + low contrast so it never competes with
 * the action buttons. USER_FLOWS_SPEC.md §7.1.
 */
export function ConsentNote({ verb }: { verb: ConsentVerb }) {
  return (
    <p className="text-[10px] leading-relaxed text-ink-muted opacity-60 mt-4 px-4 max-w-md mx-auto text-center">
      {consentNoteText(verb)}
    </p>
  )
}
