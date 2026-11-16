import test from 'node:test';
import assert from 'node:assert/strict';
import { translateWithOpenAI } from '../adapters/openai.mjs';

const input = { sourceLanguage: 'en', targetLanguage: 'zh-Hant', items: [{ id: 'title', text: 'Quiet light' }] };
const config = { apiKey: 'test-only', model: 'configured-model' };

test('optional adapter requests structured output and reads message text without depending on SDK helpers', async () => {
  const result = await translateWithOpenAI(input, { ...config, request: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(options.body);
    assert.equal(body.store, false);
    assert.equal(body.model, config.model);
    assert.deepEqual(body.text.format.schema.properties.translations.required, ['title']);
    return { ok: true, json: async () => ({ status: 'completed', output: [
      { type: 'reasoning', summary: [] },
      { type: 'message', content: [{ type: 'output_text', text: '{"translations":{"title":"靜謐的光"}}' }] },
    ] }) };
  } });
  assert.equal(result.translations.title, '靜謐的光');
});

test('optional adapter rejects incomplete responses, refusals, and missing fields', async () => {
  for (const result of [
    { status: 'incomplete', output: [] },
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] },
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"translations":{}}' }] }] },
  ]) await assert.rejects(translateWithOpenAI(input, { ...config, request: async () => ({ ok: true, json: async () => result }) }));
});
