export {
  carbonChartComponents,
  carbonChartDiagramPrimitives,
  carbonChartExperimentalComponents,
  carbonColorTokens,
  carbonComponentFamilies,
  carbonFeatureFlagDefaults,
  carbonFeatureFlagProviderProps,
  carbonFeatureFlags,
  carbonFonts,
  carbonLayoutTokens,
  carbonMotionTokens,
  carbonSpacingTokens,
  carbonThemeTokens,
  carbonThemes,
  carbonTypographyTokens,
  carbonTypeTokens,
} from '@bap/design-system';

import {
  carbonChartComponents,
  carbonChartDiagramPrimitives,
  carbonChartExperimentalComponents,
  carbonComponentFamilies,
  carbonThemes,
} from '@bap/design-system';

export const catalogSummary = {
  charts:
    carbonChartComponents.length + carbonChartExperimentalComponents.length,
  components: carbonComponentFamilies.length,
  diagrams: carbonChartDiagramPrimitives.length,
  themes: carbonThemes.length,
};
