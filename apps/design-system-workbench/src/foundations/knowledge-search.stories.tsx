import { Tile } from '@bap/design-system/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';

import { loadKnowledgeDocuments } from './knowledge-documents.js';
import {
  LocalKnowledgeBase,
  type KnowledgeDocument,
} from './knowledge-search.js';

const meta = {
  component: LocalKnowledgeBase,
  title: 'Foundations/Knowledge base',
} satisfies Meta<typeof LocalKnowledgeBase>;

export default meta;
type Story = StoryObj<typeof meta>;

function KnowledgeBaseStory() {
  const [documents, setDocuments] = useState<readonly KnowledgeDocument[]>([]);
  useEffect(() => {
    void loadKnowledgeDocuments().then(setDocuments);
  }, []);
  return documents.length ? (
    <LocalKnowledgeBase documents={documents} />
  ) : (
    <p>Loading local handbook.</p>
  );
}

export const LocalHandbook: Story = {
  args: { documents: [] },
  render: () => (
    <Tile>
      <KnowledgeBaseStory />
    </Tile>
  ),
};
