import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createAiToolRegistry, tool } from './tools.js';

const echoInputSchema = z.object({ value: z.string().min(1) });

const echo = tool({
  description: 'Return the received value.',
  execute: (input: { value: string }) => input.value,
  inputSchema: echoInputSchema,
});

const count = tool({
  description: 'Return the length of the received value.',
  execute: (input: { value: string }) => input.value.length,
  inputSchema: z.object({ value: z.string().min(1) }),
});

describe('createAiToolRegistry', () => {
  it('ships without tools', () => {
    const registry = createAiToolRegistry();

    expect(registry.names).toEqual([]);
    expect(registry.tools).toEqual({});
  });

  it('registers and looks a tool up by name', () => {
    const registry = createAiToolRegistry().register('echo', echo);

    expect(registry.get('echo')).toBe(echo);
    expect(registry.has('echo')).toBe(true);
    expect(registry.names).toEqual(['echo']);
  });

  it('keeps the zod input schema on the registered tool', async () => {
    const registry = createAiToolRegistry().register('echo', echo);
    const registered = registry.get('echo');

    expect(registered.inputSchema).toBe(echoInputSchema);
    await expect(echoInputSchema.parseAsync({ value: '' })).rejects.toThrow();
    await expect(
      echoInputSchema.parseAsync({ value: 'ping' }),
    ).resolves.toEqual({ value: 'ping' });
  });

  it('keeps earlier registrations when a tool is added', () => {
    const registry = createAiToolRegistry()
      .register('echo', echo)
      .register('count', count);

    expect(registry.names).toEqual(['echo', 'count']);
    expect(registry.get('count')).toBe(count);
    expect(registry.tools).toEqual({ count, echo });
  });

  it('leaves the source registry unchanged', () => {
    const empty = createAiToolRegistry();
    empty.register('echo', echo);

    expect(empty.names).toEqual([]);
  });

  it('refuses a duplicate tool name', () => {
    const registry = createAiToolRegistry().register('echo', echo);

    expect(() => registry.register('echo', count)).toThrow(
      'already registered',
    );
  });

  it('refuses a lookup for an unregistered tool', () => {
    const registry = createAiToolRegistry().register('echo', echo);

    expect(registry.has('count')).toBe(false);
    expect(() => registry.get('count' as 'echo')).toThrow('not registered');
  });
});
