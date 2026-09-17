import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getAuthMock,
  getAuthPoolMock,
  loadInboundConfigurationMock,
  postInboundMailgunMimeMock,
} = vi.hoisted(() => ({
  getAuthMock: vi.fn(),
  getAuthPoolMock: vi.fn(),
  loadInboundConfigurationMock: vi.fn(),
  postInboundMailgunMimeMock: vi.fn(),
}));

vi.mock('../../../../../lib/auth/server', () => ({
  getAuth: getAuthMock,
  getAuthPool: getAuthPoolMock,
}));

vi.mock('../../../../../lib/inbox/inbound-mailgun', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../../../../lib/inbox/inbound-mailgun')
  >()),
  loadInboundConfiguration: loadInboundConfigurationMock,
  postInboundMailgunMime: postInboundMailgunMimeMock,
}));

import { POST } from './route';

function request(): Request {
  return new Request('https://bap.invalid/api/inbound/mailgun/mime', {
    method: 'POST',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthMock.mockResolvedValue({ api: { signJWT: vi.fn() } });
  postInboundMailgunMimeMock.mockResolvedValue(
    new Response(null, { status: 202 }),
  );
});

describe('POST /api/inbound/mailgun/mime', () => {
  it('forgets a rejected configuration and loads it again on the next post', async () => {
    loadInboundConfigurationMock
      .mockRejectedValueOnce(new Error('key file missing'))
      .mockResolvedValueOnce({ maxInFlight: 2, signingKey: 'k'.repeat(32) });

    await expect(POST(request())).rejects.toThrow('key file missing');
    expect(postInboundMailgunMimeMock).not.toHaveBeenCalled();

    const response = await POST(request());
    expect(response.status).toBe(202);
    expect(loadInboundConfigurationMock).toHaveBeenCalledTimes(2);
    expect(postInboundMailgunMimeMock).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({ signingKey: 'k'.repeat(32) }),
    );

    // A resolved configuration is kept: the third post reads no file.
    await POST(request());
    expect(loadInboundConfigurationMock).toHaveBeenCalledTimes(2);
  });
});
