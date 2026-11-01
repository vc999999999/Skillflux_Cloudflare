import { SITE } from '../config';

/** A mailto: link to the editors' mailbox, with an optional prefilled subject and body. */
export function contactMailto(subject?: string, body?: string): string {
  const params = new URLSearchParams();
  if (subject) params.set('subject', subject);
  if (body) params.set('body', body);
  // URLSearchParams encodes spaces as "+", which mail clients show literally; mailto expects %20.
  const query = params.toString().replace(/\+/g, '%20');
  return `mailto:${SITE.contactEmail}${query ? `?${query}` : ''}`;
}
