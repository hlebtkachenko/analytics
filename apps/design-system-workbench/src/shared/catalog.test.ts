import {
  carbonChartComponents,
  carbonChartDiagramPrimitives,
  carbonChartExperimentalComponents,
  carbonComponentFamilies,
  carbonFeatureFlagDefaults,
  carbonFeatureFlagProviderProps,
  carbonFeatureFlags,
  carbonThemes,
} from '@bap/design-system';
import { describe, expect, it } from 'vitest';

import { catalogSummary } from './catalog.js';

describe('workbench catalog', () => {
  it('uses compact public summaries without eagerly importing the full catalog', () => {
    expect(catalogSummary).toEqual({
      charts:
        carbonChartComponents.length + carbonChartExperimentalComponents.length,
      components: carbonComponentFamilies.length,
      diagrams: carbonChartDiagramPrimitives.length,
      themes: carbonThemes.length,
    });
  });

  it('keeps installed defaults and actual provider controls distinct', () => {
    expect(carbonFeatureFlagDefaults).toEqual({
      'enable-css-custom-properties': true,
      'enable-css-grid': true,
      'enable-dialog-element': false,
      'enable-enhanced-file-uploader': false,
      'enable-experimental-focus-wrap-without-sentinels': false,
      'enable-experimental-tile-contrast': false,
      'enable-focus-wrap-without-sentinels': false,
      'enable-presence': false,
      'enable-tile-contrast': false,
      'enable-treeview-controllable': false,
      'enable-v11-release': true,
      'enable-v12-dynamic-floating-styles': false,
      'enable-v12-overflowmenu': false,
      'enable-v12-release': false,
      'enable-v12-structured-list-visible-icons': false,
      'enable-v12-tile-default-icons': false,
      'enable-v12-tile-radio-icons': false,
      'enable-v12-toggle-reduced-label-spacing': false,
    });
    expect(carbonFeatureFlags).toHaveLength(18);
    expect(carbonFeatureFlagProviderProps.map((flag) => flag.name)).toEqual([
      'enableDialogElement',
      'enableEnhancedFileUploader',
      'enableExperimentalFocusWrapWithoutSentinels',
      'enableFocusWrapWithoutSentinels',
      'enablePresence',
      'enableTreeviewControllable',
      'enableV12DynamicFloatingStyles',
      'enableV12Overflowmenu',
      'enableV12Release',
      'enableV12TileDefaultIcons',
      'enableV12TileRadioIcons',
    ]);
    expect(
      carbonFeatureFlagProviderProps.every(
        (flag) =>
          carbonFeatureFlagDefaults[flag.flag] === flag.defaultValue &&
          carbonFeatureFlags.some(
            (installed) => installed.providerProp === flag.name,
          ),
      ),
    ).toBe(true);
  });
});
