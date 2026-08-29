import {
  ArrowLeftMarker,
  ArrowRightMarker,
  CardNode,
  CardNodeColumn,
  CardNodeLabel,
  CardNodeSubtitle,
  CardNodeTitle,
  CircleMarker,
  DiamondMarker,
  Edge,
  Marker,
  ShapeNode,
  SquareMarker,
  TeeMarker,
} from '@bap/design-system/charts';
import { Heading, Stack, Tile } from '@bap/design-system/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';

import { DiagramPropVariants } from './diagram-prop-variants.js';

const meta = {
  component: Tile,
  title: 'Charts/Diagram primitives',
} satisfies Meta<typeof Tile>;
export default meta;
type Story = StoryObj<typeof meta>;

function Definition({
  children,
  name,
}: Readonly<{ children: ReactNode; name: string }>) {
  return (
    <Stack gap={5}>
      <Heading>{name}</Heading>
      <Tile>{children}</Tile>
    </Stack>
  );
}

function MarkerPreview({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <svg
      aria-label="Marker preview"
      height="100"
      role="img"
      viewBox="0 0 300 100"
      width="300"
    >
      <defs>{children}</defs>
      <path
        d="M30 50H260"
        markerEnd="url(#marker)"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

function EdgePreview({ variant }: Readonly<{ variant?: string }>) {
  return (
    <svg
      aria-label="Edge preview"
      height="100"
      role="img"
      viewBox="0 0 300 100"
      width="300"
    >
      <Edge
        source={{ x: 30, y: 50 }}
        target={{ x: 260, y: 50 }}
        {...(variant ? { variant } : {})}
      />
    </svg>
  );
}

function edgeStory(name: string, variant: string): Story {
  return {
    render: () => (
      <Definition name={name}>
        <EdgePreview variant={variant} />
      </Definition>
    ),
  };
}

export const ArrowLeft: Story = {
  render: () => (
    <Definition name="Arrow left marker">
      <MarkerPreview>
        <ArrowLeftMarker id="marker" />
      </MarkerPreview>
    </Definition>
  ),
};
export const ArrowRight: Story = {
  render: () => (
    <Definition name="Arrow right marker">
      <MarkerPreview>
        <ArrowRightMarker id="marker" />
      </MarkerPreview>
    </Definition>
  ),
};
export const Circle: Story = {
  render: () => (
    <Definition name="Circle marker">
      <MarkerPreview>
        <CircleMarker id="marker" />
      </MarkerPreview>
    </Definition>
  ),
};
export const Diamond: Story = {
  render: () => (
    <Definition name="Diamond marker">
      <MarkerPreview>
        <DiamondMarker id="marker" />
      </MarkerPreview>
    </Definition>
  ),
};
export const Square: Story = {
  render: () => (
    <Definition name="Square marker">
      <MarkerPreview>
        <SquareMarker id="marker" />
      </MarkerPreview>
    </Definition>
  ),
};
export const Tee: Story = {
  render: () => (
    <Definition name="Tee marker">
      <MarkerPreview>
        <TeeMarker id="marker" />
      </MarkerPreview>
    </Definition>
  ),
};
export const CustomMarker: Story = {
  render: () => (
    <Definition name="Marker">
      <MarkerPreview>
        <Marker d="M0,0 L10,5 L0,10 z" id="marker" />
      </MarkerPreview>
    </Definition>
  ),
};
export const EdgePrimitive: Story = {
  render: () => (
    <Definition name="Edge">
      <EdgePreview />
    </Definition>
  ),
};
export const EdgeDashSmall = edgeStory('Edge dash small', 'dash-sm');
export const EdgeDashMedium = edgeStory('Edge dash medium', 'dash-md');
export const EdgeDashLarge = edgeStory('Edge dash large', 'dash-lg');
export const EdgeDashExtraLarge = edgeStory('Edge dash extra large', 'dash-xl');
export const EdgeDouble = edgeStory('Edge double', 'double');
export const EdgeTunnel = edgeStory('Edge tunnel', 'tunnel');

export const ShapeCircle: Story = {
  render: () => (
    <Definition name="Shape node circle">
      <ShapeNode
        bodyPosition="static"
        description="Neutral diagram node"
        position="relative"
        renderIcon={<span aria-hidden>●</span>}
        shape="circle"
        title="Shape"
      />
    </Definition>
  ),
};
export const ShapeSquareButton: Story = {
  render: () => (
    <Definition name="Shape node square button">
      <ShapeNode
        bodyPosition="static"
        description="Neutral diagram node"
        onClick={() => undefined}
        position="relative"
        renderIcon={<span aria-hidden>●</span>}
        shape="square"
        tag="button"
        title="Shape button"
      />
    </Definition>
  ),
};
export const ShapeRoundedSquareLink: Story = {
  render: () => (
    <Definition name="Shape node rounded square link">
      <ShapeNode
        bodyPosition="static"
        description="Neutral diagram node"
        href="#shape-node"
        position="relative"
        renderIcon={<span aria-hidden>●</span>}
        shape="rounded-square"
        tag="a"
        title="Shape link"
      />
    </Definition>
  ),
};
export const Card: Story = {
  render: () => (
    <Definition name="Card node">
      <CardNode>
        <CardNodeTitle>Card title</CardNodeTitle>
        <CardNodeSubtitle>Card subtitle</CardNodeSubtitle>
        <CardNodeLabel>Card label</CardNodeLabel>
      </CardNode>
    </Definition>
  ),
};
export const CardButton: Story = {
  render: () => (
    <Definition name="Card node button">
      <CardNode onClick={() => undefined} tag="button">
        <CardNodeTitle>Card button</CardNodeTitle>
      </CardNode>
    </Definition>
  ),
};
export const CardLink: Story = {
  render: () => (
    <Definition name="Card node link">
      <CardNode href="#card-node" tag="a">
        <CardNodeTitle>Card link</CardNodeTitle>
      </CardNode>
    </Definition>
  ),
};
export const CardStacked: Story = {
  render: () => (
    <Definition name="Card node stacked color">
      <CardNode color="var(--cds-link-primary)" stacked>
        <CardNodeTitle>Card title</CardNodeTitle>
        <CardNodeSubtitle>Stacked layout</CardNodeSubtitle>
      </CardNode>
    </Definition>
  ),
};
export const CardColumn: Story = {
  render: () => (
    <Definition name="Card node column">
      <CardNode>
        <CardNodeColumn>Primary column</CardNodeColumn>
        <CardNodeColumn farsideColumn>Secondary column</CardNodeColumn>
      </CardNode>
    </Definition>
  ),
};
export const CardTitle: Story = {
  render: () => (
    <Definition name="Card node title">
      <CardNode>
        <CardNodeTitle>Card title</CardNodeTitle>
      </CardNode>
    </Definition>
  ),
};
export const CardSubtitle: Story = {
  render: () => (
    <Definition name="Card node subtitle">
      <CardNode>
        <CardNodeSubtitle>Card subtitle</CardNodeSubtitle>
      </CardNode>
    </Definition>
  ),
};
export const CardLabel: Story = {
  render: () => (
    <Definition name="Card node label">
      <CardNode>
        <CardNodeLabel>Card label</CardNodeLabel>
      </CardNode>
    </Definition>
  ),
};

export const AllPropLiterals: Story = {
  render: () => <DiagramPropVariants />,
};
