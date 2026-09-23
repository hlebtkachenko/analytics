import {
  BadRequestException,
  Body,
  ConflictException,
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
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  legalEntityInScope,
  organizationIdentifierSchema,
} from '@bap/security';

import { MembershipResolver } from '../membership-resolver.js';
import type { AuthenticatedRequest } from '../request-context.js';
import { ResourceJwtGuard } from '../resource-jwt.guard.js';
import { SubjectRateLimitGuard } from '../subject-rate-limit.guard.js';
import { allowedEntityIds, resolveTenantAccess } from '../tenant-access.js';
import {
  createDocumentBodyOpenApiSchema,
  createDocumentLinkBodyOpenApiSchema,
  createDocumentLinkRequestSchema,
  createDocumentRequestSchema,
  directiveAccountListOpenApiSchema,
  directiveAccountListResponseSchema,
  documentAnalyticsOpenApiSchema,
  documentAnalyticsQuerySchema,
  documentAnalyticsResponseSchema,
  documentDetailOpenApiSchema,
  documentDetailSchema,
  documentIdentifierSchema,
  documentLinkIdentifierSchema,
  documentLinkOpenApiSchema,
  documentLinkSchema,
  documentListOpenApiSchema,
  documentListQuerySchema,
  documentListResponseSchema,
  updateDocumentBodyOpenApiSchema,
  updateDocumentRequestSchema,
} from './contract.js';
import type {
  CreateDocumentLinkRequest,
  CreateDocumentRequest,
  DirectiveAccountListResponse,
  DocumentAnalyticsQuery,
  DocumentAnalyticsResponse,
  DocumentDetail,
  DocumentLink,
  DocumentListQuery,
  DocumentListResponse,
  UpdateDocumentRequest,
} from './contract.js';
import {
  DocumentRepository,
  isDuplicateDocumentLink,
  isDuplicateDocumentReference,
} from './document-repository.js';
import { isRejectedValue } from './sql.js';

@ApiBearerAuth('resource-token')
@Controller({ path: 'organizations', version: '1' })
export class DocumentController {
  constructor(
    @Inject(DocumentRepository)
    private readonly documents: DocumentRepository,
    @Inject(MembershipResolver)
    private readonly memberships: MembershipResolver,
  ) {}

  @Post(':organizationId/documents')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({
    summary: 'Register a document and derive its economic event',
  })
  @ApiBody({ schema: createDocumentBodyOpenApiSchema })
  @ApiCreatedResponse({ schema: documentDetailOpenApiSchema })
  @ApiUnauthorizedResponse({ description: 'The resource token is invalid' })
  @ApiForbiddenResponse({ description: 'Organization access is denied' })
  @ApiNotFoundResponse({ description: 'The legal entity is not visible' })
  @ApiConflictResponse({ description: 'The reference is already used' })
  async createDocument(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Body({ schema: createDocumentRequestSchema })
    body: CreateDocumentRequest,
    @Req() request: AuthenticatedRequest,
  ): Promise<DocumentDetail> {
    const { entityScope, tenant } = await resolveTenantAccess({
      capability: 'manageDocuments',
      memberships: this.memberships,
      organizationId,
      request,
    });

    try {
      const created = await this.documents.createDocument({
        ...tenant,
        body,
        legalEntityIds: allowedEntityIds(entityScope),
      });

      // An entity outside the scope answers exactly like a missing one, so the caller learns nothing.
      if (created === null) {
        throw new NotFoundException();
      }

      return documentDetailSchema.parse(created);
    } catch (error) {
      if (isDuplicateDocumentReference(error)) {
        throw new ConflictException();
      }

      // A value the database refused is bad input, never a server fault.
      if (isRejectedValue(error)) {
        throw new BadRequestException();
      }

      throw error;
    }
  }

  @Post(':organizationId/documents/:documentId/links')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({ summary: 'Link this document to another one' })
  @ApiBody({ schema: createDocumentLinkBodyOpenApiSchema })
  @ApiCreatedResponse({ schema: documentLinkOpenApiSchema })
  @ApiUnauthorizedResponse({ description: 'The resource token is invalid' })
  @ApiForbiddenResponse({ description: 'Organization access is denied' })
  @ApiNotFoundResponse({ description: 'One of the documents is not visible' })
  @ApiConflictResponse({ description: 'The link already exists' })
  async createDocumentLink(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('documentId', { schema: documentIdentifierSchema })
    documentId: string,
    @Body({ schema: createDocumentLinkRequestSchema })
    body: CreateDocumentLinkRequest,
    @Req() request: AuthenticatedRequest,
  ): Promise<DocumentLink> {
    const { entityScope, tenant } = await resolveTenantAccess({
      capability: 'manageDocuments',
      memberships: this.memberships,
      organizationId,
      request,
    });

    try {
      const created = await this.documents.createLink({
        ...tenant,
        documentId,
        kind: body.kind,
        legalEntityIds: allowedEntityIds(entityScope),
        toDocumentId: body.toDocumentId,
      });

      if (created === null) {
        throw new NotFoundException();
      }

      return documentLinkSchema.parse(created);
    } catch (error) {
      if (isDuplicateDocumentLink(error)) {
        throw new ConflictException();
      }

      if (isRejectedValue(error)) {
        throw new BadRequestException();
      }

      throw error;
    }
  }

  @Delete(':organizationId/documents/:documentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({ summary: 'Delete a document and everything derived from it' })
  @ApiNoContentResponse({ description: 'The document was deleted' })
  @ApiUnauthorizedResponse({ description: 'The resource token is invalid' })
  @ApiForbiddenResponse({ description: 'Organization access is denied' })
  @ApiNotFoundResponse({ description: 'The document is not visible' })
  @ApiConflictResponse({
    description: 'A later version supersedes the document (not_current)',
  })
  async deleteDocument(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('documentId', { schema: documentIdentifierSchema })
    documentId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    const { entityScope, tenant } = await resolveTenantAccess({
      capability: 'manageDocuments',
      memberships: this.memberships,
      organizationId,
      request,
    });
    const deleted = await this.documents.deleteDocument({
      ...tenant,
      documentId,
      legalEntityIds: allowedEntityIds(entityScope),
    });

    if (!deleted) {
      throw new NotFoundException();
    }
  }

  @Delete(':organizationId/documents/:documentId/links/:linkId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({ summary: 'Remove a link this document owns' })
  @ApiNoContentResponse({ description: 'The link was removed' })
  @ApiUnauthorizedResponse({ description: 'The resource token is invalid' })
  @ApiForbiddenResponse({ description: 'Organization access is denied' })
  @ApiNotFoundResponse({ description: 'The link is not visible' })
  async deleteDocumentLink(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('documentId', { schema: documentIdentifierSchema })
    documentId: string,
    @Param('linkId', { schema: documentLinkIdentifierSchema })
    linkId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    const { entityScope, tenant } = await resolveTenantAccess({
      capability: 'manageDocuments',
      memberships: this.memberships,
      organizationId,
      request,
    });
    const deleted = await this.documents.deleteLink({
      ...tenant,
      documentId,
      legalEntityIds: allowedEntityIds(entityScope),
      linkId,
    });

    if (!deleted) {
      throw new NotFoundException();
    }
  }

  // Declared before the document detail route so 'analytics' is never matched as a document identifier.
  @Get(':organizationId/documents/analytics')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({
    summary: 'Read the stored document aggregates for the caller scope',
  })
  @ApiOkResponse({ schema: documentAnalyticsOpenApiSchema })
  @ApiUnauthorizedResponse({ description: 'The resource token is invalid' })
  @ApiForbiddenResponse({ description: 'Organization access is denied' })
  async getAnalytics(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Query({ schema: documentAnalyticsQuerySchema })
    query: DocumentAnalyticsQuery,
    @Req() request: AuthenticatedRequest,
  ): Promise<DocumentAnalyticsResponse> {
    const { entityScope, tenant } = await resolveTenantAccess({
      capability: 'readDocuments',
      memberships: this.memberships,
      organizationId,
      request,
    });
    const requested = query.legalEntityId;
    // A requested entity outside the scope narrows the read to nothing instead of widening it.
    const legalEntityIds =
      requested === undefined
        ? allowedEntityIds(entityScope)
        : requested.every((id) => legalEntityInScope(entityScope, id))
          ? [...requested]
          : [];
    const analytics = await this.documents.readAnalytics({
      ...tenant,
      legalEntityIds,
    });

    return documentAnalyticsResponseSchema.parse(analytics);
  }

  @Get(':organizationId/directive-accounts')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({ summary: 'Read the shared directive chart of accounts' })
  @ApiOkResponse({ schema: directiveAccountListOpenApiSchema })
  @ApiUnauthorizedResponse({ description: 'The resource token is invalid' })
  @ApiForbiddenResponse({ description: 'Organization access is denied' })
  async getDirectiveAccounts(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<DirectiveAccountListResponse> {
    const { tenant } = await resolveTenantAccess({
      capability: 'readDocuments',
      memberships: this.memberships,
      organizationId,
      request,
    });
    const directiveAccounts =
      await this.documents.listDirectiveAccounts(tenant);

    return directiveAccountListResponseSchema.parse({ directiveAccounts });
  }

  @Get(':organizationId/documents/:documentId')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({ summary: 'Read one document with its content and event' })
  @ApiOkResponse({ schema: documentDetailOpenApiSchema })
  @ApiUnauthorizedResponse({ description: 'The resource token is invalid' })
  @ApiForbiddenResponse({ description: 'Organization access is denied' })
  @ApiNotFoundResponse({ description: 'The document is not visible' })
  async getDocument(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('documentId', { schema: documentIdentifierSchema })
    documentId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<DocumentDetail> {
    const { entityScope, tenant } = await resolveTenantAccess({
      capability: 'readDocuments',
      memberships: this.memberships,
      organizationId,
      request,
    });
    const detail = await this.documents.readDocument({
      ...tenant,
      documentId,
      legalEntityIds: allowedEntityIds(entityScope),
    });

    if (detail === null) {
      throw new NotFoundException();
    }

    return documentDetailSchema.parse(detail);
  }

  @Get(':organizationId/documents')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({ summary: 'List the documents in the caller scope' })
  @ApiOkResponse({ schema: documentListOpenApiSchema })
  @ApiUnauthorizedResponse({ description: 'The resource token is invalid' })
  @ApiForbiddenResponse({ description: 'Organization access is denied' })
  async listDocuments(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Query({ schema: documentListQuerySchema }) query: DocumentListQuery,
    @Req() request: AuthenticatedRequest,
  ): Promise<DocumentListResponse> {
    const { entityScope, tenant } = await resolveTenantAccess({
      capability: 'readDocuments',
      memberships: this.memberships,
      organizationId,
      request,
    });
    // A requested entity outside the scope narrows the list to nothing instead of widening it.
    const legalEntityIds =
      query.legalEntityId === undefined ||
      query.legalEntityId.every((id) => legalEntityInScope(entityScope, id))
        ? allowedEntityIds(entityScope)
        : [];
    const page = await this.documents.listDocuments({
      ...tenant,
      legalEntityIds,
      query,
    });

    return documentListResponseSchema.parse(page);
  }

  @Patch(':organizationId/documents/:documentId')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({ summary: 'Change the register fields or the status' })
  @ApiBody({ schema: updateDocumentBodyOpenApiSchema })
  @ApiOkResponse({ schema: documentDetailOpenApiSchema })
  @ApiUnauthorizedResponse({ description: 'The resource token is invalid' })
  @ApiForbiddenResponse({ description: 'Organization access is denied' })
  @ApiNotFoundResponse({ description: 'The document is not visible' })
  @ApiConflictResponse({ description: 'The reference is already used' })
  async updateDocument(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('documentId', { schema: documentIdentifierSchema })
    documentId: string,
    @Body({ schema: updateDocumentRequestSchema })
    body: UpdateDocumentRequest,
    @Req() request: AuthenticatedRequest,
  ): Promise<DocumentDetail> {
    const { entityScope, tenant } = await resolveTenantAccess({
      capability: 'manageDocuments',
      memberships: this.memberships,
      organizationId,
      request,
    });

    try {
      const updated = await this.documents.updateDocument({
        ...tenant,
        body,
        documentId,
        legalEntityIds: allowedEntityIds(entityScope),
      });

      if (updated === null) {
        throw new NotFoundException();
      }

      return documentDetailSchema.parse(updated);
    } catch (error) {
      if (isDuplicateDocumentReference(error)) {
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
