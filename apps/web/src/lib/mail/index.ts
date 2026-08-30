// Phase 1 wires sendMail into Better Auth's email hooks; nothing here does that yet.

export type { MailConfiguration, MailTransportKind } from './config.ts';
export {
  defaultMailSender,
  developmentPlaceholderApiKey,
  loadMailConfiguration,
} from './config.ts';

export type { MailMessageInput } from './send.ts';
export { sendMail } from './send.ts';

export type { MailSendResult } from './transport.ts';

export type {
  MailTemplateName,
  MailTemplateParams,
  MailTemplateResult,
} from './templates.ts';
export { mailTemplates } from './templates.ts';
