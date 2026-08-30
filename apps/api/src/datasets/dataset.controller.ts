import { PassThrough } from 'node:stream';

import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
  Req,
  StreamableFile,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  organizationIdentifierSchema,
  resolveOrganizationAccess,
} from '@bap/security';

import { datasetIdentifierSchema } from '../agents/contract.js';
import { MembershipResolver } from '../membership-resolver.js';
import type { AuthenticatedRequest } from '../request-context.js';
import { ResourceJwtGuard } from '../resource-jwt.guard.js';
import { SubjectRateLimitGuard } from '../subject-rate-limit.guard.js';
import {
  DATASET_EXPORT_BATCH_SIZE,
  DATASET_EXPORT_MEDIA_TYPES,
  datasetExportFilename,
  datasetExportQuerySchema,
  datasetListResponseSchema,
  datasetRowPageResponseSchema,
  datasetRowQuerySchema,
  DEFAULT_DATASET_ROW_PAGE_SIZE,
  MAX_DATASET_LIST_SIZE,
  MAX_DATASET_ROW_PAGE_SIZE,
} from './contract.js';
import type {
  DatasetExportQuery,
  DatasetListResponse,
  DatasetRowPageResponse,
  DatasetRowQuery,
} from './contract.js';
import { DatasetRepository } from './dataset-repository.js';
import type { TenantSelector } from './dataset-repository.js';
import { writeDatasetExport } from './export.js';

const datasetSummarySchema = {
  additionalProperties: false,
  properties: {
    createdAt: { format: 'date-time', type: 'string' },
    description: { nullable: true, type: 'string' },
    id: { format: 'uuid', type: 'string' },
    name: { type: 'string' },
    rowCount: { minimum: 0, type: 'integer' },
    status: { enum: ['importing', 'ready', 'failed'], type: 'string' },
    updatedAt: { format: 'date-time', type: 'string' },
  },
  required: [
    'createdAt',
    'description',
    'id',
    'name',
    'rowCount',
    'status',
    'updatedAt',
  ],
  type: 'object',
};

const datasetColumnSchema = {
  additionalProperties: false,
  properties: {
    inferredType: { type: 'string' },
    name: { type: 'string' },
    position: { minimum: 0, type: 'integer' },
  },
  required: ['inferredType', 'name', 'position'],
  type: 'object',
};

const datasetRowSchema = {
  additionalProperties: false,
  properties: {
    // Column names come from the dataset, so this map stays open; every value is a JSON scalar or null.
    data: { additionalProperties: true, type: 'object' },
    rowNumber: { minimum: 0, type: 'integer' },
  },
  required: ['data', 'rowNumber'],
  type: 'object',
};

const binaryDownloadSchema = { format: 'binary', type: 'string' };

@ApiBearerAuth('resource-token')
@Controller({ path: 'organizations', version: '1' })
export class DatasetController {
  constructor(
    @Inject(DatasetRepository) private readonly datasets: DatasetRepository,
    @Inject(MembershipResolver)
    private readonly memberships: MembershipResolver,
  ) {}

  @Get(':organizationId/datasets/:datasetId/export')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({ summary: 'Stream a dataset as a CSV or XLSX download' })
  @ApiQuery({
    name: 'format',
    required: true,
    schema: { enum: ['csv', 'xlsx'], type: 'string' },
  })
  @ApiOkResponse({
    content: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
        schema: binaryDownloadSchema,
      },
      'text/csv': { schema: binaryDownloadSchema },
    },
    description: 'The dataset streamed in the requested format',
  })
  @ApiUnauthorizedResponse({ description: 'The resource token is invalid' })
  @ApiForbiddenResponse({ description: 'Organization access is denied' })
  @ApiNotFoundResponse({ description: 'The dataset is not visible' })
  async exportDataset(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('datasetId', { schema: datasetIdentifierSchema })
    datasetId: string,
    @Query({ schema: datasetExportQuerySchema }) query: DatasetExportQuery,
    @Req() request: AuthenticatedRequest,
  ): Promise<StreamableFile> {
    const tenant = await this.resolveTenant(request, organizationId);
    const columns = await this.datasets.readColumns({ ...tenant, datasetId });

    if (columns === null) {
      throw new NotFoundException();
    }

    const output = new PassThrough();
    const source = {
      batches: this.datasets.streamRows({
        ...tenant,
        batchSize: DATASET_EXPORT_BATCH_SIZE,
        datasetId,
      }),
      columns,
    };
    // Not awaited: the response is what drains the stream, so awaiting the writer here would deadlock.
    void writeDatasetExport(output, query.format, source).catch(
      (error: unknown) => {
        output.destroy(
          error instanceof Error ? error : new Error('The export failed.'),
        );
      },
    );

    return new StreamableFile(output, {
      disposition: `attachment; filename="${datasetExportFilename(datasetId, query.format)}"`,
      type: DATASET_EXPORT_MEDIA_TYPES[query.format],
    });
  }

  @Get(':organizationId/datasets/:datasetId/rows')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({ summary: 'Read one keyset page of dataset rows' })
  @ApiQuery({
    description: 'The row_number the page starts after',
    name: 'after',
    required: false,
    schema: { minimum: 0, type: 'integer' },
  })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    schema: {
      default: DEFAULT_DATASET_ROW_PAGE_SIZE,
      maximum: MAX_DATASET_ROW_PAGE_SIZE,
      minimum: 1,
      type: 'integer',
    },
  })
  @ApiOkResponse({
    schema: {
      additionalProperties: false,
      properties: {
        columns: { items: datasetColumnSchema, type: 'array' },
        datasetId: { format: 'uuid', type: 'string' },
        nextCursor: { minimum: 0, nullable: true, type: 'integer' },
        pageSize: {
          maximum: MAX_DATASET_ROW_PAGE_SIZE,
          minimum: 1,
          type: 'integer',
        },
        rows: { items: datasetRowSchema, type: 'array' },
      },
      required: ['columns', 'datasetId', 'nextCursor', 'pageSize', 'rows'],
      type: 'object',
    },
  })
  @ApiUnauthorizedResponse({ description: 'The resource token is invalid' })
  @ApiForbiddenResponse({ description: 'Organization access is denied' })
  @ApiNotFoundResponse({ description: 'The dataset is not visible' })
  async getDatasetRows(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('datasetId', { schema: datasetIdentifierSchema })
    datasetId: string,
    @Query({ schema: datasetRowQuerySchema }) query: DatasetRowQuery,
    @Req() request: AuthenticatedRequest,
  ): Promise<DatasetRowPageResponse> {
    const tenant = await this.resolveTenant(request, organizationId);
    const page = await this.datasets.readRowPage({
      ...tenant,
      after: query.after ?? null,
      datasetId,
      pageSize: query.pageSize,
    });

    if (page === null) {
      throw new NotFoundException();
    }

    // A short page is the last page, so the cursor is withheld instead of inviting an empty round trip.
    const nextCursor =
      page.rows.length < query.pageSize
        ? null
        : (page.rows.at(-1)?.rowNumber ?? null);

    return datasetRowPageResponseSchema.parse({
      columns: page.columns,
      datasetId,
      nextCursor,
      pageSize: query.pageSize,
      rows: page.rows,
    });
  }

  @Get(':organizationId/datasets')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({ summary: 'List the datasets visible to the caller' })
  @ApiOkResponse({
    description: `At most ${MAX_DATASET_LIST_SIZE} datasets, newest first`,
    schema: {
      additionalProperties: false,
      properties: {
        datasets: { items: datasetSummarySchema, type: 'array' },
      },
      required: ['datasets'],
      type: 'object',
    },
  })
  @ApiUnauthorizedResponse({ description: 'The resource token is invalid' })
  @ApiForbiddenResponse({ description: 'Organization access is denied' })
  async listDatasets(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<DatasetListResponse> {
    const tenant = await this.resolveTenant(request, organizationId);
    const datasets = await this.datasets.listDatasets(tenant);
    return datasetListResponseSchema.parse({ datasets });
  }

  // Reading is a member level action: the access contract holds no narrower read flag, and row level security still decides the rows.
  private async resolveTenant(
    request: AuthenticatedRequest,
    organizationId: string,
  ): Promise<TenantSelector> {
    const principal = request.resourcePrincipal;

    if (principal === undefined) {
      throw new UnauthorizedException();
    }

    const membership = await this.memberships.resolve(
      principal.subject,
      organizationId,
    );
    const access = resolveOrganizationAccess(
      'application-api',
      organizationId,
      membership,
    );

    if (access === null) {
      throw new ForbiddenException();
    }

    return { organizationId: access.organizationId, userId: principal.subject };
  }
}
