import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { organizationIdentifierSchema } from '@bap/security';

import { isRejectedValue } from '../documents/sql.js';
import { MembershipResolver } from '../membership-resolver.js';
import type { AuthenticatedRequest } from '../request-context.js';
import { ResourceJwtGuard } from '../resource-jwt.guard.js';
import { SubjectRateLimitGuard } from '../subject-rate-limit.guard.js';
import { allowedEntityIds, resolveTenantAccess } from '../tenant-access.js';
import type { TenantAccess } from '../tenant-access.js';
import {
  createInboxRuleBodyOpenApiSchema,
  createInboxRuleRequestSchema,
  inboxRuleIdentifierSchema,
  inboxRuleListOpenApiSchema,
  inboxRuleListResponseSchema,
  inboxRuleOpenApiSchema,
  inboxRuleSchema,
  orderInboxRulesBodyOpenApiSchema,
  orderInboxRulesRequestSchema,
  updateInboxRuleBodyOpenApiSchema,
  updateInboxRuleRequestSchema,
} from './contract.js';
import type {
  CreateInboxRuleRequest,
  InboxRule,
  InboxRuleListResponse,
  OrderInboxRulesRequest,
  UpdateInboxRuleRequest,
} from './contract.js';
import { RuleLimitError } from './inbox-repository.js';
import { InboxService } from './inbox.service.js';
import { isInvoiceAutoRoute } from './rules.js';

export function refuseInvoiceAutoRoute(rule: {
  autoRoute: boolean;
  setDocumentKind: string | null;
}): void {
  if (isInvoiceAutoRoute(rule)) {
    throw new UnprocessableEntityException('not_available');
  }
}

const unauthorized = { description: 'The resource token is invalid' };
const forbidden = { description: 'Organization access is denied' };
const ruleNotFound = {
  description: 'The rule, the legal entity or the partner is not visible',
};

// Every rule route needs manageDocuments; a channel subject is refused by the tenant resolver like every non-intake route.
@ApiBearerAuth('resource-token')
@Controller({ path: 'organizations', version: '1' })
export class InboxRulesController {
  constructor(
    @Inject(InboxService) private readonly inbox: InboxService,
    @Inject(MembershipResolver)
    private readonly memberships: MembershipResolver,
  ) {}

  @Get(':organizationId/inbox/rules')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({ summary: 'List the live rules in priority order' })
  @ApiOkResponse({ schema: inboxRuleListOpenApiSchema })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  async listRules(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<InboxRuleListResponse> {
    const { tenant } = await this.manage(organizationId, request);

    return inboxRuleListResponseSchema.parse({
      rules: await this.inbox.listRules(tenant),
    });
  }

  @Post(':organizationId/inbox/rules')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({ summary: 'Create a rule at the lowest priority' })
  @ApiBody({ schema: createInboxRuleBodyOpenApiSchema })
  @ApiCreatedResponse({ schema: inboxRuleOpenApiSchema })
  @ApiBadRequestResponse({ description: 'The rule is unusable' })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  @ApiNotFoundResponse(ruleNotFound)
  @ApiUnprocessableEntityResponse({
    description:
      'The enabled rule limit is reached, or an invoice kind cannot auto-route',
  })
  @ApiServiceUnavailableResponse({
    description: 'The rerun on existing items could not be queued',
  })
  async createRule(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Body({ schema: createInboxRuleRequestSchema })
    body: CreateInboxRuleRequest,
    @Req() request: AuthenticatedRequest,
  ): Promise<InboxRule> {
    const { entityScope, tenant } = await this.manage(organizationId, request);
    refuseInvoiceAutoRoute(body);

    return this.rule(
      this.inbox.createRule({
        ...tenant,
        body,
        legalEntityIds: allowedEntityIds(entityScope),
      }),
    );
  }

  @Patch(':organizationId/inbox/rules/:ruleId')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({ summary: 'Change a rule; the author never changes here' })
  @ApiBody({ schema: updateInboxRuleBodyOpenApiSchema })
  @ApiOkResponse({ schema: inboxRuleOpenApiSchema })
  @ApiBadRequestResponse({ description: 'The merged rule is unusable' })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  @ApiNotFoundResponse(ruleNotFound)
  @ApiUnprocessableEntityResponse({
    description: 'An invoice kind cannot auto-route',
  })
  async updateRule(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('ruleId', { schema: inboxRuleIdentifierSchema }) ruleId: string,
    @Body({ schema: updateInboxRuleRequestSchema })
    body: UpdateInboxRuleRequest,
    @Req() request: AuthenticatedRequest,
  ): Promise<InboxRule> {
    const { entityScope, tenant } = await this.manage(organizationId, request);

    // The patch alone is refused here; the service refuses the merged row against the stored rule.
    refuseInvoiceAutoRoute({
      autoRoute: body.autoRoute ?? false,
      setDocumentKind: body.setDocumentKind ?? null,
    });

    return this.rule(
      this.inbox.updateRule({
        ...tenant,
        body,
        legalEntityIds: allowedEntityIds(entityScope),
        ruleId,
      }),
    );
  }

  @Delete(':organizationId/inbox/rules/:ruleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({
    summary: 'Soft delete a rule; the row stays for the items it decided',
  })
  @ApiNoContentResponse({ description: 'The rule is deleted' })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  @ApiNotFoundResponse({ description: 'The rule is not visible' })
  async deleteRule(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('ruleId', { schema: inboxRuleIdentifierSchema }) ruleId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    const { tenant } = await this.manage(organizationId, request);

    if (!(await this.inbox.deleteRule({ ...tenant, ruleId }))) {
      throw new NotFoundException();
    }
  }

  @Put(':organizationId/inbox/rules/order')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({
    summary: 'Set the priority of every live rule in one transaction',
  })
  @ApiBody({ schema: orderInboxRulesBodyOpenApiSchema })
  @ApiOkResponse({ schema: inboxRuleListOpenApiSchema })
  @ApiBadRequestResponse({
    description: 'The list does not name every live rule exactly once',
  })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  async orderRules(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Body({ schema: orderInboxRulesRequestSchema })
    body: OrderInboxRulesRequest,
    @Req() request: AuthenticatedRequest,
  ): Promise<InboxRuleListResponse> {
    const { tenant } = await this.manage(organizationId, request);

    return inboxRuleListResponseSchema.parse({
      rules: await this.inbox.orderRules({ ...tenant, ruleIds: body.ruleIds }),
    });
  }

  @Post(':organizationId/inbox/rules/:ruleId/adopt')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({ summary: 'Become the author the rule runs as' })
  @ApiOkResponse({ schema: inboxRuleOpenApiSchema })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  @ApiNotFoundResponse({ description: 'The rule is not visible' })
  async adoptRule(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('ruleId', { schema: inboxRuleIdentifierSchema }) ruleId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<InboxRule> {
    const { tenant } = await this.manage(organizationId, request);

    return this.rule(this.inbox.adoptRule({ ...tenant, ruleId }));
  }

  // Null is a rule, an entity or a partner the caller cannot see; a refused value is bad input.
  private async rule(pending: Promise<InboxRule | null>): Promise<InboxRule> {
    let rule: InboxRule | null;

    try {
      rule = await pending;
    } catch (error) {
      if (error instanceof RuleLimitError) {
        throw new UnprocessableEntityException('rule_limit');
      }

      if (isRejectedValue(error)) {
        throw new BadRequestException();
      }

      throw error;
    }

    if (rule === null) {
      throw new NotFoundException();
    }

    return inboxRuleSchema.parse(rule);
  }

  private manage(
    organizationId: string,
    request: AuthenticatedRequest,
  ): Promise<TenantAccess> {
    return resolveTenantAccess({
      capability: 'manageDocuments',
      memberships: this.memberships,
      organizationId,
      request,
    });
  }
}
