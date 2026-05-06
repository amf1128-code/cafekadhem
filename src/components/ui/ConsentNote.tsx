import { consentNoteText, type ConsentVerb } from '../../lib/notifications/consent'

/**
 * Fine print rendered under each public form's submit button.
 * 10DLC requires consent copy be visible at the moment of submission;
 * styled deliberately small + low contrast so it never competes with
 * the action buttons. USER_FLOWS_SPEC.md §7.1.
 */
export function ConsentNote({ verb }: { verb: ConsentVerb }) {
  return (
    <p
      style={{
        fontFamily: 'var(--ck-mono)',
        fontSize: 9,
        lineHeight: 1.5,
        letterSpacing: '0.06em',
        opacity: 0.55,
        marginTop: 16,
        maxWidth: 480,
        marginInline: 'auto',
        textAlign: 'center',
      }}
    >
      {consentNoteText(verb)}
    </p>
  )
}
