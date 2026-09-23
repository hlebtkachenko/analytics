import ReferencePage from '../reference-page';
import PageContainer from '../../../../components/page-container';
export default function StructurePage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  return <Structure searchParams={searchParams} />;
}
async function Structure({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const { kind } = await searchParams;
  return (
    <PageContainer>
      <ReferencePage
        structure
        collection={
          kind === 'positions' ||
          kind === 'cost-centres' ||
          kind === 'workplaces'
            ? kind
            : 'departments'
        }
      />
    </PageContainer>
  );
}
