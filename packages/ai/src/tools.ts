import type { ToolSet } from 'ai';

// Consumers build tools with the SDK helper, so it is re-exported beside the registry.
export { tool, type Tool, type ToolSet } from 'ai';

// A registry entry is any tool the SDK accepts inside a tool set.
export type AiTool = ToolSet[string];

export type EmptyAiToolSet = Record<string, never>;

export interface AiToolRegistry<TOOLS extends ToolSet> {
  get<NAME extends keyof TOOLS & string>(name: NAME): TOOLS[NAME];
  has(name: string): boolean;
  readonly names: readonly (keyof TOOLS & string)[];
  register<NAME extends string, TOOL extends AiTool>(
    name: NAME,
    definition: TOOL,
  ): AiToolRegistry<TOOLS & Record<NAME, TOOL>>;
  readonly tools: TOOLS;
}

function buildRegistry<TOOLS extends ToolSet>(
  tools: TOOLS,
): AiToolRegistry<TOOLS> {
  return {
    get<NAME extends keyof TOOLS & string>(name: NAME): TOOLS[NAME] {
      const found = tools[name];

      if (found === undefined) {
        throw new Error(`AI tool ${name} is not registered.`);
      }

      return found;
    },

    has(name: string): boolean {
      return Object.hasOwn(tools, name);
    },

    names: Object.keys(tools) as readonly (keyof TOOLS & string)[],

    register<NAME extends string, TOOL extends AiTool>(
      name: NAME,
      definition: TOOL,
    ): AiToolRegistry<TOOLS & Record<NAME, TOOL>> {
      if (Object.hasOwn(tools, name)) {
        throw new Error(`AI tool ${name} is already registered.`);
      }

      return buildRegistry({ ...tools, [name]: definition } as TOOLS &
        Record<NAME, TOOL>);
    },

    tools,
  };
}

// The registry ships empty because every tool carries product knowledge.
export function createAiToolRegistry(): AiToolRegistry<EmptyAiToolSet> {
  return buildRegistry<EmptyAiToolSet>({});
}
