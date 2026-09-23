'use client';

import {
  Button,
  InlineNotification,
  Modal,
  Stack,
  TextInput,
  Tile,
} from '@bap/design-system/react';
import { DataGrid } from '@bap/design-system/blocks';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getJson } from '../../../../lib/datasets/client';
import { withOrganization } from '../../../../lib/hr/client';
import {
  payrollApprovalsSchema,
  payrollLiabilitiesSchema,
  payrollRunSchema,
} from '../../../../lib/payroll/contract';
import {
  payrollRunApprovalsPath,
  payrollRunCommandPath,
  payrollRunLiabilitiesPath,
  payrollRunPath,
  postPayrollJson,
} from '../../../../lib/payroll/client';
import { useOrganizationAccess } from '../../../../lib/organizations/use-organization-access';
import { useOrganizationSelection } from '../../../../lib/organizations/use-organization-selection';

export type PayrollSection =
  | 'overview'
  | 'validation'
  | 'results'
  | 'taxes'
  | 'accounting'
  | 'documents'
  | 'submissions'
  | 'corrections';

const sections: readonly PayrollSection[] = [
  'overview',
  'validation',
  'results',
  'taxes',
  'accounting',
  'documents',
  'submissions',
  'corrections',
];

export function PayrollTabs({
  section,
}: Readonly<{ section: PayrollSection }>) {
  const { t } = useTranslation();
  const { payrollRunId } = useParams<{ payrollRunId: string }>();
  const organization = useOrganizationSelection();
  return (
    <nav aria-label={t('payroll.sections')}>
      {sections.map((item) => (
        <Link
          aria-current={item === section ? 'page' : undefined}
          href={
            withOrganization(
              item === 'overview'
                ? `/payroll/${payrollRunId}`
                : `/payroll/${payrollRunId}/${item}`,
              organization.slug,
            ) as never
          }
          key={item}
        >
          {t(`payroll.${item}`)}
        </Link>
      ))}
    </nav>
  );
}

function add(a: string, b: string) {
  const [ai, af = ''] = a.split('.');
  const [bi, bf = ''] = b.split('.');
  const scale = Math.max(af.length, bf.length, 4);
  const multiplier = 10n ** BigInt(scale);
  const parse = (whole: string, fraction: string) =>
    BigInt(whole) * multiplier +
    BigInt((fraction + '0'.repeat(scale)).slice(0, scale));
  const value = parse(ai!, af) + parse(bi!, bf);
  const whole = value / multiplier;
  const fraction = (value % multiplier).toString().padStart(scale, '0');
  return `${whole}.${fraction}`;
}
function total(values: readonly string[]) {
  return values.reduce(add, '0.0000');
}

const accountingCategories = (
  results: ReadonlyArray<(typeof payrollRunSchema._output)['results'][number]>,
) =>
  [
    ['grossPay', total(results.map((result) => result.grossPay)), 'debit'],
    [
      'employerContributions',
      total(
        results.map((result) =>
          add(result.employerSocial, result.employerHealth),
        ),
      ),
      'debit',
    ],
    ['netWages', total(results.map((result) => result.netPay)), 'credit'],
    [
      'insurancePayable',
      total(
        results.map((result) =>
          add(
            add(result.employeeSocial, result.employerSocial),
            add(result.employeeHealth, result.employerHealth),
          ),
        ),
      ),
      'credit',
    ],
    ['incomeTax', total(results.map((result) => result.incomeTax)), 'credit'],
    [
      'otherDeductions',
      total(results.map((result) => result.otherDeductions)),
      'credit',
    ],
  ] as const;

export default function PayrollRunPage({
  section,
}: Readonly<{ section: PayrollSection }>) {
  const { t } = useTranslation();
  const { payrollRunId } = useParams<{ payrollRunId: string }>();
  const organization = useOrganizationSelection();
  const { access, state: accessState } = useOrganizationAccess(
    organization.organizationId,
  );
  const [run, setRun] = useState<typeof payrollRunSchema._output>();
  const [dataError, setDataError] = useState(false);
  const [commandError, setCommandError] = useState(false);
  const [approvals, setApprovals] =
    useState<typeof payrollApprovalsSchema._output>();
  const [liabilities, setLiabilities] =
    useState<typeof payrollLiabilitiesSchema._output>();
  const [reason, setReason] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paidAt, setPaidAt] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionReason, setCorrectionReason] = useState('');
  const commandKeys = useRef(new Map<string, string>());
  const getKey = (command: string) => {
    const existing = commandKeys.current.get(command);
    if (existing) return existing;
    const next = crypto.randomUUID();
    commandKeys.current.set(command, next);
    return next;
  };
  const load = useCallback(
    (signal = new AbortController().signal) => {
      if (!organization.organizationId || !access?.capabilities.readPayroll)
        return;
      void getJson(
        payrollRunPath(organization.organizationId, payrollRunId),
        signal,
      )
        .then((payload) => payrollRunSchema.parse(payload))
        .then((payload) => {
          if (!signal.aborted) {
            setDataError(false);
            setRun(payload);
          }
        })
        .catch(() => {
          if (!signal?.aborted) setDataError(true);
        });
    },
    [
      access?.capabilities.readPayroll,
      organization.organizationId,
      payrollRunId,
    ],
  );
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);
  useEffect(() => {
    if (
      section !== 'submissions' ||
      !organization.organizationId ||
      !access?.capabilities.readPayroll
    )
      return;
    const controller = new AbortController();
    void Promise.all([
      getJson(
        payrollRunApprovalsPath(organization.organizationId, payrollRunId),
        controller.signal,
      ).then((x) => payrollApprovalsSchema.parse(x)),
      getJson(
        payrollRunLiabilitiesPath(organization.organizationId, payrollRunId),
        controller.signal,
      ).then((x) => payrollLiabilitiesSchema.parse(x)),
    ])
      .then(([nextApprovals, nextLiabilities]) => {
        setApprovals(nextApprovals);
        setLiabilities(nextLiabilities);
      })
      .catch(() => {
        if (!controller.signal.aborted) setDataError(true);
      });
    return () => controller.abort();
  }, [
    section,
    organization.organizationId,
    payrollRunId,
    access?.capabilities.readPayroll,
  ]);
  const command = (
    name: Parameters<typeof payrollRunCommandPath>[2],
    body: unknown = {},
  ) => {
    if (!organization.organizationId) return;
    void postPayrollJson(
      payrollRunCommandPath(organization.organizationId, payrollRunId, name),
      body,
      payrollRunSchema,
      getKey(name),
    )
      .then(() => {
        commandKeys.current.delete(name);
        setRejectOpen(false);
        setPaymentOpen(false);
        setCorrectionOpen(false);
        setReason('');
        setPaidAt('');
        setPaymentReference('');
        setCorrectionReason('');
        setCommandError(false);
        load();
      })
      .catch(() => setCommandError(true));
  };
  const resetCommand = (name: string) => commandKeys.current.delete(name);
  if (organization.state === 'error' || accessState === 'error')
    return (
      <InlineNotification
        kind="error"
        title={t('payroll.accessError')}
        hideCloseButton
      />
    );
  if (organization.state === 'loading' || access === undefined)
    return (
      <InlineNotification
        kind="info"
        title={t('payroll.loading')}
        hideCloseButton
      />
    );
  if (!access.capabilities.readPayroll)
    return (
      <InlineNotification
        kind="error"
        title={t('payroll.denied')}
        hideCloseButton
      />
    );
  if (dataError)
    return (
      <Stack gap={4}>
        <InlineNotification
          kind="error"
          title={t('payroll.error')}
          hideCloseButton
        />
        <Button kind="secondary" onClick={() => load()}>
          {t('payroll.retry')}
        </Button>
      </Stack>
    );
  if (!run)
    return (
      <InlineNotification
        kind="info"
        title={t('payroll.loading')}
        hideCloseButton
      />
    );
  const canManage = access.capabilities.managePayroll;
  const content = (() => {
    if (section === 'overview')
      return (
        <Tile>
          <p>
            {t('payroll.identity')}: {run.id}
          </p>
          <p>
            {t('payroll.month')}: {run.month}
          </p>
          <p>
            {t('payroll.version')}: {run.version}
          </p>
          <p>
            {t('payroll.status')}: {run.status}
          </p>
          <p>
            {t('payroll.origin')}: {run.origin}
          </p>
          <p>
            {t('payroll.predecessor')}:{' '}
            {run.supersedesPayrollRunId ?? t('payroll.none')}
          </p>
          <p>
            {t('payroll.approved')}: {run.approvedBy ?? t('payroll.none')}{' '}
            {run.approvedAt ?? ''}
          </p>
          <p>
            {t('payroll.finalized')}: {run.finalizedBy ?? t('payroll.none')}{' '}
            {run.finalizedAt ?? ''}
          </p>
          <p>
            {t('payroll.paid')}: {run.paidBy ?? t('payroll.none')}{' '}
            {run.paidAt ?? ''}
          </p>
        </Tile>
      );
    if (section === 'validation')
      return (
        <Stack gap={4}>
          <DataGrid
            columns={[
              { key: 'code', header: t('payroll.code') },
              { key: 'count', header: t('payroll.count') },
            ]}
            rows={run.validationSummary.issues.map((issue) => ({
              id: issue.code,
              ...issue,
            }))}
            state={run.validationSummary.issues.length ? 'ready' : 'empty'}
            emptyLabel={t('payroll.validationEmpty')}
          />
          {canManage && run.status === 'draft' && (
            <Button onClick={() => command('validate')}>
              {t('payroll.validate')}
            </Button>
          )}
          {canManage &&
            run.status === 'validating' &&
            run.validationSummary.valid && (
              <Button onClick={() => command('submit-for-approval')}>
                {t('payroll.submit')}
              </Button>
            )}
          {run.status === 'ready_for_approval' &&
            access.capabilities.approvePayroll && (
              <Button onClick={() => command('approve')}>
                {t('payroll.approve')}
              </Button>
            )}
          {canManage && run.status === 'ready_for_approval' && (
            <Button kind="danger--tertiary" onClick={() => setRejectOpen(true)}>
              {t('payroll.reject')}
            </Button>
          )}
          {canManage && run.status === 'approved' && (
            <Button onClick={() => command('finalize')}>
              {t('payroll.finalize')}
            </Button>
          )}
          {rejectOpen && (
            <Modal
              open={rejectOpen}
              modalHeading={t('payroll.reject')}
              primaryButtonText={t('payroll.reject')}
              primaryButtonDisabled={!reason.trim()}
              secondaryButtonText={t('payroll.cancel')}
              onRequestClose={() => {
                resetCommand('reject');
                setRejectOpen(false);
                setReason('');
              }}
              onRequestSubmit={() =>
                command('reject', { reason: reason.trim() })
              }
            >
              <TextInput
                id="reject-reason"
                labelText={t('payroll.reason')}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </Modal>
          )}
        </Stack>
      );
    if (section === 'results')
      return (
        <DataGrid
          columns={[
            'employeeId',
            'grossPay',
            'netPay',
            'otherDeductions',
            'totalEmployerCost',
          ].map((key) => ({ key, header: t(`payroll.${key}`) }))}
          rows={run.results.map((result) => ({
            id: result.employeeId,
            ...result,
          }))}
          state={run.results.length ? 'ready' : 'empty'}
          emptyLabel={t('payroll.resultsEmpty')}
        />
      );
    if (section === 'taxes')
      return (
        <DataGrid
          columns={[
            'employeeId',
            'employeeSocial',
            'employeeHealth',
            'employerSocial',
            'employerHealth',
            'incomeTax',
            'otherDeductions',
          ].map((key) => ({ key, header: t(`payroll.${key}`) }))}
          rows={run.results.map((result) => ({
            id: result.employeeId,
            ...result,
          }))}
          state={run.results.length ? 'ready' : 'empty'}
          emptyLabel={t('payroll.taxesEmpty')}
        />
      );
    if (section === 'accounting')
      return (
        <Tile>
          <p>
            {run.status === 'finalized' || run.status === 'paid'
              ? t('payroll.accountingFinal')
              : t('payroll.accountingPreview')}
          </p>
          {accountingCategories(run.results)
            .filter(([, amount]) => amount !== '0.0000')
            .map(([key, amount, side]) => (
              <p key={key}>
                {t(`payroll.accountingEntries.${side}.${key}`)}: {amount}
              </p>
            ))}
          <p>
            {t('payroll.accountingDebitTotal')}:{' '}
            {total(
              accountingCategories(run.results)
                .filter(([, , side]) => side === 'debit')
                .map(([, amount]) => amount),
            )}
          </p>
          <p>
            {t('payroll.accountingCreditTotal')}:{' '}
            {total(
              accountingCategories(run.results)
                .filter(([, , side]) => side === 'credit')
                .map(([, amount]) => amount),
            )}
          </p>
          {run.documentId &&
            (run.status === 'finalized' || run.status === 'paid') && (
              <Link
                href={
                  withOrganization(
                    `/documents/${run.documentId}`,
                    organization.slug,
                  ) as never
                }
              >
                {t('payroll.headerDocument')}
              </Link>
            )}
        </Tile>
      );
    if (section === 'documents')
      return (
        <Tile>
          {run.documentId ? (
            <Link
              href={
                withOrganization(
                  `/documents/${run.documentId}`,
                  organization.slug,
                ) as never
              }
            >
              {t('payroll.headerDocument')}
            </Link>
          ) : (
            <p>{t('payroll.noHeaderDocument')}</p>
          )}
          <p>{t('payroll.payslipGuidance')}</p>
        </Tile>
      );
    if (section === 'submissions')
      return (
        <Stack gap={4}>
          <DataGrid
            columns={['action', 'actor', 'actedAt', 'reason'].map((key) => ({
              key,
              header: t(`payroll.${key}`),
            }))}
            rows={(approvals?.approvals ?? []).map((item, index) => ({
              id: `${item.actedAt}-${index}`,
              ...item,
            }))}
            state={
              approvals
                ? approvals.approvals.length
                  ? 'ready'
                  : 'empty'
                : 'loading'
            }
            emptyLabel={t('payroll.empty')}
          />
          <DataGrid
            columns={[
              'kind',
              'creditorReference',
              'amount',
              'dueOn',
              'status',
            ].map((key) => ({ key, header: t(`payroll.${key}`) }))}
            rows={(liabilities?.liabilities ?? []).map((item, index) => ({
              id: `${item.kind}-${index}`,
              ...item,
            }))}
            state={
              liabilities
                ? liabilities.liabilities.length
                  ? 'ready'
                  : 'empty'
                : 'loading'
            }
            emptyLabel={t('payroll.empty')}
          />
          {canManage && run.status === 'finalized' && (
            <Button onClick={() => setPaymentOpen(true)}>
              {t('payroll.recordPayment')}
            </Button>
          )}
        </Stack>
      );
    return (
      <Stack gap={4}>
        <Tile>
          <p>
            {t('payroll.predecessor')}:{' '}
            {run.supersedesPayrollRunId ?? t('payroll.none')}
          </p>
          {run.supersedesPayrollRunId && (
            <Link
              href={
                withOrganization(
                  `/payroll/${run.supersedesPayrollRunId}`,
                  organization.slug,
                ) as never
              }
            >
              {t('payroll.predecessor')}
            </Link>
          )}
        </Tile>
        {canManage && (run.status === 'finalized' || run.status === 'paid') && (
          <Button onClick={() => setCorrectionOpen(true)}>
            {t('payroll.createCorrection')}
          </Button>
        )}
      </Stack>
    );
  })();
  return (
    <Stack gap={5}>
      <PayrollTabs section={section} />
      {commandError && (
        <InlineNotification
          kind="error"
          title={t('payroll.commandError')}
          hideCloseButton
        />
      )}
      {content}
      {paymentOpen && (
        <Modal
          open={paymentOpen}
          modalHeading={t('payroll.recordPayment')}
          primaryButtonDisabled={!paidAt || !paymentReference.trim()}
          primaryButtonText={t('payroll.recordPayment')}
          secondaryButtonText={t('payroll.cancel')}
          onRequestClose={() => {
            resetCommand('record-payment');
            setPaymentOpen(false);
            setPaidAt('');
            setPaymentReference('');
          }}
          onRequestSubmit={() =>
            command('record-payment', {
              paidAt: new Date(paidAt).toISOString(),
              paymentReference: paymentReference.trim(),
            })
          }
        >
          <TextInput
            id="payroll-paid-at"
            labelText={t('payroll.paidAt')}
            type="datetime-local"
            value={paidAt}
            onChange={(event) => setPaidAt(event.target.value)}
          />
          <TextInput
            id="payroll-payment-reference"
            labelText={t('payroll.paymentReference')}
            value={paymentReference}
            onChange={(event) => setPaymentReference(event.target.value)}
          />
        </Modal>
      )}
      {correctionOpen && (
        <Modal
          open={correctionOpen}
          modalHeading={t('payroll.createCorrection')}
          primaryButtonDisabled={!correctionReason.trim()}
          primaryButtonText={t('payroll.createCorrection')}
          secondaryButtonText={t('payroll.cancel')}
          onRequestClose={() => {
            resetCommand('corrections');
            setCorrectionOpen(false);
            setCorrectionReason('');
          }}
          onRequestSubmit={() =>
            command('corrections', { reason: correctionReason.trim() })
          }
        >
          <TextInput
            id="payroll-correction-reason"
            labelText={t('payroll.reason')}
            value={correctionReason}
            onChange={(event) => setCorrectionReason(event.target.value)}
          />
        </Modal>
      )}
    </Stack>
  );
}
