export interface MailTemplateResult {
  subject: string;
  text: string;
}

export interface MailTemplateParams {
  to: string;
  url: string;
}

function magicLinkTemplate(params: MailTemplateParams): MailTemplateResult {
  return {
    subject: 'Your BAP sign-in link',
    text: `Hello ${params.to},\n\nUse this link to sign in to BAP:\n\n${params.url}\n\nIf you did not request this, ignore this email.`,
  };
}

function passwordResetTemplate(params: MailTemplateParams): MailTemplateResult {
  return {
    subject: 'Reset your BAP password',
    text: `Hello ${params.to},\n\nUse this link to reset your BAP password:\n\n${params.url}\n\nIf you did not request this, ignore this email.`,
  };
}

// Phase 1 selects a template by name when it wires Better Auth's email hooks.
export const mailTemplates = {
  magicLink: magicLinkTemplate,
  passwordReset: passwordResetTemplate,
} as const;

export type MailTemplateName = keyof typeof mailTemplates;
