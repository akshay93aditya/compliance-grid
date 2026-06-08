import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  type AgentContract,
  type AgentRunnerClient,
  callAgent,
  toolInputSchema,
} from './contract';

// Helper: build a mock AgentRunnerClient from a fake messages.create response.
// The `as unknown as` cast is the standard pattern for stubbing SDK clients
// whose real types have many overloads vitest mocks can't reproduce.
function mockClient(response: unknown): AgentRunnerClient {
  return {
    messages: {
      create: vi.fn().mockResolvedValue(response),
    },
  } as unknown as AgentRunnerClient;
}

const TestInput = z.object({ query: z.string().min(1) });
const TestOutput = z.object({ answer: z.string().min(1), score: z.number() });

const testContract: AgentContract<
  z.infer<typeof TestInput>,
  z.infer<typeof TestOutput>
> = {
  name: 'test-agent',
  model: 'claude-haiku-4-5-20251001',
  systemPrompt: 'You are a test agent.',
  tool: {
    name: 'submit_answer',
    description: 'Submit the test answer.',
    input_schema: toolInputSchema(TestOutput),
  },
  inputSchema: TestInput,
  outputSchema: TestOutput,
  formatUserMessage: (input) => `Query: ${input.query}`,
};

describe('callAgent', () => {
  it('parses input, calls the client, and returns Zod-validated output', async () => {
    const client = mockClient({
      content: [
        {
          type: 'tool_use',
          id: 'tu_1',
          name: 'submit_answer',
          input: { answer: '42', score: 0.97 },
        },
      ],
      stop_reason: 'tool_use',
    });

    const result = await callAgent(client, testContract, { query: 'test' });
    expect(result.answer).toBe('42');
    expect(result.score).toBe(0.97);
    expect(client.messages.create).toHaveBeenCalledOnce();
  });

  it('rejects input that fails the inputSchema', async () => {
    const client = mockClient(undefined);
    await expect(callAgent(client, testContract, { query: '' })).rejects.toThrow();
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it('rejects output that fails the outputSchema', async () => {
    const client = mockClient({
      content: [
        {
          type: 'tool_use',
          id: 'tu_1',
          name: 'submit_answer',
          input: { answer: '', score: 0.5 },
        },
      ],
      stop_reason: 'tool_use',
    });
    await expect(callAgent(client, testContract, { query: 'test' })).rejects.toThrow();
  });

  it('throws if the response has no matching tool_use block', async () => {
    const client = mockClient({
      content: [{ type: 'text', text: 'I refuse to use the tool.' }],
      stop_reason: 'end_turn',
    });
    await expect(callAgent(client, testContract, { query: 'test' })).rejects.toThrow(
      /no tool_use block/
    );
  });

  it('throws if the tool_use block name does not match', async () => {
    const client = mockClient({
      content: [
        {
          type: 'tool_use',
          id: 'tu_1',
          name: 'other_tool',
          input: { answer: '42', score: 1 },
        },
      ],
      stop_reason: 'tool_use',
    });
    await expect(callAgent(client, testContract, { query: 'test' })).rejects.toThrow();
  });
});

describe('toolInputSchema', () => {
  it('produces JSON Schema with required fields and types', () => {
    const json = toolInputSchema(TestOutput);
    expect(json).toMatchObject({
      type: 'object',
      properties: expect.any(Object),
      required: expect.arrayContaining(['answer', 'score']),
    });
  });
});
