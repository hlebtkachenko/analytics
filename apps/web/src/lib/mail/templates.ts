export interface MailTemplateResult {
  subject: string;
  text: string;
}

export interface MailTemplateParams {
  to: string;
  url: string;
}

export interface MailInvitationTemplateParams extends MailTemplateParams {
  organization: string;
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

function emailVerificationTemplate(
  params: MailTemplateParams,
): MailTemplateResult {
  return {
    subject: 'Confirm your BAP email address',
    text: `Hello ${params.to},\n\nUse this link to confirm your BAP email address:\n\n${params.url}\n\nIf you did not request this, ignore this email.`,
  };
}

function organizationInvitationTemplate(
  params: MailInvitationTemplateParams,
): MailTemplateResult {
  return {
    subject: `You are invited to ${params.organization} on BAP`,
    text: `Hello ${params.to},\n\nUse this link to review your invitation to ${params.organization} on BAP:\n\n${params.url}\n\nIf you did not expect this, ignore this email.`,
  };
}

// Better Auth mail hooks select a template by name.
export const mailTemplates = {
  emailVerification: emailVerificationTemplate,
  magicLink: magicLinkTemplate,
  organizationInvitation: organizationInvitationTemplate,
  passwordReset: passwordResetTemplate,
} as const;

export type MailTemplateName = keyof typeof mailTemplates;
