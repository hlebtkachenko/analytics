export type SourceCompositionContract = Readonly<{
  descriptor: string;
  fingerprint: string;
  fingerprints: readonly SourceCompositionFingerprint[];
  selector: string;
  sourceId: string;
  text: string | null;
}>;

export type SourceCompositionFingerprint = Readonly<{
  minimum?: number;
  selector: string;
  text?: string;
}>;

function contract(
  sourceId: string,
  descriptor: string,
  selector: string,
  text: string | null,
  fingerprints: readonly SourceCompositionFingerprint[] = [
    { selector, ...(text ? { text } : {}) },
  ],
): SourceCompositionContract {
  return {
    descriptor,
    fingerprint: `${sourceId}::${descriptor}`,
    fingerprints,
    selector,
    sourceId,
    text,
  };
}

export function sourceCompositionContract(
  sourceId: string,
  descriptor: string,
): SourceCompositionContract {
  const name = sourceId.split('#')[1] ?? '';
  const normalized = name.replaceAll(/[^a-zA-Z0-9]+/g, '').toLowerCase();
  if (descriptor.startsWith('grid-')) {
    const text = normalized.includes('offset')
      ? 'Small offset'
      : normalized.includes('subgrid')
        ? 'Subgrid parent'
        : normalized.includes('gutter')
          ? 'Mixed gutter'
          : normalized.includes('settings')
            ? 'Grid settings'
            : normalized.includes('auto')
              ? 'Auto column'
              : 'Small span';
    return contract(sourceId, descriptor, '[class*="grid"]', text, [
      {
        minimum: normalized.includes('subgrid') ? 2 : 1,
        selector: '[class*="grid"]',
        text,
      },
      ...(normalized.includes('offset')
        ? [
            {
              minimum: 2,
              selector: sourceId.includes('/FlexGrid.')
                ? '[class*="offset-sm-"]'
                : '[class*="\\:col-start-"]',
              text: 'Small offset',
            },
          ]
        : []),
    ]);
  }
  if (descriptor.startsWith('tabs-')) {
    return contract(sourceId, descriptor, '[role="tablist"]', 'Overview', [
      { selector: '[role="tablist"]', text: 'Overview' },
      { selector: '[role="tabpanel"]', text: 'Overview panel' },
      ...(normalized.includes('vertical')
        ? [{ selector: '[class*="vertical"]', text: 'Overview' }]
        : []),
      ...(normalized.includes('contained')
        ? [{ selector: '[class*="contained"]', text: 'Overview' }]
        : []),
      ...(normalized.includes('icon')
        ? [
            {
              selector: 'svg[role="img"][aria-label$=" icon"] > circle',
              minimum: 4,
            },
          ]
        : []),
    ]);
  }
  if (descriptor.startsWith('card-')) {
    const text = normalized.includes('minimal')
      ? 'Minimal card content'
      : 'Card title';
    return contract(sourceId, descriptor, '[class*="card"]', text, [
      { selector: '[class*="card"]', text },
      ...(/media|video/.test(normalized)
        ? [
            {
              selector: '[class*="card"]',
              text: normalized.includes('video') ? 'Video media' : 'Card media',
            },
          ]
        : []),
      ...(normalized.includes('ailabel')
        ? [{ selector: '[class*="ai-label"]', minimum: 1 }]
        : []),
    ]);
  }
  if (descriptor.startsWith('data-table-')) {
    const selector =
      normalized.includes('toolbar') || normalized.includes('overflow')
        ? '[class*="table-toolbar"]'
        : 'table';
    const text = normalized.includes('expansion')
      ? null
      : normalized.includes('toolbar') || normalized.includes('overflow')
        ? null
        : normalized.includes('ai')
          ? 'AI-assisted table'
          : 'Table row';
    return contract(sourceId, descriptor, selector, text, [
      { selector, ...(text ? { text } : {}) },
      ...(normalized.includes('expansion') ? [{ selector: 'button' }] : []),
      ...(normalized.includes('ai')
        ? [{ selector: '[class*="ai-label"]', minimum: 1 }]
        : []),
    ]);
  }
  if (descriptor.startsWith('slider-')) {
    return contract(sourceId, descriptor, 'input', null, [
      {
        minimum: normalized.includes('twohandle') ? 2 : 1,
        selector: 'input',
      },
      ...(normalized.includes('customvaluelabel')
        ? [{ selector: 'label', text: 'Value level' }]
        : []),
    ]);
  }
  if (descriptor.startsWith('shell-')) {
    const selector =
      normalized.includes('sidenav') && !normalized.startsWith('header')
        ? 'nav'
        : '[role="banner"], header, [class*="header"]';
    return contract(sourceId, descriptor, selector, null, [
      { selector },
      ...(normalized.includes('sidenav') && normalized.startsWith('header')
        ? [{ selector: 'nav' }]
        : []),
      ...(normalized.includes('navigation')
        ? [{ selector: 'nav', text: 'Section' }]
        : []),
      ...(normalized.includes('switcher')
        ? [{ selector: '[class*="switcher"]', text: 'Workspace' }]
        : []),
    ]);
  }
  if (descriptor.startsWith('modal-')) {
    const text = sourceId.includes('/ComposedModal/')
      ? 'Source modal'
      : 'Dialog';
    return contract(sourceId, descriptor, '[role="dialog"]', text, [
      { selector: '[role="dialog"]', text },
    ]);
  }
  if (descriptor.startsWith('tile-')) {
    return contract(sourceId, descriptor, '[class*="tile"]', 'Tile content', [
      { selector: '[class*="tile"]', text: 'Tile content' },
      ...(normalized.includes('interactive')
        ? [{ selector: 'button', text: 'Tile action' }]
        : []),
    ]);
  }
  if (descriptor.startsWith('contained-list-')) {
    const text = normalized.includes('icons') ? 'Item with icon' : 'List item';
    return contract(sourceId, descriptor, '[class*="contained-list"]', text, [
      { selector: '[class*="contained-list"]', text },
      ...(normalized.includes('search') ? [{ selector: 'input' }] : []),
    ]);
  }
  const selectorByDescriptor: Readonly<Record<string, string>> = {
    'accessible-label': '[role="switch"]',
    'action-menu': 'button',
    'ai-decoration': '[class*="ai-label"]',
    'badge-indicator': 'button',
    'component-alignment': '[role="tooltip"], button',
    'component-defaultwithsize20': 'button, svg',
    'component-defaultwithtextsize14': '[class*="shape-indicator"]',
    'component-determinate': '[role="progressbar"]',
    'component-draganddropuploadcontainerexampleapplication': 'button, input',
    'component-draganddropuploadsinglecontainerexampleapplication':
      'button, input',
    'component-duration': '[role="tooltip"], button',
    'component-expandable': 'input',
    'component-experimentalautoalign': 'button',
    'component-interactive': '[class*="progress"]',
    'component-operational': '[class*="tag"]',
    'component-rangewithcalendar': 'input',
    'component-selectable': '[class*="tag"]',
    'component-selectall': 'button',
    'component-selectallwithdynamicitems': 'button',
    'component-simple': 'input',
    'component-single': 'input',
    'component-specificelement': '[role="menu"]',
    'component-tabtip': '[role="dialog"], button',
    'component-usageexamples': 'p',
    'component-uselayer': '[class*="layer"]',
    'component-useprefersdarkscheme': '[class*="cds--g"]',
    'component-uxexample': '[class*="inline-loading"]',
    'component-withbackgroundlayer': '[class*="layer"]',
    'component-withcustomcontext': 'p',
    'component-withdanger': 'button',
    'component-withdividers': 'button',
    'component-withinitialselecteditems': 'button',
    'component-withinteractiveelements': '[role="alert"], button',
    'component-withlargetext': 'button',
    'component-withoutpagesizes': 'select',
    'component-withrenderpageselect': 'span',
    'condensed-density': 'button',
    'direction-context': '[dir="rtl"]',
    'expanded-state': 'input',
    'fluid-layout': 'input',
    'heading-level': 'h1, h5, [class*="layer"]',
    'icon-composition': 'svg',
    'layer-context': '[class*="layer"]',
    'layout-context': 'fieldset, [dir]',
    'link-hierarchy': '[role="tree"]',
    'loading-state': '[role="status"]',
    'overflow-content': 'nav',
    'overlay-state': '[role="dialog"]',
    'range-control': 'input',
    'selection-data': 'button, select',
    'skeleton-layout': '[role="status"], [class*="skeleton"]',
    'theme-context': '[class*="cds--g"]',
    'toggletip-decoration': 'button',
    'tooltip-behavior': '[class*="pagination"]',
    'tree-hierarchy': '[role="tree"]',
    'validation-state': 'input',
  };
  const selector = selectorByDescriptor[descriptor];
  if (!selector) {
    throw new Error(
      `No reviewed source composition contract for ${sourceId} (${descriptor}).`,
    );
  }
  const textByDescriptor: Readonly<Record<string, string>> = {
    'heading-level': sourceId.includes('/Heading/')
      ? 'Project overview'
      : 'Neutral Carbon specimen',
    'overflow-content': normalized.includes('visualsnapshot')
      ? 'Visual snapshot breadcrumb'
      : 'Overflow breadcrumb',
  };
  return contract(
    sourceId,
    descriptor,
    selector,
    textByDescriptor[descriptor] ?? null,
  );
}
