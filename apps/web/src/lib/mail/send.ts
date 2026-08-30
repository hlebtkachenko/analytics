import { z } from 'zod';

import type { MailConfiguration } from './config.ts';
import { selectTransport } from './transport.ts';
import type { MailSendResult } from './transport.ts';

const mailMessageSchema = z.object({
  subject: z.string().min(1),
  text: z.string().min(1),
  to: z.email(),
});

export type MailMessageInput = z.infer<typeof mailMessageSchema>;

// Phase 1 wires this into Better Auth's email hooks; nothing here does that yet.
export async function sendMail(
  configuration: MailConfiguration,
  message: MailMessageInput,
): Promise<MailSendResult> {
  const parsed = mailMessageSchema.parse(message);
  const transport = selectTransport(configuration);
  return transport.send(configuration.sender, parsed);
}
