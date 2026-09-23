'use client';
import {
  Button,
  Form,
  InlineNotification,
  Stack,
  TextInput,
  Select,
  SelectItem,
} from '@bap/design-system/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import PageContainer from '../../../../components/page-container';
import {
  employeesPath,
  sendHrJson,
  withOrganization,
} from '../../../../lib/hr/client';
import { employeeSchema } from '../../../../lib/hr/contract';
import { useOrganizationSelection } from '../../../../lib/organizations/use-organization-selection';
import { useOrganizationAccess } from '../../../../lib/organizations/use-organization-access';
import { useLegalEntities } from '../../../../lib/organizations/use-legal-entities';
export default function NewEmployeePage() {
  const { t } = useTranslation();
  const router = useRouter();
  const organization = useOrganizationSelection();
  const { access } = useOrganizationAccess(organization.organizationId);
  const entities = useLegalEntities(organization.organizationId);
  const [error, setError] = useState(false);
  const submit = (form: HTMLFormElement) => {
    if (!access?.capabilities.manageHr) return;
    const data = new FormData(form);
    void sendHrJson(
      employeesPath(organization.organizationId),
      'POST',
      {
        legalEntityId: data.get('legalEntityId'),
        employeeNumber: data.get('employeeNumber'),
        firstName: data.get('firstName'),
        lastName: data.get('lastName'),
      },
      employeeSchema,
    )
      .then((employee) =>
        router.push(
          withOrganization(
            `/employees/${employee.id}`,
            organization.slug,
          ) as never,
        ),
      )
      .catch(() => setError(true));
  };
  return (
    <PageContainer>
      {access === undefined ? (
        <p>{t('employees.loading')}</p>
      ) : !access.capabilities.manageHr ? (
        <InlineNotification
          kind="error"
          title={t('employees.denied')}
          hideCloseButton
        />
      ) : (
        <Form
          onSubmit={(event) => {
            event.preventDefault();
            submit(event.currentTarget);
          }}
        >
          <Stack gap={5}>
            {error && (
              <InlineNotification
                kind="error"
                title={t('employees.createError')}
                hideCloseButton
              />
            )}
            <Select
              id="legalEntityId"
              name="legalEntityId"
              labelText={t('employees.legalEntity')}
              required
            >
              <SelectItem value="" text={t('employees.allEntities')} />
              {entities.map((entity) => (
                <SelectItem
                  key={entity.id}
                  value={entity.id}
                  text={entity.name}
                />
              ))}
            </Select>
            <TextInput
              id="employeeNumber"
              name="employeeNumber"
              labelText={t('employees.employeeNumber')}
              required
            />
            <TextInput
              id="firstName"
              name="firstName"
              labelText={t('employees.firstName')}
              required
            />
            <TextInput
              id="lastName"
              name="lastName"
              labelText={t('employees.lastName')}
              required
            />
            <Button type="submit">{t('employees.create')}</Button>
          </Stack>
        </Form>
      )}
    </PageContainer>
  );
}
