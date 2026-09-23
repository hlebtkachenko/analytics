import ReferencePage from '../reference-page';
import PageContainer from '../../../../components/page-container';
export default function DocumentsSettingsPage() {
  return (
    <PageContainer>
      <ReferencePage structure={false} collection="document-categories" />
    </PageContainer>
  );
}
