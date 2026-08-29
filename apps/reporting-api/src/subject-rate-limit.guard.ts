import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { SubjectRateLimiter } from '@bap/security';

import type { AuthenticatedRequest, HttpResponse } from './request-context.js';

export const SUBJECT_RATE_LIMITER = Symbol('SUBJECT_RATE_LIMITER');

@Injectable()
export class SubjectRateLimitGuard implements CanActivate {
  constructor(
    @Inject(SUBJECT_RATE_LIMITER)
    private readonly limiter: SubjectRateLimiter,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const response = context.switchToHttp().getResponse<HttpResponse>();
    const principal = request.resourcePrincipal;

    if (principal === undefined) {
      throw new UnauthorizedException();
    }

    const decision = this.limiter.check(principal.subject);

    if (!decision.allowed) {
      response.setHeader('Retry-After', decision.retryAfterSeconds);
      throw new HttpException(
        'Request rate limit exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    response.setHeader('RateLimit-Limit', this.limiter.maximum);
    response.setHeader('RateLimit-Remaining', decision.remaining);
    response.setHeader('RateLimit-Reset', Math.ceil(decision.resetAt / 1000));
    return true;
  }
}
