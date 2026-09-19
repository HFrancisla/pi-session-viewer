import { describe, expect, it } from 'vitest'
import { decodeSessionToken, encodeSessionToken } from './session-token'

describe('session-token', () => {
  it('encodes and decodes relative paths correctly', () => {
    const paths = [
      'session-1.jsonl',
      'nested/path/to/session.jsonl',
      'subagent-artifacts/child.jsonl',
      '项目路径/会话.jsonl',
    ]

    for (const p of paths) {
      const token = encodeSessionToken(p)
      expect(token).not.toContain('+')
      expect(token).not.toContain('/')
      expect(token).not.toContain('=')
      expect(decodeSessionToken(token)).toBe(p)
    }
  })
})
