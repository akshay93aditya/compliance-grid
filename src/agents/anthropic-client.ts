import Anthropic from '@anthropic-ai/sdk';

// Lazy singleton Anthropic client. Reads ANTHROPIC_API_KEY on first call so
// the module can be imported in environments where the key is not configured
// (unit tests that pass a mock client to callAgent).
let _client: Anthropic | undefined;

export function getAnthropicClient(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. See .env.example for the expected format.'
    );
  }
  _client = new Anthropic({ apiKey });
  return _client;
}
