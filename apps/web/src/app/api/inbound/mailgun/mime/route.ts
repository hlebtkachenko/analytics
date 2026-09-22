import { getAuth, getAuthPool } from '../../../../../lib/auth/server';
import {
  createInFlightGate,
  loadInboundConfiguration,
  postInboundMailgunMime,
} from '../../../../../lib/inbox/inbound-mailgun';
import type {
  InFlightGate,
  InboundConfiguration,
} from '../../../../../lib/inbox/inbound-mailgun';

// The key file and the in-flight limit are read once on the first post and shared by every later one.
let configuration: Promise<InboundConfiguration> | undefined;
let gate: InFlightGate | undefined;

// A rejected load is forgotten, so a key file fixed after a bad start is read on the next post, not never.
function loadConfiguration(): Promise<InboundConfiguration> {
  const loading = loadInboundConfiguration(process.env);
  loading.catch(() => {
    if (configuration === loading) {
      configuration = undefined;
    }
  });
  return loading;
}

async function inboundRuntime() {
  configuration ??= loadConfiguration();
  const loaded = await configuration;
  gate ??= createInFlightGate(loaded.maxInFlight);
  return { gate, signingKey: loaded.signingKey };
}

// The public Mailgun forward: no session, a signed form resolved on the auth pool, one forwarded call.
export async function POST(request: Request): Promise<Response> {
  const [auth, runtime] = await Promise.all([getAuth(), inboundRuntime()]);
  return postInboundMailgunMime(request, {
    gate: runtime.gate,
    loadPool: getAuthPool,
    signingKey: runtime.signingKey,
    signJWT: auth.api.signJWT,
  });
}
