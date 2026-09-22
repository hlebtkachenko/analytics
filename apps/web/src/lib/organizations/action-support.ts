export function formValue(formData: FormData, name: string): unknown {
  return formData.get(name);
}

export function organizationPath(slug: string, suffix = ''): string {
  return `/${slug}${suffix}`;
}

export type ActionResult =
  | 'accept-error'
  | 'accept-success'
  | 'decline-error'
  | 'decline-success'
  | 'error'
  | 'quota-exhausted'
  | 'slug-taken';

export function resultPath(path: string, result: ActionResult): string {
  return `${path}?result=${result}`;
}
