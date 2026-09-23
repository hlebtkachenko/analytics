// Providers that never read the file, so their values are defaults, not an extraction.
const DEFAULT_PROVIDERS = new Set(['sniff', 'rule', 'auto_route']);

export function providerReadFile(provider: string | null | undefined): boolean {
  return (
    provider !== null &&
    provider !== undefined &&
    !DEFAULT_PROVIDERS.has(provider)
  );
}

// A section's honest state; "Defaults" means filename, day received or rule only, no person.
export type SectionStatus = 'complete' | 'defaults' | 'missing';

export function sectionStatus(
  input: Readonly<{
    // A required field of the section is empty.
    requiredFilled: boolean;
    // A person edited or confirmed the values, corrections exist, or a person decided.
    humanConfirmed: boolean;
    // A provider other than `sniff` actually read the file contents.
    providerRead: boolean;
  }>,
): SectionStatus {
  if (!input.requiredFilled) {
    return 'missing';
  }
  if (input.humanConfirmed || input.providerRead) {
    return 'complete';
  }
  return 'defaults';
}
