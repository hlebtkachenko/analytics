import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { ResourceJwtVerifier } from '@bap/security';

import type { AuthenticatedRequest } from './request-context.js';

export const RESOURCE_JWT_VERIFIER = Symbol('RESOURCE_JWT_VERIFIER');

@Injectable()
export class ResourceJwtGuard implements CanActivate {
  constructor(
    @Inject(RESOURCE_JWT_VERIFIER)
    private readonly verifier: ResourceJwtVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;

    try {
      request.resourcePrincipal = await this.verifier.verifyAuthorizationHeader(
        Array.isArray(authorization) ? undefined : authorization,
      );
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
