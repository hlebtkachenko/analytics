export interface PromptSection {
  content: string;
  title: string;
}

// Renders titled sections into one prompt and drops the sections with no content.
export function assemblePrompt(sections: readonly PromptSection[]): string {
  return sections
    .map((section) => ({
      content: section.content.trim(),
      title: section.title.trim(),
    }))
    .filter((section) => section.content.length > 0)
    .map((section) =>
      section.title.length === 0
        ? section.content
        : `## ${section.title}\n\n${section.content}`,
    )
    .join('\n\n');
}
