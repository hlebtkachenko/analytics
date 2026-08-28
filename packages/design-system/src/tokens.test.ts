import { describe, expect, it } from 'vitest';
import * as carbonCharts from '@carbon/charts-react';
import * as carbonIcons from '@carbon/icons-react';
import * as carbonReact from '@carbon/react';
import { compileString } from 'sass';

import * as bapCharts from './charts.js';
import * as bapIcons from './icons.js';
import * as bapReact from './react.js';
import {
  carbonChartComponents,
  carbonChartDiagramPrimitives,
  carbonChartExperimentalComponents,
  carbonComponentFamilies,
  carbonSpacingTokens,
  carbonThemes,
  carbonTypographyTokens,
} from './tokens.js';

describe('Carbon metadata', () => {
  it('exposes the official themes and full spacing scale', () => {
    expect(carbonThemes).toEqual(['white', 'g10', 'g90', 'g100']);
    expect(carbonSpacingTokens).toHaveLength(13);
  });

  it('matches the installed Carbon typography token map', () => {
    const source = `
      @use 'sass:map';
      @use '@carbon/type/scss/styles' as styles;
      :root { --tokens: "#{map.keys(styles.$tokens)}"; }
    `;
    const css = compileString(source, { loadPaths: ['node_modules'] }).css;
    const upstreamTokens = css.match(/--tokens: "([^"]+)"/)?.[1]?.split(', ');

    expect(carbonTypographyTokens).toEqual(upstreamTokens);
  });

  it('keeps the installed React public API available through the facade', () => {
    expect(Object.keys(carbonReact)).toHaveLength(367);
    expect(Object.keys(bapReact).sort()).toEqual(
      Object.keys(carbonReact)
        .filter((key) => key !== 'default')
        .sort(),
    );

    for (const component of ['Button', 'DataTable', 'Grid', 'Table', 'Theme']) {
      expect(bapReact).toHaveProperty(component);
    }
  });

  it('keeps the installed icon public API available through the facade', () => {
    expect(Object.keys(bapIcons).sort()).toEqual(
      Object.keys(carbonIcons)
        .filter((key) => key !== 'default')
        .sort(),
    );
  });

  it('records source component families and all chart components', () => {
    expect(carbonComponentFamilies).toContain('DataTable');

    for (const chart of carbonChartComponents) {
      expect(bapCharts).toHaveProperty(chart);
    }

    for (const chart of [
      ...carbonChartDiagramPrimitives,
      ...carbonChartExperimentalComponents,
    ]) {
      expect(bapCharts).toHaveProperty(chart);
    }

    expect(Object.keys(bapCharts)).toEqual(
      expect.arrayContaining(Object.keys(carbonCharts)),
    );
  });
});
