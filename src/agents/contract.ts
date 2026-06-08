import type Anthropic from '@anthropic-ai/sdk';
import { z, type ZodType } from 'zod';

// Per docs/specs/06-tech-stack.md: "AI lives behind contracts. Every AI call
// goes through a wrapper that enforces the agent's input/output schema and
// rejects off-schema output. AI output is never trusted directly."
//
// This module provides the generic contract + runner. Agents (Discovery,
// Extraction, Projection) define one AgentContract each.

// Matches Anthropic's Tool.input_schema shape: a JSON Schema object with the
// `type: 'object'` discriminator. Zod's z.toJSONSchema on a z.object emits
// exactly this shape, so toolInputSchema below produces compatible values.
export interface ToolInputSchema {
  type: 'object';
  [key: string]: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: ToolInputSchema;
}

export interface AgentContract<I, O> {
  name: string;
  model: string;
  systemPrompt: string;
  tool: ToolDefinition;
  inputSchema: ZodType<I>;
  outputSchema: ZodType<O>;
  formatUserMessage: (input: I) => string;
  maxTokens?: number;
}

// The slice of the Anthropic client that callAgent uses. A real Anthropic
// instance satisfies this; tests pass a structurally-compatible mock cast
// via `as unknown as AgentRunnerClient`.
export type AgentRunnerClient = Pick<Anthropic, 'messages'>;

export async function callAgent<I, O>(
  client: AgentRunnerClient,
  contract: AgentContract<I, O>,
  input: I
): Promise<O> {
  // Validate caller's input against the contract. This catches bugs in the
  // calling code, not AI output.
  const parsedInput = contract.inputSchema.parse(input);

  const response = (await client.messages.create({
    model: contract.model,
    max_tokens: contract.maxTokens ?? 1024,
    system: contract.systemPrompt,
    tools: [contract.tool],
    tool_choice: { type: 'tool', name: contract.tool.name },
    messages: [
      {
        role: 'user',
        content: contract.formatUserMessage(parsedInput),
      },
    ],
  })) as Anthropic.Messages.Message;

  const toolUse = response.content.find(
    (c): c is Anthropic.Messages.ToolUseBlock =>
      c.type === 'tool_use' && c.name === contract.tool.name
  );

  if (!toolUse) {
    throw new Error(
      `callAgent(${contract.name}): no tool_use block with name "${contract.tool.name}" in response`
    );
  }

  // Validate AI output against the contract. Anything off-schema is rejected.
  return contract.outputSchema.parse(toolUse.input);
}

// Convenience: derive a tool input_schema from a Zod object schema.
// Anthropic's tool use accepts JSON Schema draft 2020-12 with a top-level
// type: 'object'; z.toJSONSchema on a z.object produces exactly that.
export function toolInputSchema(schema: ZodType): ToolInputSchema {
  const json = z.toJSONSchema(schema) as { type?: unknown } & Record<string, unknown>;
  if (json.type !== 'object') {
    throw new Error(
      `toolInputSchema expects a Zod object schema (got type ${JSON.stringify(json.type)})`
    );
  }
  return json as ToolInputSchema;
}
