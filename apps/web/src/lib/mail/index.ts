// Better Auth's password reset, verification, and invitation hooks send through this module.

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
  MailInvitationTemplateParams,
  MailTemplateName,
  MailTemplateParams,
  MailTemplateResult,
} from './templates.ts';
export { mailTemplates } from './templates.ts';
