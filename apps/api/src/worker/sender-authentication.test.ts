import { simpleParser } from 'mailparser';
import { describe, expect, it } from 'vitest';

import { senderAuthenticated } from './split-email-item.js';

const SIGNATURE =
  'v=1; a=rsa-sha256; c=relaxed/relaxed; s=mail; t=1758499200;\r\n' +
  '\th=from:to:subject; bh=Zm9v; b=YmFy';

// A minimal message whose header block is exactly the lines a test names.
async function parse(headers: readonly string[]) {
  return simpleParser(
    Buffer.from(
      [
        ...headers,
        'To: in-0123456789abcdef0123456789abcdef@in.bap.invalid',
        'Subject: Invoice',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'see attached',
        '',
      ].join('\r\n'),
      'utf8',
    ),
    {
      skipHtmlToText: true,
      skipImageLinks: true,
      skipTextToHtml: true,
    },
  );
}

function signature(domain: string): string {
  return `DKIM-Signature: d=${domain}; ${SIGNATURE}`;
}

describe('senderAuthenticated', () => {
  it('passes when the verdict passed and a signature domain equals the From domain', async () => {
    const mail = await parse([
      'From: Sender <billing@dodavatel.cz>',
      'X-Mailgun-Dkim-Check-Result: Pass',
      signature('Dodavatel.CZ'),
    ]);

    expect(senderAuthenticated(mail)).toBe(true);
  });

  it('passes when a signature domain is a parent of the From domain', async () => {
    const mail = await parse([
      'From: Sender <billing@mail.dodavatel.cz>',
      'X-Mailgun-Dkim-Check-Result: pass',
      signature('dodavatel.cz'),
    ]);

    expect(senderAuthenticated(mail)).toBe(true);
  });

  it('fails when the verdict is Fail', async () => {
    const mail = await parse([
      'From: Sender <billing@dodavatel.cz>',
      'X-Mailgun-Dkim-Check-Result: Fail',
      signature('dodavatel.cz'),
    ]);

    expect(senderAuthenticated(mail)).toBe(false);
  });

  it('fails when the verdict header is missing', async () => {
    const mail = await parse([
      'From: Sender <billing@dodavatel.cz>',
      signature('dodavatel.cz'),
    ]);

    expect(senderAuthenticated(mail)).toBe(false);
  });

  it('fails when the verdict header is repeated, whatever the two verdicts say', async () => {
    const mail = await parse([
      'From: Sender <billing@dodavatel.cz>',
      'X-Mailgun-Dkim-Check-Result: Pass',
      'X-Mailgun-Dkim-Check-Result: Pass',
      signature('dodavatel.cz'),
    ]);

    expect(senderAuthenticated(mail)).toBe(false);
  });

  it('fails when no signature domain aligns with the From domain', async () => {
    const mail = await parse([
      'From: Sender <billing@dodavatel.cz>',
      'X-Mailgun-Dkim-Check-Result: Pass',
      signature('mailer.example.org'),
      signature('notdodavatel.cz'),
    ]);

    expect(senderAuthenticated(mail)).toBe(false);
  });

  it('fails when the message carries no From address', async () => {
    const mail = await parse([
      'X-Mailgun-Dkim-Check-Result: Pass',
      signature('dodavatel.cz'),
    ]);

    expect(senderAuthenticated(mail)).toBe(false);
  });
});
