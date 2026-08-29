import { renderMetrics } from '../../lib/metrics';

export async function GET(): Promise<Response> {
  return new Response(await renderMetrics(), {
    headers: {
      'content-type': 'text/plain; version=0.0.4; charset=utf-8',
    },
  });
}
