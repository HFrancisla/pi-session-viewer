import { describe, expect, it } from 'vitest'
import capturePrompt from '../src/extension/prompt-capture'

type Handler = (event: any, context: any) => unknown

interface FakePi {
  handlers: Map<string, Handler>
  entries: Array<{ customType: string; data: any }>
  activeTools: string[]
  on(event: string, handler: Handler): void
  appendEntry(customType: string, data: unknown): void
  getActiveTools(): string[]
  getAllTools(): Array<{ name: string; description?: string; parameters?: unknown; promptGuidelines?: string[] }>
}

function fakePi(): FakePi {
  return {
    handlers: new Map(),
    entries: [],
    activeTools: ['bash'],
    on(event, handler) {
      this.handlers.set(event, handler)
    },
    appendEntry(customType, data) {
      this.entries.push({ customType, data })
    },
    getActiveTools() {
      return [...this.activeTools]
    },
    getAllTools() {
      return [
        {
          name: 'bash',
          description: 'Execute shell commands',
          parameters: {
            type: 'object',
            properties: { command: { type: 'string' } },
            required: ['command'],
          },
        },
      ]
    },
  }
}

function context(systemPrompt: string) {
  return {
    model: { provider: 'demo', id: 'model-a' },
    getSystemPrompt: () => systemPrompt,
    sessionManager: {
      getEntries: () => [],
      getBranch: () => [{ type: 'message', id: 'user-1', message: { role: 'user' } }],
    },
  }
}

describe('system prompt capture extension', () => {
  it('persists the final prompt snapshot with its structured composition', async () => {
    const pi = fakePi()
    capturePrompt(pi as never)
    const beforePrompt = 'prompt before later extensions'
    const finalPrompt = 'final effective system prompt'
    const options = {
      customPrompt: 'custom base',
      selectedTools: ['bash'],
      toolSnippets: { bash: 'Execute shell commands' },
      promptGuidelines: ['Use tests first'],
      appendSystemPrompt: 'Keep evidence concise',
      cwd: '/work/demo',
      contextFiles: [{ path: '/work/demo/AGENTS.md', content: 'Use tests first.' }],
      skills: [{ name: 'tdd', description: 'Test-first development', filePath: '/skills/tdd/SKILL.md', baseDir: '/skills/tdd', disableModelInvocation: false }],
    }

    await pi.handlers.get('before_agent_start')?.({ systemPrompt: beforePrompt, systemPromptOptions: options }, context(finalPrompt))
    await pi.handlers.get('agent_start')?.({}, context(finalPrompt))
    expect(pi.entries).toHaveLength(0)

    await pi.handlers.get('before_provider_request')?.({}, context(finalPrompt))

    expect(pi.entries).toHaveLength(1)
    expect(pi.entries[0]).toMatchObject({
      customType: 'pi-session-viewer.system-prompt',
      data: {
        schemaVersion: 1,
        recordType: 'snapshot',
        captureStage: 'agent_start',
        prompt: finalPrompt,
        targetUserEntryId: 'user-1',
        composition: {
          customPrompt: 'custom base',
          selectedTools: ['bash'],
          toolDefinitions: [
            {
              name: 'bash',
              description: 'Execute shell commands',
              parameters: {
                type: 'object',
                properties: { command: { type: 'string' } },
                required: ['command'],
              },
            },
          ],
          contextFiles: [{ path: '/work/demo/AGENTS.md', content: 'Use tests first.' }],
          skills: [{ name: 'tdd', filePath: '/skills/tdd/SKILL.md' }],
        },
        promptBeforeFinalExtensions: beforePrompt,
      },
    })
    expect(pi.entries[0].data.promptHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('stores a reference instead of repeating an already captured prompt', async () => {
    const pi = fakePi()
    capturePrompt(pi as never)
    const options = { cwd: '/work/demo', selectedTools: [], toolSnippets: {}, promptGuidelines: [], contextFiles: [], skills: [] }
    const run = async () => {
      await pi.handlers.get('before_agent_start')?.({ systemPrompt: 'same prompt', systemPromptOptions: options }, context('same prompt'))
      await pi.handlers.get('agent_start')?.({}, context('same prompt'))
      await pi.handlers.get('before_provider_request')?.({}, context('same prompt'))
      await pi.handlers.get('agent_end')?.({}, context('same prompt'))
    }

    await run()
    await run()

    expect(pi.entries).toHaveLength(2)
    expect(pi.entries[1]).toMatchObject({
      customType: 'pi-session-viewer.system-prompt',
      data: { schemaVersion: 1, recordType: 'reference', promptHash: pi.entries[0].data.promptHash },
    })
    expect(pi.entries[1].data.prompt).toBeUndefined()
    expect(pi.entries[1].data.composition).toBeUndefined()
  })

  it('records a new snapshot when the effective prompt changes before a provider request', async () => {
    const pi = fakePi()
    capturePrompt(pi as never)
    const options = { cwd: '/work/demo', selectedTools: [], toolSnippets: {}, promptGuidelines: [], contextFiles: [], skills: [] }

    await pi.handlers.get('before_agent_start')?.({ systemPrompt: 'base prompt', systemPromptOptions: options }, context('base prompt'))
    await pi.handlers.get('agent_start')?.({}, context('base prompt'))
    await pi.handlers.get('before_provider_request')?.({}, context('base prompt'))
    await pi.handlers.get('before_provider_request')?.({}, context('base prompt\n\nDynamic tool instructions'))

    expect(pi.entries).toHaveLength(2)
    expect(pi.entries[1]).toMatchObject({
      customType: 'pi-session-viewer.system-prompt',
      data: {
        schemaVersion: 1,
        recordType: 'snapshot',
        captureStage: 'provider_request_update',
        prompt: 'base prompt\n\nDynamic tool instructions',
        relatedUserEntryId: 'user-1',
      },
    })
    expect(pi.entries[1].data.targetUserEntryId).toBeUndefined()
  })
})
