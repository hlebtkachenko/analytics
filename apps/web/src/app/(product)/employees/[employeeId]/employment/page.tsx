'use client';

import {
  Button,
  ComboBox,
  Form,
  Heading,
  InlineNotification,
  Modal,
  Select,
  SelectItem,
  Stack,
  TextInput,
} from '@bap/design-system/react';
import { DataGrid } from '@bap/design-system/blocks';
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PageContainer from '../../../../../components/page-container';
import { getJson } from '../../../../../lib/datasets/client';
import {
  employmentTermsPath,
  employeePath,
  employeeRelationshipsPath,
  employeesPath,
  hrReferencesPath,
  sendHrJson,
} from '../../../../../lib/hr/client';
import {
  createEmploymentTermSchema,
  employeeDetailSchema,
  employeeListSchema,
  departmentListSchema,
  positionListSchema,
  costCentreListSchema,
  workplaceListSchema,
  createRelationshipSchema,
  employmentTermListSchema,
  employmentTermSchema,
  relationshipSchema,
} from '../../../../../lib/hr/contract';
import { useOrganizationAccess } from '../../../../../lib/organizations/use-organization-access';
import { useOrganizationSelection } from '../../../../../lib/organizations/use-organization-selection';
import { EmployeeTabs } from '../employee-tabs';
import { useToast } from '../../../../../components/shell/toast';

export default function EmploymentPage() {
  const { t } = useTranslation();
  const { employeeId } = useParams<{ employeeId: string }>();
  const org = useOrganizationSelection();
  const { access, state: accessState } = useOrganizationAccess(
    org.organizationId,
  );
  const { notify } = useToast();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const parsedRelationship = relationshipSchema.shape.id.safeParse(
    params.get('relationshipId'),
  );
  const queryRelationshipId = parsedRelationship.success
    ? parsedRelationship.data
    : undefined;
  const rawPage = Number(params.get('page'));
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;
  const rawPageSize = Number(params.get('pageSize'));
  const pageSize =
    Number.isInteger(rawPageSize) && rawPageSize >= 1 && rawPageSize <= 100
      ? rawPageSize
      : 25;
  const [terms, setTerms] = useState<typeof employmentTermListSchema._output>();
  const [relationships, setRelationships] = useState<
    (typeof relationshipSchema._output)[]
  >([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selected, setSelected] = useState<
    typeof employmentTermSchema._output | null
  >(null);
  const [relationshipId, setRelationshipId] = useState<string | null>(null);
  const [termReferences, setTermReferences] = useState({
    positionId: null as string | null,
    departmentId: null as string | null,
    costCentreId: null as string | null,
    workplaceId: null as string | null,
    managerEmployeeId: null as string | null,
  });
  const [error, setError] = useState<'conflict' | 'general' | null>(null);
  const [employee, setEmployee] =
    useState<typeof employeeDetailSchema._output>();
  const [firstEligible, setFirstEligible] = useState(new Set<string>());
  const [relationshipOpen, setRelationshipOpen] = useState(false);
  const [referenceQuery, setReferenceQuery] = useState('');
  const [references, setReferences] = useState<
    Record<string, { id: string; code: string; name: string }[]>
  >({});
  const [managers, setManagers] = useState<
    { id: string; code: string; name: string }[]
  >([]);
  const load = useCallback(() => {
    if (!org.organizationId || !access?.capabilities.readHr) return;
    const query = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (queryRelationshipId) query.set('relationshipId', queryRelationshipId);
    void Promise.all([
      getJson(
        employmentTermsPath(org.organizationId, employeeId, query),
        new AbortController().signal,
      ).then((x) => employmentTermListSchema.parse(x)),
      getJson(
        employeeRelationshipsPath(org.organizationId, employeeId),
        new AbortController().signal,
      ).then((x) =>
        (x as { relationships: unknown[] }).relationships.map((r) =>
          relationshipSchema.parse(r),
        ),
      ),
      getJson(
        employeePath(org.organizationId, employeeId),
        new AbortController().signal,
      ).then((x) => employeeDetailSchema.parse(x)),
    ])
      .then(([termResult, relationResult, employeeResult]) => {
        setTerms(termResult);
        setRelationships(relationResult);
        setEmployee(employeeResult);
        setState('ready');
        return Promise.all(
          relationResult.map((relationship) => {
            const existenceQuery = new URLSearchParams({
              relationshipId: relationship.id,
              page: '1',
              pageSize: '1',
            });
            return getJson(
              employmentTermsPath(
                org.organizationId,
                employeeId,
                existenceQuery,
              ),
              new AbortController().signal,
            )
              .then((value) => employmentTermListSchema.parse(value))
              .then((value) => ({
                id: relationship.id,
                empty: value.total === 0,
              }));
          }),
        );
      })
      .then((checks) =>
        setFirstEligible(
          new Set(
            checks.filter((check) => check.empty).map((check) => check.id),
          ),
        ),
      )
      .catch(() => setState('error'));
  }, [
    access?.capabilities.readHr,
    employeeId,
    org.organizationId,
    page,
    pageSize,
    queryRelationshipId,
  ]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!employee || !org.organizationId || !access?.capabilities.readHr)
      return;
    const query = new URLSearchParams({
      legalEntityId: employee.legalEntityId,
      active: 'true',
      page: '1',
      pageSize: '100',
    });
    if (referenceQuery.trim())
      query.set('q', referenceQuery.trim().slice(0, 100));
    const signal = new AbortController().signal;
    void Promise.all([
      getJson(
        hrReferencesPath(org.organizationId, 'departments', query),
        signal,
      ).then((value) => departmentListSchema.parse(value).departments),
      getJson(
        hrReferencesPath(org.organizationId, 'positions', query),
        signal,
      ).then((value) => positionListSchema.parse(value).positions),
      getJson(
        hrReferencesPath(org.organizationId, 'cost-centres', query),
        signal,
      ).then((value) => costCentreListSchema.parse(value).costCentres),
      getJson(
        hrReferencesPath(org.organizationId, 'workplaces', query),
        signal,
      ).then((value) => workplaceListSchema.parse(value).workplaces),
      getJson(
        employeesPath(
          org.organizationId,
          new URLSearchParams({
            legalEntityId: employee.legalEntityId,
            status: 'active',
            page: '1',
            pageSize: '100',
            ...(referenceQuery.trim()
              ? { q: referenceQuery.trim().slice(0, 100) }
              : {}),
          }),
        ),
        signal,
      ).then((value) => employeeListSchema.parse(value).employees),
    ])
      .then(([departments, positions, costCentres, workplaces, employees]) => {
        setReferences({
          departments,
          positions,
          'cost-centres': costCentres,
          workplaces,
        });
        setManagers(
          employees.map((item) => ({
            id: item.id,
            code: item.employeeNumber,
            name: `${item.firstName} ${item.lastName}`,
          })),
        );
      })
      .catch(() => setState('error'));
  }, [
    access?.capabilities.readHr,
    employee,
    org.organizationId,
    referenceQuery,
  ]);
  if (org.state === 'error')
    return (
      <PageContainer>
        <InlineNotification
          kind="error"
          title={t('employees.termsError')}
          hideCloseButton
        />
      </PageContainer>
    );
  if (accessState === 'error')
    return (
      <PageContainer>
        <InlineNotification
          kind="error"
          title={t('employees.termsError')}
          hideCloseButton
        />
      </PageContainer>
    );
  if (access !== undefined && !access.capabilities.readHr)
    return (
      <PageContainer>
        <InlineNotification
          kind="error"
          title={t('employees.denied')}
          hideCloseButton
        />
      </PageContainer>
    );
  if (
    org.state === 'loading' ||
    accessState === 'loading' ||
    access === undefined ||
    state === 'loading' ||
    !terms
  )
    return (
      <PageContainer>
        <p>{t('employees.loading')}</p>
      </PageContainer>
    );
  if (state === 'error')
    return (
      <PageContainer>
        <InlineNotification
          kind="error"
          title={t('employees.termsError')}
          hideCloseButton
        />
      </PageContainer>
    );
  const successors = new Set(
    terms.items.flatMap((term) =>
      term.supersedesEmploymentTermId ? [term.supersedesEmploymentTermId] : [],
    ),
  );
  const referenceName = (id: string | null) => {
    if (!id) return '';
    const reference = Object.values(references)
      .flat()
      .find((item) => item.id === id);
    const manager = managers.find((item) => item.id === id);
    const relationship = relationships.find((item) => item.id === id);
    const item = reference ?? manager;
    return relationship?.position ?? (item ? `${item.code} ${item.name}` : '');
  };
  const manage = access?.capabilities.manageHr === true;
  const openFirst = (id: string) => {
    setRelationshipId(id);
    setSelected(null);
    setTermReferences({
      positionId: null,
      departmentId: null,
      costCentreId: null,
      workplaceId: null,
      managerEmployeeId: null,
    });
    setError(null);
  };
  const openCorrection = (term: typeof employmentTermSchema._output) => {
    setRelationshipId(term.relationshipId);
    setSelected(term);
    setTermReferences({
      positionId: term.positionId,
      departmentId: term.departmentId,
      costCentreId: term.costCentreId,
      workplaceId: term.workplaceId,
      managerEmployeeId: term.managerEmployeeId,
    });
    setError(null);
  };
  return (
    <PageContainer>
      <Stack gap={6}>
        <EmployeeTabs />
        <Heading>{t('employees.employment')}</Heading>
        {manage && (
          <Button
            onClick={() => {
              setRelationshipOpen(true);
              setError(null);
            }}
          >
            {t('employees.addRelationship')}
          </Button>
        )}
        <Select
          id="relationship-filter"
          labelText={t('employees.relationshipFilter')}
          value={queryRelationshipId ?? ''}
          onChange={(event) => {
            const next = new URLSearchParams(params.toString());
            if (event.target.value)
              next.set('relationshipId', event.target.value);
            else next.delete('relationshipId');
            next.set('page', '1');
            router.replace(`${pathname}?${next}` as never);
          }}
        >
          <SelectItem value="" text={t('employees.allRelationships')} />
          {relationships.map((relationship) => (
            <SelectItem
              key={relationship.id}
              value={relationship.id}
              text={relationship.position}
            />
          ))}
        </Select>
        <DataGrid
          columns={[
            { key: 'relationship', header: t('employees.relationship') },
            { key: 'version', header: t('employees.version') },
            { key: 'dates', header: t('employees.effectiveFrom') },
            { key: 'position', header: t('employees.position') },
            { key: 'department', header: t('employees.department') },
            { key: 'workplace', header: t('employees.workplace') },
            { key: 'hours', header: t('employees.weeklyHours') },
            { key: 'pattern', header: t('employees.workingTimePattern') },
          ]}
          rows={terms.items.map((term) => ({
            id: term.id,
            relationship: referenceName(term.relationshipId),
            version: String(term.version),
            dates: `${term.effectiveFrom} - ${term.effectiveTo ?? ''}`,
            position: referenceName(term.positionId),
            department: referenceName(term.departmentId),
            workplace: referenceName(term.workplaceId),
            hours: term.weeklyHours,
            pattern: term.workingTimePattern,
          }))}
          state={terms.items.length ? 'ready' : 'empty'}
          emptyLabel={t('employees.termsEmpty')}
          pagination
          paginationMode="server"
          page={terms.page}
          pageSize={terms.pageSize}
          totalItems={terms.total}
          onPageChange={(next, size) => {
            const nextParams = new URLSearchParams(params.toString());
            nextParams.set('page', String(next));
            nextParams.set('pageSize', String(size));
            router.replace(`${pathname}?${nextParams}` as never);
          }}
          onRowClick={(row: { id: string }) => {
            const term = terms.items.find((item) => item.id === row.id);
            if (manage && term && !successors.has(term.id))
              openCorrection(term);
          }}
        />
        {manage &&
          relationships
            .filter((relationship) => firstEligible.has(relationship.id))
            .map((relationship) => (
              <Button
                key={relationship.id}
                onClick={() => openFirst(relationship.id)}
              >
                {t('employees.addFirstTerm')}
              </Button>
            ))}
        <Modal
          key={selected?.id ?? relationshipId}
          open={relationshipId !== null}
          modalHeading={
            selected ? t('employees.correctTerm') : t('employees.addFirstTerm')
          }
          primaryButtonText={t('employees.save')}
          secondaryButtonText={t('common.cancel')}
          onRequestClose={() => setRelationshipId(null)}
          onRequestSubmit={() => {
            const form = document.getElementById(
              'employment-term-form',
            ) as HTMLFormElement | null;
            form?.requestSubmit();
          }}
        >
          <Form
            id="employment-term-form"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              try {
                const body = createEmploymentTermSchema.parse({
                  relationshipId,
                  supersedesEmploymentTermId: selected?.id ?? null,
                  effectiveFrom: data.get('effectiveFrom'),
                  effectiveTo: data.get('effectiveTo') || null,
                  ...termReferences,
                  weeklyHours: data.get('weeklyHours'),
                  workingTimePattern: data.get('workingTimePattern'),
                });
                void sendHrJson(
                  employmentTermsPath(org.organizationId, employeeId),
                  'POST',
                  body,
                  employmentTermSchema,
                )
                  .then(() => {
                    setRelationshipId(null);
                    notify({ kind: 'success', title: t('employees.save') });
                    load();
                  })
                  .catch((response: unknown) =>
                    setError(
                      response instanceof Error &&
                        'status' in response &&
                        response.status === 409
                        ? 'conflict'
                        : 'general',
                    ),
                  );
              } catch {
                setError('general');
              }
            }}
          >
            <Stack gap={3}>
              {error && (
                <InlineNotification
                  kind="error"
                  title={t(
                    error === 'conflict'
                      ? 'employees.conflict'
                      : 'employees.mutationError',
                  )}
                  hideCloseButton
                />
              )}
              <TextInput
                id="effectiveFrom"
                name="effectiveFrom"
                labelText={t('employees.effectiveFrom')}
                defaultValue={selected?.effectiveFrom ?? ''}
              />
              {(
                [
                  'positions',
                  'departments',
                  'cost-centres',
                  'workplaces',
                ] as const
              ).map((collection) => {
                const field =
                  collection === 'positions'
                    ? 'positionId'
                    : collection === 'departments'
                      ? 'departmentId'
                      : collection === 'cost-centres'
                        ? 'costCentreId'
                        : 'workplaceId';
                const selectedId = termReferences[field];
                const items = (references[collection] ?? []).map((item) => ({
                  id: item.id,
                  label: `${item.code} ${item.name}`,
                }));
                return (
                  <ComboBox
                    key={collection}
                    id={`term-${collection}`}
                    items={items}
                    itemToString={(item) => item?.label ?? ''}
                    selectedItem={
                      items.find((item) => item.id === selectedId) ?? null
                    }
                    onChange={(change) =>
                      setTermReferences((current) => ({
                        ...current,
                        [field]: change.selectedItem?.id ?? null,
                      }))
                    }
                    onInputChange={setReferenceQuery}
                    onToggle={(open) => {
                      if (open) setReferenceQuery('');
                    }}
                    titleText={t(
                      collection === 'positions'
                        ? 'employees.position'
                        : collection === 'departments'
                          ? 'employees.department'
                          : collection === 'cost-centres'
                            ? 'employees.costCentre'
                            : 'employees.workplace',
                    )}
                  />
                );
              })}
              <ComboBox
                id="term-manager"
                items={managers.map((item) => ({
                  id: item.id,
                  label: `${item.code} ${item.name}`,
                }))}
                itemToString={(item) => item?.label ?? ''}
                selectedItem={
                  managers
                    .map((item) => ({
                      id: item.id,
                      label: `${item.code} ${item.name}`,
                    }))
                    .find(
                      (item) => item.id === termReferences.managerEmployeeId,
                    ) ?? null
                }
                onChange={(change) =>
                  setTermReferences((current) => ({
                    ...current,
                    managerEmployeeId: change.selectedItem?.id ?? null,
                  }))
                }
                onInputChange={setReferenceQuery}
                onToggle={(open) => {
                  if (open) setReferenceQuery('');
                }}
                titleText={t('employees.manager')}
              />
              <TextInput
                id="effectiveTo"
                name="effectiveTo"
                labelText={t('employees.effectiveTo')}
                defaultValue={selected?.effectiveTo ?? ''}
              />
              <TextInput
                id="weeklyHours"
                name="weeklyHours"
                labelText={t('employees.weeklyHours')}
                defaultValue={selected?.weeklyHours ?? ''}
              />
              <TextInput
                id="workingTimePattern"
                name="workingTimePattern"
                labelText={t('employees.workingTimePattern')}
                defaultValue={selected?.workingTimePattern ?? ''}
              />
            </Stack>
          </Form>
        </Modal>
        <Modal
          open={relationshipOpen}
          modalHeading={t('employees.addRelationship')}
          primaryButtonText={t('employees.save')}
          secondaryButtonText={t('common.cancel')}
          onRequestClose={() => setRelationshipOpen(false)}
          onRequestSubmit={() =>
            document
              .getElementById('relationship-form')
              ?.dispatchEvent(
                new Event('submit', { bubbles: true, cancelable: true }),
              )
          }
        >
          <Form
            id="relationship-form"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              try {
                const body = createRelationshipSchema.parse({
                  kind: data.get('kind'),
                  position: data.get('position'),
                  department: data.get('department') || null,
                  costCentre: data.get('costCentre') || null,
                  weeklyHours: data.get('weeklyHours'),
                  startDate: data.get('startDate'),
                  endDate: data.get('endDate') || null,
                });
                void sendHrJson(
                  employeeRelationshipsPath(org.organizationId, employeeId),
                  'POST',
                  body,
                  relationshipSchema,
                )
                  .then(() => {
                    setRelationshipOpen(false);
                    notify({ kind: 'success', title: t('employees.save') });
                    load();
                  })
                  .catch(() => setError('general'));
              } catch {
                setError('general');
              }
            }}
          >
            <Stack gap={3}>
              {error && (
                <InlineNotification
                  kind="error"
                  title={t('employees.mutationError')}
                  hideCloseButton
                />
              )}
              <Select
                id="relationship-kind"
                name="kind"
                labelText={t('employees.kind')}
                defaultValue="employment"
              >
                <SelectItem
                  value="employment"
                  text={t('employees.employmentKind')}
                />
                <SelectItem value="dpp" text={t('employees.dpp')} />
                <SelectItem value="dpc" text={t('employees.dpc')} />
                <SelectItem value="executive" text={t('employees.executive')} />
              </Select>
              <TextInput
                id="relationship-position"
                name="position"
                labelText={t('employees.position')}
              />
              <TextInput
                id="relationship-department"
                name="department"
                labelText={t('employees.department')}
              />
              <TextInput
                id="relationship-cost-centre"
                name="costCentre"
                labelText={t('employees.costCentre')}
              />
              <TextInput
                id="relationship-hours"
                name="weeklyHours"
                labelText={t('employees.weeklyHours')}
              />
              <TextInput
                id="relationship-start"
                name="startDate"
                labelText={t('employees.startDate')}
              />
              <TextInput
                id="relationship-end"
                name="endDate"
                labelText={t('employees.effectiveTo')}
              />
            </Stack>
          </Form>
        </Modal>
      </Stack>
    </PageContainer>
  );
}
