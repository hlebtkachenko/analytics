// pg-boss stores a failed handler's error in pgboss.job.output, which has no row level security
// and is readable across tenants by bap_api. Provider errors carry the request body, and database
// errors carry failing row values, so only a curated name escapes the handler.
export function curateJobFailure(error: unknown): Error {
  const name = error instanceof Error ? error.name : 'Error';

  return new Error(`The job failed with ${name}.`);
}
