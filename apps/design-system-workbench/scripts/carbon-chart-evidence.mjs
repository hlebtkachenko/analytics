import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const designSystemRequire = createRequire(
  resolve(import.meta.dirname, '../../../packages/design-system/package.json'),
);
const chartsReactPackage = designSystemRequire.resolve(
  '@carbon/charts-react/package.json',
);
const chartsRequire = createRequire(chartsReactPackage);
const chartsPackage = chartsRequire.resolve('@carbon/charts/package.json');

export async function installedEdgeVariants() {
  const css = await readFile(
    resolve(dirname(chartsPackage), 'styles.css'),
    'utf8',
  );
  const variants = [
    ...new Set(
      [...css.matchAll(/\.cds--cc--edge--([a-z0-9-]+)/g)].map(
        (match) => match[1],
      ),
    ),
  ];
  if (!variants.length) {
    throw new Error('Installed Carbon Charts CSS has no Edge variants.');
  }
  const sizeOrder = new Map(
    ['sm', 'md', 'lg', 'xl'].map((size, index) => [size, index]),
  );
  return variants.sort((left, right) => {
    const leftSize = left.startsWith('dash-')
      ? sizeOrder.get(left.slice(5))
      : undefined;
    const rightSize = right.startsWith('dash-')
      ? sizeOrder.get(right.slice(5))
      : undefined;
    if (leftSize !== undefined && rightSize !== undefined)
      return leftSize - rightSize;
    if (leftSize !== undefined) return -1;
    if (rightSize !== undefined) return 1;
    return left.localeCompare(right);
  });
}
