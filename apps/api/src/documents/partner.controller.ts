import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { organizationIdentifierSchema } from '@bap/security';

import { MembershipResolver } from '../membership-resolver.js';
import type { AuthenticatedRequest } from '../request-context.js';
import { ResourceJwtGuard } from '../resource-jwt.guard.js';
import { SubjectRateLimitGuard } from '../subject-rate-limit.guard.js';
import { allowedEntityIds, resolveTenantAccess } from '../tenant-access.js';
import {
  createPartnerRequestSchema,
  MAX_PARTNER_LIST_SIZE,
  partnerBodyOpenApiSchema,
  partnerIdentifierSchema,
  partnerListOpenApiSchema,
  partnerListQuerySchema,
  partnerListResponseSchema,
  partnerOpenApiSchema,
  partnerSchema,
  updatePartnerRequestSchema,
} from './contract.js';
import type {
  CreatePartnerRequest,
  Partner,
  PartnerListQuery,
  PartnerListResponse,
  UpdatePartnerRequest,
} from './contract.js';
import {
  isDuplicatePartnerRegistration,
  PartnerRepository,
} from './partner-repository.js';
import { isRejectedValue } from './sql.js';

@ApiBearerAuth('resource-token')
@Controller({ path: 'organizations', version: '1' })
export class PartnerController {
  constructor(
    @Inject(MembershipResolver)
    private readonly memberships: MembershipResolver,
    @Inject(PartnerRepository)
    private readonly partners: PartnerRepository,
  ) {}

  @Post(':organizationId/partners')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({ summary: 'Create an organization-wide partner' })
  @ApiBody({ schema: partnerBodyOpenApiSchema })
  @ApiCreatedResponse({ schema: partnerOpenApiSchema })
  @ApiUnauthorizedResponse({ description: 'The resource token is invalid' })
  @ApiForbiddenResponse({ description: 'Organization access is denied' })
  @ApiNotFoundResponse({ description: 'The legal entity is not visible' })
  @ApiConflictResponse({
    description: 'The registration number is already used',
  })
  async createPartner(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Body({ schema: createPartnerRequestSchema }) body: CreatePartnerRequest,
    @Req() request: AuthenticatedRequest,
  ): Promise<Partner> {
    const { entityScope, tenant } = await resolveTenantAccess({
      capability: 'manageDocuments',
      memberships: this.memberships,
      organizationId,
      request,
    });

    try {
      const created = await this.partners.createPartner({
        ...tenant,
        countryCode: body.countryCode ?? null,
        defaultLineCategory: body.defaultLineCategory ?? null,
        legalEntityId: body.legalEntityId ?? null,
        legalEntityIds: allowedEntityIds(entityScope),
        name: body.name,
        registrationNumber: body.registrationNumber ?? null,
        vatNumber: body.vatNumber ?? null,
      });

      // An intercompany entity outside the scope answers exactly like a missing one.
      if (created === null) {
        throw new NotFoundException();
      }

      return partnerSchema.parse(created);
    } catch (error) {
      if (isDuplicatePartnerRegistration(error)) {
        throw new ConflictException();
      }

      // A value the database refused is bad input, never a server fault.
      if (isRejectedValue(error)) {
        throw new BadRequestException();
      }

      throw error;
    }
  }

  @Get(':organizationId/partners')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({
    summary: 'Search the organization partners by name or number',
  })
  @ApiOkResponse({
    description: `At most ${MAX_PARTNER_LIST_SIZE} partners, by name`,
    schema: partnerListOpenApiSchema,
  })
  @ApiUnauthorizedResponse({ description: 'The resource token is invalid' })
  @ApiForbiddenResponse({ description: 'Organization access is denied' })
  async listPartners(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Query({ schema: partnerListQuerySchema }) query: PartnerListQuery,
    @Req() request: AuthenticatedRequest,
  ): Promise<PartnerListResponse> {
    const { entityScope, tenant } = await resolveTenantAccess({
      capability: 'readDocuments',
      memberships: this.memberships,
      organizationId,
      request,
    });
    // The partner itself stays visible; its intercompany entity is masked away when the scope excludes it.
    const partners = await this.partners.listPartners({
      ...tenant,
      legalEntityIds: allowedEntityIds(entityScope),
      q: query.q,
    });

    return partnerListResponseSchema.parse({ partners });
  }

  @Patch(':organizationId/partners/:partnerId')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({
    summary:
      'Change the partner name, numbers, country or default line category',
  })
  @ApiBody({ schema: { ...partnerBodyOpenApiSchema, required: [] } })
  @ApiOkResponse({ schema: partnerOpenApiSchema })
  @ApiUnauthorizedResponse({ description: 'The resource token is invalid' })
  @ApiForbiddenResponse({ description: 'Organization access is denied' })
  @ApiNotFoundResponse({ description: 'The partner is not visible' })
  @ApiConflictResponse({
    description: 'The registration number is already used',
  })
  async updatePartner(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('partnerId', { schema: partnerIdentifierSchema }) partnerId: string,
    @Body({ schema: updatePartnerRequestSchema }) body: UpdatePartnerRequest,
    @Req() request: AuthenticatedRequest,
  ): Promise<Partner> {
    const { entityScope, tenant } = await resolveTenantAccess({
      capability: 'manageDocuments',
      memberships: this.memberships,
      organizationId,
      request,
    });

    try {
      const updated = await this.partners.updatePartner({
        ...tenant,
        // An absent field leaves the stored value alone; an explicit null clears it.
        countryCode: body.countryCode,
        defaultLineCategory: body.defaultLineCategory,
        legalEntityId: body.legalEntityId,
        legalEntityIds: allowedEntityIds(entityScope),
        name: body.name,
        partnerId,
        registrationNumber: body.registrationNumber,
        vatNumber: body.vatNumber,
      });

      if (updated === null) {
        throw new NotFoundException();
      }

      return partnerSchema.parse(updated);
    } catch (error) {
      if (isDuplicatePartnerRegistration(error)) {
        throw new ConflictException();
      }

      // A value the database refused is bad input, never a server fault.
      if (isRejectedValue(error)) {
        throw new BadRequestException();
      }

      throw error;
    }
  }
}
