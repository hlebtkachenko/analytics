import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { HrController } from './hr/hr.controller.js';
import { HrRepository } from './hr/hr-repository.js';
import { HrTimeController } from './hr-time/hr-time.controller.js';
import { HrTimeRepository } from './hr-time/hr-time-repository.js';
import { MembershipResolver } from './membership-resolver.js';
import { PayrollImportController } from './payroll-import/payroll-import.controller.js';
import { PayrollImportQueue } from './payroll-import/payroll-import-queue.js';
import { PayrollImportRepository } from './payroll-import/payroll-import-repository.js';
import { PayrollController } from './payroll/payroll.controller.js';
import { PayrollRepository } from './payroll/payroll-repository.js';
import { ResourceJwtGuard } from './resource-jwt.guard.js';
import { SubjectRateLimitGuard } from './subject-rate-limit.guard.js';

describe('generated OpenAPI', () => {
  it('publishes the fixed payroll-run API with strict request and response shapes', async () => {
    const module = await Test.createTestingModule({
      controllers: [PayrollController, HrController, HrTimeController],
      providers: [
        { provide: PayrollRepository, useValue: {} },
        { provide: HrRepository, useValue: {} },
        { provide: HrTimeRepository, useValue: {} },
        { provide: MembershipResolver, useValue: {} },
      ],
    })
      .overrideGuard(ResourceJwtGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(SubjectRateLimitGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const app = module.createNestApplication();
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('test').setVersion('1').build(),
    );
    const collection =
      document.paths['/organizations/{organizationId}/payroll-runs'];
    const item =
      document.paths['/organizations/{organizationId}/payroll-runs/{id}'];
    const commands = [
      ['validate', {}],
      ['submit-for-approval', {}],
      ['approve', {}],
      ['reject', { reason: { type: 'string', minLength: 1, maxLength: 500 } }],
      ['finalize', {}],
      [
        'record-payment',
        {
          paidAt: { type: 'string', format: 'date-time' },
          paymentReference: { type: 'string', minLength: 1, maxLength: 200 },
        },
      ],
      [
        'corrections',
        { reason: { type: 'string', minLength: 1, maxLength: 500 } },
      ],
    ] as const;
    expect(
      Object.keys(document.paths)
        .filter((path) => path.includes('payroll-runs'))
        .sort(),
    ).toEqual([
      '/organizations/{organizationId}/payroll-runs',
      '/organizations/{organizationId}/payroll-runs/{id}',
      '/organizations/{organizationId}/payroll-runs/{id}/approvals',
      '/organizations/{organizationId}/payroll-runs/{id}/approve',
      '/organizations/{organizationId}/payroll-runs/{id}/corrections',
      '/organizations/{organizationId}/payroll-runs/{id}/finalize',
      '/organizations/{organizationId}/payroll-runs/{id}/liabilities',
      '/organizations/{organizationId}/payroll-runs/{id}/record-payment',
      '/organizations/{organizationId}/payroll-runs/{id}/reject',
      '/organizations/{organizationId}/payroll-runs/{id}/submit-for-approval',
      '/organizations/{organizationId}/payroll-runs/{id}/validate',
    ]);
    expect(collection?.get?.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            additionalProperties: false,
            required: ['payrollRuns', 'page', 'pageSize', 'total'],
          },
        },
      },
    });
    expect(collection?.post?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          in: 'header',
          name: 'Idempotency-Key',
          required: true,
          schema: { format: 'uuid', type: 'string' },
        }),
      ]),
    );
    expect(collection?.post?.requestBody).toMatchObject({
      content: {
        'application/json': {
          schema: {
            additionalProperties: false,
            required: ['legalEntityId', 'month', 'results'],
          },
        },
      },
    });
    expect(collection?.post?.responses['201']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            additionalProperties: false,
            required: [
              'id',
              'legalEntityId',
              'documentId',
              'month',
              'version',
              'supersedesPayrollRunId',
              'status',
              'origin',
              'validationSummary',
              'approvedBy',
              'approvedAt',
              'finalizedBy',
              'finalizedAt',
              'paidBy',
              'paidAt',
              'paymentReference',
              'ruleSetId',
              'createdAt',
              'results',
            ],
          },
        },
      },
    });
    expect(collection?.post?.responses).toEqual(
      expect.objectContaining({
        '400': expect.anything(),
        '403': expect.anything(),
        '404': expect.anything(),
        '409': expect.anything(),
      }),
    );
    expect(item?.get?.responses).toEqual(
      expect.objectContaining({
        '200': expect.anything(),
        '400': expect.anything(),
        '403': expect.anything(),
        '404': expect.anything(),
      }),
    );
    for (const [command, properties] of commands) {
      const operation =
        document.paths[
          `/organizations/{organizationId}/payroll-runs/{id}/${command}`
        ]?.post;
      expect(operation?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            in: 'header',
            name: 'Idempotency-Key',
            required: true,
            schema: { format: 'uuid', type: 'string' },
          }),
        ]),
      );
      expect(operation?.requestBody).toMatchObject({
        content: {
          'application/json': {
            schema: { additionalProperties: false, properties },
          },
        },
      });
      expect(operation?.responses).toEqual(
        expect.objectContaining({
          '200': expect.anything(),
          '400': expect.anything(),
          '403': expect.anything(),
          '404': expect.anything(),
          '409': expect.anything(),
        }),
      );
    }
    const approvals =
      document.paths[
        '/organizations/{organizationId}/payroll-runs/{id}/approvals'
      ]?.get;
    const liabilities =
      document.paths[
        '/organizations/{organizationId}/payroll-runs/{id}/liabilities'
      ]?.get;
    expect(approvals?.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            additionalProperties: false,
            required: ['approvals'],
            properties: {
              approvals: {
                items: {
                  additionalProperties: false,
                  required: ['action', 'reason', 'actor', 'actedAt'],
                },
              },
            },
          },
        },
      },
    });
    expect(liabilities?.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            additionalProperties: false,
            required: ['liabilities'],
            properties: {
              liabilities: {
                items: {
                  additionalProperties: false,
                  required: [
                    'kind',
                    'creditorReference',
                    'amount',
                    'dueOn',
                    'status',
                    'paidAt',
                  ],
                },
              },
            },
          },
        },
      },
    });
    expect(
      document.paths['/organizations/{organizationId}/hr/payroll-runs'],
    ).toBeUndefined();
    const employeePayrollResults =
      document.paths[
        '/organizations/{organizationId}/employees/{employeeId}/payroll-results'
      ]?.get;
    expect(employeePayrollResults?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'fromMonth',
          in: 'query',
          schema: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' },
        }),
        expect.objectContaining({
          name: 'toMonth',
          in: 'query',
          schema: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' },
        }),
        expect.objectContaining({
          name: 'pageSize',
          in: 'query',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
        }),
      ]),
    );
    expect(employeePayrollResults?.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            additionalProperties: false,
            required: ['payrollResults', 'page', 'pageSize', 'total'],
            properties: {
              payrollResults: {
                items: {
                  additionalProperties: false,
                  required: [
                    'payrollRunId',
                    'legalEntityId',
                    'month',
                    'version',
                    'supersedesPayrollRunId',
                    'status',
                    'origin',
                    'grossPay',
                    'employeeSocial',
                    'employeeHealth',
                    'incomeTax',
                    'otherDeductions',
                    'netPay',
                    'employerSocial',
                    'employerHealth',
                    'totalEmployerCost',
                    'payslipDocumentId',
                    'finalizedAt',
                    'paidAt',
                  ],
                },
              },
            },
          },
        },
      },
    });
    await app.close();
  });
  it('publishes the three payroll import operations and exact envelopes', async () => {
    const module = await Test.createTestingModule({
      controllers: [PayrollImportController],
      providers: [
        { provide: PayrollImportRepository, useValue: {} },
        { provide: PayrollImportQueue, useValue: {} },
        { provide: MembershipResolver, useValue: {} },
      ],
    })
      .overrideGuard(ResourceJwtGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(SubjectRateLimitGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const app = module.createNestApplication();
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('test').setVersion('1').build(),
    );
    const collection =
      document.paths['/organizations/{organizationId}/payroll/imports'];
    const item =
      document.paths['/organizations/{organizationId}/payroll/imports/{id}'];
    const consume =
      document.paths[
        '/organizations/{organizationId}/payroll/imports/{id}/consume'
      ];
    expect(collection?.post?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Idempotency-Key',
          in: 'header',
          required: true,
        }),
      ]),
    );
    expect(collection?.post?.requestBody).toMatchObject({
      content: {
        'multipart/form-data': {
          schema: { required: ['file', 'legalEntityId', 'payrollMonth'] },
        },
      },
    });
    expect(collection?.post?.responses['201']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            required: ['payrollImport'],
            additionalProperties: false,
            properties: {
              payrollImport: {
                additionalProperties: false,
                required: [
                  'id',
                  'legalEntityId',
                  'sourceDocumentId',
                  'payrollMonth',
                  'format',
                  'status',
                  'rowCount',
                  'errorCount',
                  'errorReport',
                  'payrollRunId',
                  'createdAt',
                ],
                properties: {
                  errorReport: {
                    type: 'array',
                    items: {
                      additionalProperties: false,
                      required: ['row', 'field', 'code'],
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    expect(item?.get?.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: { required: ['payrollImport'], additionalProperties: false },
        },
      },
    });
    expect(consume?.post?.responses['201']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            required: ['payrollRunId', 'status'],
            additionalProperties: false,
          },
        },
      },
    });
    await app.close();
  });
  it('publishes strict HR time items envelopes and input-only request schemas', async () => {
    const module = await Test.createTestingModule({
      controllers: [HrTimeController],
      providers: [
        { provide: HrTimeRepository, useValue: {} },
        { provide: MembershipResolver, useValue: {} },
      ],
    })
      .overrideGuard(ResourceJwtGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(SubjectRateLimitGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const app = module.createNestApplication();
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('test').setVersion('1').build(),
    );
    const schedules =
      document.paths[
        '/organizations/{organizationId}/employees/{employeeId}/schedules'
      ];
    const timesheets =
      document.paths[
        '/organizations/{organizationId}/employees/{employeeId}/timesheets'
      ];
    const timesheet =
      document.paths[
        '/organizations/{organizationId}/employees/{employeeId}/timesheets/{timesheetId}'
      ];
    for (const operation of [schedules?.get, timesheets?.get])
      expect(operation?.responses['200']).toMatchObject({
        content: {
          'application/json': {
            schema: {
              additionalProperties: false,
              required: ['items', 'page', 'pageSize', 'total'],
              properties: { items: { type: 'array' } },
            },
          },
        },
      });
    expect(timesheets?.post?.requestBody).toMatchObject({
      content: {
        'application/json': {
          schema: {
            additionalProperties: false,
            required: ['relationshipId', 'periodStart', 'periodEnd', 'entries'],
            properties: {
              entries: {
                items: {
                  required: ['workDate', 'startedAt', 'endedAt'],
                  properties: {
                    activityCode: { default: null },
                    breakMinutes: { default: 0 },
                  },
                },
              },
            },
          },
        },
      },
    });
    const patchEntries = (
      timesheet?.patch?.requestBody as {
        content?: {
          'application/json'?: {
            schema?: {
              properties?: { entries?: { items?: { properties?: object } } };
            };
          };
        };
      }
    )?.content?.['application/json']?.schema?.properties?.entries?.items
      ?.properties;
    expect(patchEntries).not.toHaveProperty('id');
    expect(patchEntries).not.toHaveProperty('createdAt');
    await app.close();
  });
  it('publishes strict employee document workflow operations', async () => {
    const module = await Test.createTestingModule({
      controllers: [HrController],
      providers: [
        { provide: HrRepository, useValue: {} },
        { provide: MembershipResolver, useValue: {} },
      ],
    })
      .overrideGuard(ResourceJwtGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(SubjectRateLimitGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const app = module.createNestApplication();
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('test').setVersion('1').build(),
    );
    const collection =
      document.paths[
        '/organizations/{organizationId}/employees/{employeeId}/documents'
      ];
    const item =
      document.paths[
        '/organizations/{organizationId}/employees/{employeeId}/documents/{documentId}'
      ];
    expect(collection?.get?.responses['200']).toBeDefined();
    expect(collection?.get?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'categoryId',
          in: 'query',
          schema: { type: 'string', format: 'uuid' },
        }),
        expect.objectContaining({
          name: 'approvalStatus',
          in: 'query',
          schema: {
            type: 'string',
            enum: ['not_required', 'pending', 'approved', 'rejected'],
          },
        }),
        expect.objectContaining({
          name: 'currentOnly',
          in: 'query',
          schema: { type: 'boolean', default: true },
        }),
        expect.objectContaining({
          name: 'page',
          in: 'query',
          schema: { type: 'integer', minimum: 1, default: 1 },
        }),
        expect.objectContaining({
          name: 'pageSize',
          in: 'query',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
        }),
      ]),
    );
    expect(collection?.get?.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            additionalProperties: false,
            required: ['items', 'page', 'pageSize', 'total'],
            properties: {
              items: { type: 'array' },
              page: { type: 'integer' },
              pageSize: { type: 'integer' },
              total: { type: 'integer', minimum: 0 },
            },
          },
        },
      },
    });
    expect(collection?.post?.responses['201']).toBeDefined();
    expect(collection?.post?.requestBody).toMatchObject({
      content: {
        'application/json': {
          schema: {
            additionalProperties: false,
            required: ['documentId', 'categoryId'],
          },
        },
      },
    });
    expect(item?.patch?.responses['200']).toBeDefined();
    expect(collection?.post?.responses['201']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            additionalProperties: false,
            required: [
              'documentId',
              'title',
              'documentDate',
              'categoryId',
              'relationshipId',
              'approvalStatus',
              'approvedBy',
              'approvedAt',
              'supersedesDocumentId',
              'createdAt',
            ],
          },
        },
      },
    });
    expect(item?.patch?.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            additionalProperties: false,
            required: [
              'documentId',
              'title',
              'documentDate',
              'categoryId',
              'relationshipId',
              'approvalStatus',
              'approvedBy',
              'approvedAt',
              'supersedesDocumentId',
              'createdAt',
            ],
          },
        },
      },
    });
    expect(item?.patch?.requestBody).toMatchObject({
      content: {
        'application/json': {
          schema: {
            additionalProperties: false,
            properties: {
              categoryId: { type: 'string', format: 'uuid' },
              relationshipId: { type: 'string', format: 'uuid' },
              supersedesDocumentId: {
                type: 'string',
                format: 'uuid',
              },
              approvalDecision: {
                type: 'string',
                enum: ['approved', 'rejected'],
              },
            },
          },
        },
      },
    });
    const paths = document.paths;
    const template =
      paths['/organizations/{organizationId}/hr/checklist-templates'];
    const templatePatch =
      paths[
        '/organizations/{organizationId}/hr/checklist-templates/{templateId}'
      ];
    const templateItem =
      paths[
        '/organizations/{organizationId}/hr/checklist-templates/{templateId}/items'
      ];
    const templateItemPatch =
      paths[
        '/organizations/{organizationId}/hr/checklist-templates/{templateId}/items/{itemId}'
      ];
    const checklist =
      paths[
        '/organizations/{organizationId}/employees/{employeeId}/checklists'
      ];
    const task =
      paths[
        '/organizations/{organizationId}/employees/{employeeId}/checklists/{checklistId}/tasks/{taskId}'
      ];
    for (const operation of [
      template?.get,
      template?.post,
      templatePatch?.patch,
      templateItem?.post,
      templateItemPatch?.patch,
      checklist?.get,
      checklist?.post,
      task?.patch,
    ]) {
      expect(operation).toBeDefined();
    }
    expect(template?.post?.requestBody).toMatchObject({
      content: {
        'application/json': {
          schema: {
            additionalProperties: false,
            required: ['legalEntityId', 'kind', 'code', 'name'],
          },
        },
      },
    });
    expect(templateItem?.post?.responses['201']).toBeDefined();
    expect(templateItemPatch?.patch?.responses['200']).toBeDefined();
    expect(checklist?.post?.requestBody).toMatchObject({
      content: {
        'application/json': {
          schema: {
            additionalProperties: false,
            required: ['templateId', 'startedOn', 'ownerUserId'],
          },
        },
      },
    });
    expect(task?.patch?.requestBody).toMatchObject({
      content: {
        'application/json': {
          schema: {
            additionalProperties: false,
            required: ['status'],
            properties: {
              status: { enum: ['in_progress', 'completed', 'skipped'] },
            },
          },
        },
      },
    });
    await app.close();
  });
  it('publishes strict leave and absence request-only contracts', async () => {
    const module = await Test.createTestingModule({
      controllers: [HrTimeController],
      providers: [
        { provide: HrTimeRepository, useValue: {} },
        { provide: MembershipResolver, useValue: {} },
      ],
    })
      .overrideGuard(ResourceJwtGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(SubjectRateLimitGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const app = module.createNestApplication();
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('test').setVersion('1').build(),
    );
    const leaveTypes =
      document.paths['/organizations/{organizationId}/hr/leave-types'];
    const requests =
      document.paths[
        '/organizations/{organizationId}/employees/{employeeId}/leave-requests'
      ];
    const absences =
      document.paths[
        '/organizations/{organizationId}/employees/{employeeId}/absences'
      ];
    const absence =
      document.paths[
        '/organizations/{organizationId}/employees/{employeeId}/absences/{absenceId}'
      ];
    const leaveType =
      document.paths[
        '/organizations/{organizationId}/hr/leave-types/{leaveTypeId}'
      ];
    const request =
      document.paths[
        '/organizations/{organizationId}/employees/{employeeId}/leave-requests/{requestId}/decide'
      ];
    const cancel =
      document.paths[
        '/organizations/{organizationId}/employees/{employeeId}/leave-requests/{requestId}/cancel'
      ];
    const balances =
      document.paths[
        '/organizations/{organizationId}/employees/{employeeId}/leave-balances'
      ];
    const ledger =
      document.paths[
        '/organizations/{organizationId}/employees/{employeeId}/leave-ledger'
      ];
    for (const operation of [leaveTypes?.get, requests?.get, absences?.get])
      expect(operation?.responses['200']).toMatchObject({
        content: {
          'application/json': {
            schema: {
              additionalProperties: false,
              required: ['items', 'page', 'pageSize', 'total'],
            },
          },
        },
      });
    expect(leaveTypes?.post?.requestBody).toMatchObject({
      content: {
        'application/json': {
          schema: {
            additionalProperties: false,
            required: ['legalEntityId', 'code', 'name', 'unit', 'paid'],
          },
        },
      },
    });
    expect(requests?.post?.requestBody).toMatchObject({
      content: {
        'application/json': {
          schema: {
            additionalProperties: false,
            required: [
              'relationshipId',
              'leaveTypeId',
              'startsOn',
              'endsOn',
              'requestedAmount',
            ],
          },
        },
      },
    });
    expect(absences?.post?.requestBody).toMatchObject({
      content: {
        'application/json': {
          schema: {
            additionalProperties: false,
            required: ['relationshipId', 'kind', 'startsOn', 'payrollCode'],
          },
        },
      },
    });
    expect(absence?.patch?.requestBody).toMatchObject({
      content: {
        'application/json': {
          schema: {
            additionalProperties: false,
            properties: { documentId: { type: 'string', nullable: true } },
          },
        },
      },
    });
    expect(leaveType?.patch?.requestBody).toMatchObject({
      content: {
        'application/json': { schema: { additionalProperties: false } },
      },
    });
    expect(request?.post?.requestBody).toMatchObject({
      content: {
        'application/json': {
          schema: { additionalProperties: false, required: ['decision'] },
        },
      },
    });
    expect(cancel?.post?.requestBody).toMatchObject({
      content: {
        'application/json': { schema: { additionalProperties: false } },
      },
    });
    expect(ledger?.post?.requestBody).toMatchObject({
      content: {
        'application/json': {
          schema: {
            additionalProperties: false,
            required: [
              'leaveTypeId',
              'relationshipId',
              'effectiveOn',
              'amount',
              'source',
              'reason',
            ],
          },
        },
      },
    });
    expect(balances?.get?.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            properties: {
              items: {
                items: {
                  additionalProperties: false,
                  required: ['leaveTypeId', 'unit', 'balance'],
                },
              },
            },
          },
        },
      },
    });
    const hrTimePaths = Object.entries(document.paths).filter(
      ([path]) =>
        path.includes('/employees/') || path.includes('/hr/leave-types'),
    );
    expect(hrTimePaths.length).toBe(17);
    for (const [path, item] of hrTimePaths) {
      for (const [method, operation] of Object.entries(item ?? {})) {
        if (
          !operation ||
          typeof operation !== 'object' ||
          !('responses' in operation)
        )
          continue;
        expect(operation.responses).toEqual(
          expect.objectContaining({ '403': expect.anything() }),
        );
        if (
          path.includes('/employees/') ||
          (path.includes('/hr/leave-types') &&
            (method === 'post' || method === 'patch'))
        ) {
          expect(operation.responses).toEqual(
            expect.objectContaining({ '404': expect.anything() }),
          );
        }
        if (method !== 'get') {
          expect(operation.responses).toEqual(
            expect.objectContaining({ '409': expect.anything() }),
          );
        }
      }
    }
    await app.close();
  });
});
