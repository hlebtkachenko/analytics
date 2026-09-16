import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
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
  Res,
  StreamableFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { MulterModuleOptions } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiUnauthorizedResponse,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import { organizationIdentifierSchema } from '@bap/security';
import { join } from 'node:path';

import { BlobStore } from '../blobs/blob-store.js';
import { isDuplicateDocumentReference } from '../documents/document-repository.js';
import { isRejectedValue } from '../documents/sql.js';
import { MAX_UPLOAD_BYTES } from '../ingestion/contract.js';
import { MembershipResolver } from '../membership-resolver.js';
import type { AuthenticatedRequest, HttpResponse } from '../request-context.js';
import { ResourceJwtGuard } from '../resource-jwt.guard.js';
import { loadRuntimeConfiguration } from '../runtime-configuration.js';
import { SubjectRateLimitGuard } from '../subject-rate-limit.guard.js';
import { allowedEntityIds, resolveTenantAccess } from '../tenant-access.js';
import type { TenantAccess } from '../tenant-access.js';
import {
  assignInboxItemBodyOpenApiSchema,
  assignInboxItemRequestSchema,
  blobIdentifierSchema,
  contentDispositionFilename,
  discardInboxItemBodyOpenApiSchema,
  discardInboxItemRequestSchema,
  inboxItemDetailOpenApiSchema,
  inboxItemDetailSchema,
  inboxItemIdentifierSchema,
  inboxItemListOpenApiSchema,
  inboxItemListQuerySchema,
  inboxItemListResponseSchema,
  inboxUploadResponseOpenApiSchema,
  inboxUploadResponseSchema,
  INLINE_MEDIA_TYPES,
  routeInboxItemToDocumentBodyOpenApiSchema,
  routeInboxItemToDocumentRequestSchema,
  snoozeInboxItemBodyOpenApiSchema,
  snoozeInboxItemRequestSchema,
  updateInboxHintsBodyOpenApiSchema,
  updateInboxHintsRequestSchema,
} from './contract.js';
import type {
  AssignInboxItemRequest,
  DiscardInboxItemRequest,
  InboxItemDetail,
  InboxItemListQuery,
  InboxItemListResponse,
  InboxUploadResponse,
  RouteInboxItemToDocumentRequest,
  SnoozeInboxItemRequest,
  UpdateInboxHintsRequest,
} from './contract.js';
import { InboxService } from './inbox.service.js';

// Unlike the dataset upload, the file is accepted whatever it claims to be: the sniff decides, never the client.
const multerOptions: MulterModuleOptions = {
  // Browsers send unencoded multipart filenames as UTF-8, but busboy defaults to latin1.
  defParamCharset: 'utf8',
  limits: {
    fields: 0,
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
    headerPairs: 32,
  },
};

const binaryDownloadSchema = { format: 'binary', type: 'string' };

const unauthorized = { description: 'The resource token is invalid' };
const forbidden = { description: 'Organization access is denied' };
const notFound = { description: 'The item is not visible' };

@ApiBearerAuth('resource-token')
@Controller({ path: 'organizations', version: '1' })
export class InboxController {
  constructor(
    @Inject(InboxService) private readonly inbox: InboxService,
    @Inject(BlobStore) private readonly blobs: BlobStore,
    @Inject(MembershipResolver)
    private readonly memberships: MembershipResolver,
  ) {}

  @Post(':organizationId/inbox/uploads')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      ...multerOptions,
      // Resolved per request so the mounted volume, not module load order, decides it.
      dest: (
        _request: unknown,
        _file: unknown,
        callback: (error: Error | null, destination: string) => void,
      ): void => {
        callback(
          null,
          join(
            loadRuntimeConfiguration(process.env).blob.storageDirectory,
            'tmp',
          ),
        );
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Receive one file into the inbox' })
  @ApiBody({
    schema: {
      properties: { file: { format: 'binary', type: 'string' } },
      required: ['file'],
      type: 'object',
    },
  })
  @ApiCreatedResponse({ schema: inboxUploadResponseOpenApiSchema })
  @ApiBadRequestResponse({ description: 'The file part is unusable' })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  @ApiPayloadTooLargeResponse({
    description: 'The upload exceeds 25 MB or the organization quota',
  })
  async createUpload(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<InboxUploadResponse> {
    let access: TenantAccess;

    try {
      access = await this.manage(organizationId, request);
    } catch (error) {
      // The guard chain ran before multer wrote nothing; a refused caller leaves no file behind.
      if (request.file?.path !== undefined) {
        await this.blobs.deleteTemporary(request.file.path);
      }

      throw error;
    }

    const received = await this.inbox.upload({
      ...access.tenant,
      file: request.file,
      legalEntityIds: allowedEntityIds(access.entityScope),
    });

    return inboxUploadResponseSchema.parse(received);
  }

  @Get(':organizationId/inbox/items')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({ summary: 'List the inbox items in the caller scope' })
  @ApiOkResponse({ schema: inboxItemListOpenApiSchema })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  async listItems(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Query({ schema: inboxItemListQuerySchema }) query: InboxItemListQuery,
    @Req() request: AuthenticatedRequest,
  ): Promise<InboxItemListResponse> {
    const { entityScope, tenant } = await this.read(organizationId, request);
    const page = await this.inbox.listItems({
      ...tenant,
      legalEntityIds: allowedEntityIds(entityScope),
      query,
    });

    return inboxItemListResponseSchema.parse(page);
  }

  @Get(':organizationId/inbox/items/:itemId')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({
    summary: 'Read one item with its files, latest extraction and events',
  })
  @ApiOkResponse({ schema: inboxItemDetailOpenApiSchema })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  @ApiNotFoundResponse(notFound)
  async getItem(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('itemId', { schema: inboxItemIdentifierSchema }) itemId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<InboxItemDetail> {
    const { entityScope, tenant } = await this.read(organizationId, request);

    return this.detail(
      this.inbox.readItem({
        ...tenant,
        itemId,
        legalEntityIds: allowedEntityIds(entityScope),
      }),
    );
  }

  @Patch(':organizationId/inbox/items/:itemId/hints')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({ summary: 'Set or clear the hints a person gives the item' })
  @ApiBody({ schema: updateInboxHintsBodyOpenApiSchema })
  @ApiOkResponse({ schema: inboxItemDetailOpenApiSchema })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  @ApiNotFoundResponse(notFound)
  async updateHints(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('itemId', { schema: inboxItemIdentifierSchema }) itemId: string,
    @Body({ schema: updateInboxHintsRequestSchema })
    body: UpdateInboxHintsRequest,
    @Req() request: AuthenticatedRequest,
  ): Promise<InboxItemDetail> {
    const { entityScope, tenant } = await this.manage(organizationId, request);

    return this.detail(
      this.inbox.updateHints({
        ...tenant,
        body,
        itemId,
        legalEntityIds: allowedEntityIds(entityScope),
      }),
    );
  }

  @Post(':organizationId/inbox/items/:itemId/process')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({ summary: 'Run the providers again with the stored hints' })
  @ApiOkResponse({ schema: inboxItemDetailOpenApiSchema })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  @ApiNotFoundResponse(notFound)
  @ApiConflictResponse({ description: 'The item is already routed' })
  async processItem(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('itemId', { schema: inboxItemIdentifierSchema }) itemId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<InboxItemDetail> {
    const { entityScope, tenant } = await this.manage(organizationId, request);

    return this.detail(
      this.inbox.process({
        ...tenant,
        itemId,
        legalEntityIds: allowedEntityIds(entityScope),
      }),
    );
  }

  @Post(':organizationId/inbox/items/:itemId/route/document')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({ summary: 'Register a document from the item' })
  @ApiBody({ schema: routeInboxItemToDocumentBodyOpenApiSchema })
  @ApiOkResponse({ schema: inboxItemDetailOpenApiSchema })
  @ApiBadRequestResponse({
    description: 'The draft or the file order is unusable',
  })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  @ApiNotFoundResponse({ description: 'The item or the entity is not visible' })
  @ApiConflictResponse({
    description: 'The item is not open or the reference is already used',
  })
  async routeToDocument(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('itemId', { schema: inboxItemIdentifierSchema }) itemId: string,
    @Body({ schema: routeInboxItemToDocumentRequestSchema })
    body: RouteInboxItemToDocumentRequest,
    @Req() request: AuthenticatedRequest,
  ): Promise<InboxItemDetail> {
    const { entityScope, tenant } = await this.manage(organizationId, request);

    try {
      return await this.detail(
        this.inbox.routeToDocument({
          ...tenant,
          body,
          itemId,
          legalEntityIds: allowedEntityIds(entityScope),
        }),
      );
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

  @Post(':organizationId/inbox/items/:itemId/route/undo')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({ summary: 'Delete the routed document and reopen the item' })
  @ApiOkResponse({ schema: inboxItemDetailOpenApiSchema })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  @ApiNotFoundResponse(notFound)
  @ApiConflictResponse({ description: 'The item is not routed' })
  async undoRoute(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('itemId', { schema: inboxItemIdentifierSchema }) itemId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<InboxItemDetail> {
    const { entityScope, tenant } = await this.manage(organizationId, request);

    return this.detail(
      this.inbox.undoRoute({
        ...tenant,
        itemId,
        legalEntityIds: allowedEntityIds(entityScope),
      }),
    );
  }

  @Post(':organizationId/inbox/items/:itemId/discard')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({ summary: 'Discard the item with a reason; reversible' })
  @ApiBody({ schema: discardInboxItemBodyOpenApiSchema })
  @ApiOkResponse({ schema: inboxItemDetailOpenApiSchema })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  @ApiNotFoundResponse(notFound)
  @ApiConflictResponse({ description: 'The item is routed or discarded' })
  async discardItem(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('itemId', { schema: inboxItemIdentifierSchema }) itemId: string,
    @Body({ schema: discardInboxItemRequestSchema })
    body: DiscardInboxItemRequest,
    @Req() request: AuthenticatedRequest,
  ): Promise<InboxItemDetail> {
    const { entityScope, tenant } = await this.manage(organizationId, request);

    return this.detail(
      this.inbox.discardItem({
        ...tenant,
        itemId,
        legalEntityIds: allowedEntityIds(entityScope),
        reason: body.reason,
      }),
    );
  }

  @Post(':organizationId/inbox/items/:itemId/restore')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({ summary: 'Bring a discarded item back to review' })
  @ApiOkResponse({ schema: inboxItemDetailOpenApiSchema })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  @ApiNotFoundResponse(notFound)
  @ApiConflictResponse({ description: 'The item is not discarded' })
  async restoreItem(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('itemId', { schema: inboxItemIdentifierSchema }) itemId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<InboxItemDetail> {
    const { entityScope, tenant } = await this.manage(organizationId, request);

    return this.detail(
      this.inbox.restoreItem({
        ...tenant,
        itemId,
        legalEntityIds: allowedEntityIds(entityScope),
      }),
    );
  }

  @Post(':organizationId/inbox/items/:itemId/assign')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({ summary: 'Assign the item to a member or clear it' })
  @ApiBody({ schema: assignInboxItemBodyOpenApiSchema })
  @ApiOkResponse({ schema: inboxItemDetailOpenApiSchema })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  @ApiNotFoundResponse(notFound)
  async assignItem(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('itemId', { schema: inboxItemIdentifierSchema }) itemId: string,
    @Body({ schema: assignInboxItemRequestSchema })
    body: AssignInboxItemRequest,
    @Req() request: AuthenticatedRequest,
  ): Promise<InboxItemDetail> {
    const { entityScope, tenant } = await this.manage(organizationId, request);

    return this.detail(
      this.inbox.assignItem({
        ...tenant,
        assigneeId: body.assigneeId,
        itemId,
        legalEntityIds: allowedEntityIds(entityScope),
      }),
    );
  }

  @Post(':organizationId/inbox/items/:itemId/snooze')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({ summary: 'Snooze the item until a moment or clear it' })
  @ApiBody({ schema: snoozeInboxItemBodyOpenApiSchema })
  @ApiOkResponse({ schema: inboxItemDetailOpenApiSchema })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  @ApiNotFoundResponse(notFound)
  async snoozeItem(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('itemId', { schema: inboxItemIdentifierSchema }) itemId: string,
    @Body({ schema: snoozeInboxItemRequestSchema })
    body: SnoozeInboxItemRequest,
    @Req() request: AuthenticatedRequest,
  ): Promise<InboxItemDetail> {
    const { entityScope, tenant } = await this.manage(organizationId, request);

    return this.detail(
      this.inbox.snoozeItem({
        ...tenant,
        itemId,
        legalEntityIds: allowedEntityIds(entityScope),
        snoozedUntil: body.snoozedUntil,
      }),
    );
  }

  @Get(':organizationId/inbox/blobs/:blobId/download')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({ summary: 'Download the original bytes as an attachment' })
  @ApiOkResponse({
    content: { 'application/octet-stream': { schema: binaryDownloadSchema } },
    description: 'The stored bytes, streamed with their sniffed media type',
  })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  @ApiNotFoundResponse({ description: 'The blob is not visible' })
  async downloadBlob(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('blobId', { schema: blobIdentifierSchema }) blobId: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: HttpResponse,
  ): Promise<StreamableFile> {
    return this.streamBlob(organizationId, blobId, request, response, false);
  }

  @Get(':organizationId/inbox/blobs/:blobId/inline')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({
    summary: 'Render a PDF or an image inline inside a sandboxed frame',
  })
  @ApiOkResponse({
    content: Object.fromEntries(
      INLINE_MEDIA_TYPES.map((type) => [
        type,
        { schema: binaryDownloadSchema },
      ]),
    ),
    description: 'The stored bytes, streamed for inline display',
  })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  @ApiNotFoundResponse({ description: 'The blob is not visible' })
  @ApiUnsupportedMediaTypeResponse({
    description: 'Only PDF, PNG, JPEG and WebP render inline',
  })
  async inlineBlob(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('blobId', { schema: blobIdentifierSchema }) blobId: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: HttpResponse,
  ): Promise<StreamableFile> {
    return this.streamBlob(organizationId, blobId, request, response, true);
  }

  private async streamBlob(
    organizationId: string,
    blobId: string,
    request: AuthenticatedRequest,
    response: HttpResponse,
    inline: boolean,
  ): Promise<StreamableFile> {
    const { entityScope, tenant } = await this.read(organizationId, request);
    const { blob, stream } = await this.inbox.openBlob({
      ...tenant,
      blobId,
      inline,
      legalEntityIds: allowedEntityIds(entityScope),
    });
    const filename = contentDispositionFilename(
      blob.originalFilename,
      blob.sha256,
    );

    response.setHeader('X-Content-Type-Options', 'nosniff');

    if (inline) {
      // The frame is sandboxed twice: here by the header, in the browser by the iframe attribute.
      response.setHeader('Content-Security-Policy', 'sandbox');
    }

    return new StreamableFile(stream, {
      disposition: `${inline ? 'inline' : 'attachment'}; filename="${filename}"`,
      length: blob.byteSize,
      type: blob.mediaType,
    });
  }

  private async detail(
    pending: Promise<InboxItemDetail | null>,
  ): Promise<InboxItemDetail> {
    const detail = await pending;

    if (detail === null) {
      throw new NotFoundException();
    }

    return inboxItemDetailSchema.parse(detail);
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

  private read(
    organizationId: string,
    request: AuthenticatedRequest,
  ): Promise<TenantAccess> {
    return resolveTenantAccess({
      capability: 'readDocuments',
      memberships: this.memberships,
      organizationId,
      request,
    });
  }
}
