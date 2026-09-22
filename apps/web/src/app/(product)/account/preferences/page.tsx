import PageContainer from '../../../../components/page-container';
import {
  readRailPinned,
  readThemeMode,
} from '../../../../lib/preferences/server';
import PreferencesView from './preferences-view';

export default async function AccountPreferencesPage() {
  const [themeMode, railPinned] = await Promise.all([
    readThemeMode(),
    readRailPinned(),
  ]);

  return (
    <PageContainer>
      <PreferencesView railPinned={railPinned} themeMode={themeMode} />
    </PageContainer>
  );
}
