import { describe, expect, it } from 'vitest'
import { extractSubagentReference } from './subagent-detector'
import { decodeSessionToken } from './session-token'

describe('subagent-detector', () => {
  it('detects subagent reference from toolCall arguments object', () => {
    const ref = extractSubagentReference(
      'subagent',
      { agent: 'code-reviewer', task: 'Review changes', sessionFile: 'subagent-artifacts/review-1.jsonl' },
    )
    expect(ref).toBeDefined()
    expect(ref?.agentName).toBe('code-reviewer')
    expect(ref?.task).toBe('Review changes')
    expect(ref?.targetFile).toBe('subagent-artifacts/review-1.jsonl')
    expect(decodeSessionToken(ref!.token)).toBe('subagent-artifacts/review-1.jsonl')
  })

  it('detects subagent reference from toolResult json content', () => {
    const ref = extractSubagentReference(
      'task',
      { prompt: 'Run security checks' },
      JSON.stringify({ status: 'completed', sessionPath: 'subagent-artifacts/sec-check.jsonl', agent: 'security-scanner' }),
    )
    expect(ref).toBeDefined()
    expect(ref?.agentName).toBe('security-scanner')
    expect(ref?.task).toBe('Run security checks')
    expect(ref?.targetFile).toBe('subagent-artifacts/sec-check.jsonl')
  })

  it('detects subagent path from text message in result', () => {
    const ref = extractSubagentReference(
      'run_agent',
      { task: 'Analyze logs' },
      'Agent finished successfully. Session saved to subagent-artifacts/child-42.jsonl for replay.',
    )
    expect(ref).toBeDefined()
    expect(ref?.targetFile).toBe('subagent-artifacts/child-42.jsonl')
  })

  it('detects subagent when toolName is subagent and sessionId is provided', () => {
    const ref = extractSubagentReference(
      'subagent',
      { agent: 'tester', sessionId: 'test-run-1' },
    )
    expect(ref).toBeDefined()
    expect(ref?.targetFile).toBe('subagent-artifacts/test-run-1.jsonl')
  })

  it('returns undefined for non-subagent tool calls', () => {
    const ref = extractSubagentReference(
      'read_file',
      { path: 'src/index.ts' },
      'file contents here...',
    )
    expect(ref).toBeUndefined()
  })

  it('detects subagent from message.details results with absolute sessionFile', () => {
    const ref = extractSubagentReference(
      'subagent',
      { agent: 'delegate', task: 'Say hello to user' },
      'Run fan-out: 1/16 used\nHello there!',
      {
        mode: 'single',
        runId: '7df2a179-13a8-469a-a68a-bad6cbceb09c',
        results: [
          {
            agent: 'delegate',
            task: '[prompt redacted]',
            sessionName: 'delegate: Say hello to user',
            sessionFile: '/home/user/.pi/agent/sessions/--project--/2026-09-19_abc/7df2/run-0/session.jsonl',
          },
        ],
      },
      '--project--/2026-09-19_abc.jsonl',
    )
    expect(ref).toBeDefined()
    expect(ref?.agentName).toBe('delegate')
    expect(ref?.task).toBe('Say hello to user') // unredacted from args
    expect(ref?.targetFile).toBe('--project--/2026-09-19_abc/7df2/run-0/session.jsonl')
    expect(decodeSessionToken(ref!.token)).toBe('--project--/2026-09-19_abc/7df2/run-0/session.jsonl')
  })

  it('detects multiple subagents from details.results array', () => {
    const refs = extractSubagentReference(
      'subagent',
      undefined,
      'Fleet completed',
      {
        mode: 'fleet',
        results: [
          {
            agent: 'worker-1',
            task: 'Task 1',
            sessionFile: '/home/user/.pi/agent/sessions/--project--/run-1/session.jsonl',
          },
          {
            agent: 'worker-2',
            task: 'Task 2',
            sessionFile: '/home/user/.pi/agent/sessions/--project--/run-2/session.jsonl',
          },
        ],
      },
    )
    expect(refs).toBeDefined()
    expect(refs?.agentName).toBe('worker-1')
  })
})
