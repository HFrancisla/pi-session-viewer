import { encodeSessionToken } from './session-token'
import type { RawObject, SubagentReference } from './types'

function isObject(value: unknown): value is RawObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

const SUBAGENT_TOOL_REGEX = /(?:subagent|child_agent|spawn_agent|run_agent|agent_runner|subagent_wait|subagent_supervisor|^agent$|^task$)/i

const SUBAGENT_FILE_PATH_REGEX = /(?:^|[\s"'`([<{])([a-zA-Z0-9_\-./]*subagent-artifacts\/[a-zA-Z0-9_\-./]+\.jsonl)(?:$|[\s"'`)\]>}])/i
const GENERIC_JSONL_PATH_REGEX = /(?:^|[\s"'`([<{])([a-zA-Z0-9_\-./]+\.jsonl)(?:$|[\s"'`)\]>}])/i

export function normalizeSessionRelativePath(rawPath: string, parentSourcePath?: string): string {
  let cleaned = rawPath.replace(/\\/g, '/').trim()

  // 1. If absolute or relative path containing .pi/agent/sessions/
  const piSessionsMatch = cleaned.match(/(?:^|\/)\.pi\/agent\/sessions\/(.+)$/)
  if (piSessionsMatch?.[1]) {
    return piSessionsMatch[1].replace(/^\/+/, '')
  }

  // 2. If parentSourcePath is provided (e.g. "--project--/2026-09-19...jsonl")
  if (parentSourcePath) {
    const parentCleaned = parentSourcePath.replace(/\\/g, '/').replace(/^\/+/, '')
    const parentDir = parentCleaned.includes('/') ? parentCleaned.slice(0, parentCleaned.lastIndexOf('/')) : ''

    if (parentDir) {
      if (cleaned.includes(parentDir)) {
        return cleaned.slice(cleaned.indexOf(parentDir)).replace(/^\/+/, '')
      }
      if (!cleaned.startsWith(parentDir) && !cleaned.startsWith('/')) {
        return `${parentDir}/${cleaned.replace(/^\.\//, '')}`
      }
    }
  }

  return cleaned.replace(/^\.\//, '').replace(/^\/+/, '')
}

function extractFilePathCandidate(value: unknown, isSubagentTool: boolean): string | undefined {
  if (typeof value !== 'string') return undefined
  // Both patterns require a literal ('subagent-artifacts/' or '.jsonl'), so a
  // native substring search can rule out a whole-string regex scan. Tool output
  // runs to megabytes and almost never names a session file.
  const mentionsSubagentPath = value.includes('subagent-artifacts')
  if (!mentionsSubagentPath && (!isSubagentTool || !value.includes('.jsonl'))) return undefined
  const subagentMatch = value.match(SUBAGENT_FILE_PATH_REGEX)
  if (subagentMatch?.[1]) return subagentMatch[1]

  if (isSubagentTool) {
    const genericMatch = value.match(GENERIC_JSONL_PATH_REGEX)
    if (genericMatch?.[1]) return genericMatch[1]
  }
  return undefined
}

function extractTargetFileFromObject(obj: RawObject, isSubagentTool: boolean): string | undefined {
  const directFields = [
    'sessionFile',
    'sessionPath',
    'subagentFile',
    'subagentSession',
    'targetFile',
    'childSession',
    'childSessionFile',
    'sessionId',
    'session',
  ]

  for (const field of directFields) {
    const val = obj[field]
    if (typeof val === 'string') {
      const candidate = extractFilePathCandidate(val, isSubagentTool || field.toLowerCase().includes('subagent'))
      if (candidate) return candidate
      if (val.endsWith('.jsonl')) return val
      if (val.includes('subagent-artifacts')) {
        return val.endsWith('.jsonl') ? val : `${val}.jsonl`
      }
    }
  }
  return undefined
}

/**
 * Strings longer than this are never parsed: a failed `JSON.parse` still reads the
 * whole string, and tool results of this size are prose, not a session reference.
 */
const MAX_JSON_PARSE_LENGTH = 1_000_000

function parsePossibleJson(value: unknown): RawObject | undefined {
  if (isObject(value)) return value
  if (typeof value !== 'string' || value.length > MAX_JSON_PARSE_LENGTH) return undefined
  // Only an object literal can carry a session reference; skipping everything
  // else avoids parsing (and failing on) arbitrary tool output.
  if (value.trimStart().charAt(0) !== '{') return undefined
  try {
    const parsed = JSON.parse(value)
    if (isObject(parsed)) return parsed
  } catch {
    // Not JSON; nothing to extract.
  }
  return undefined
}

function createReferenceFromItem(
  item: RawObject,
  argsObj?: RawObject,
  toolName?: string,
  parentSourcePath?: string,
  fallbackRunId?: string,
): SubagentReference | undefined {
  const isSubagentTool = toolName ? SUBAGENT_TOOL_REGEX.test(toolName) : true

  let rawFile = stringValue(item.sessionFile)
    ?? stringValue(item.sessionPath)
    ?? stringValue(item.subagentFile)
    ?? stringValue(item.targetFile)

  if (!rawFile && isObject(item.artifactPaths)) {
    rawFile = stringValue(item.artifactPaths.jsonlPath)
  }
  if (!rawFile && typeof item.jsonlPath === 'string') {
    rawFile = stringValue(item.jsonlPath)
  }
  if (!rawFile && stringValue(item.sessionId)) {
    rawFile = `subagent-artifacts/${item.sessionId}.jsonl`
  }

  if (!rawFile) {
    rawFile = extractTargetFileFromObject(item, isSubagentTool)
  }

  if (!rawFile) return undefined

  const normalizedFile = normalizeSessionRelativePath(rawFile, parentSourcePath)
  const token = encodeSessionToken(normalizedFile)

  const agentName = stringValue(item.agent)
    ?? stringValue(item.agentName)
    ?? stringValue(item.name)
    ?? stringValue(argsObj?.agent)
    ?? stringValue(argsObj?.agentName)
    ?? stringValue(argsObj?.name)
    ?? (toolName && isSubagentTool && toolName.toLowerCase() !== 'task' ? toolName : undefined)

  let task = stringValue(item.task)
  if (!task || task === '[prompt redacted]') {
    task = stringValue(argsObj?.task)
      ?? stringValue(argsObj?.prompt)
      ?? stringValue(argsObj?.instruction)
      ?? stringValue(argsObj?.query)
      ?? stringValue(item.sessionName)
  }

  const sessionName = stringValue(item.sessionName)
  const runId = stringValue(item.runId) ?? stringValue(item.id) ?? fallbackRunId

  return {
    targetFile: normalizedFile,
    token,
    agentName,
    task,
    sessionName,
    runId,
  }
}

export function extractSubagentReferences(
  toolName: string,
  args?: unknown,
  resultContent?: unknown,
  details?: unknown,
  parentSourcePath?: string,
): SubagentReference[] {
  const isSubagentTool = SUBAGENT_TOOL_REGEX.test(toolName)
  const argsObj = parsePossibleJson(args)
  const resultObj = parsePossibleJson(resultContent)
  const detailsObj = parsePossibleJson(details)

  const results: SubagentReference[] = []
  const seenFiles = new Set<string>()
  const seenRunIds = new Set<string>()

  const addReference = (ref?: SubagentReference) => {
    if (!ref) return
    if (seenFiles.has(ref.targetFile)) return
    if (ref.runId && seenRunIds.has(ref.runId)) return
    seenFiles.add(ref.targetFile)
    if (ref.runId) seenRunIds.add(ref.runId)
    results.push(ref)
  }

  // 1. Structured subagents from details (primary real Pi subagent output format)
  if (detailsObj) {
    const defaultRunId = stringValue(detailsObj.runId)

    // Check details.results (e.g. subagent execution array)
    if (Array.isArray(detailsObj.results)) {
      for (const item of detailsObj.results) {
        if (isObject(item)) {
          addReference(createReferenceFromItem(item, argsObj, toolName, parentSourcePath, defaultRunId))
        }
      }
    }

    // Check details.completions (e.g. workflow / multi-agent completions)
    if (Array.isArray(detailsObj.completions)) {
      for (const completion of detailsObj.completions) {
        if (isObject(completion) && Array.isArray(completion.results)) {
          for (const item of completion.results) {
            if (isObject(item)) {
              addReference(createReferenceFromItem(item, argsObj, toolName, parentSourcePath, defaultRunId))
            }
          }
        }
      }
    }

    // Check details.artifacts.files
    if (isObject(detailsObj.artifacts) && Array.isArray(detailsObj.artifacts.files)) {
      for (const fileItem of detailsObj.artifacts.files) {
        if (isObject(fileItem)) {
          addReference(createReferenceFromItem(fileItem, argsObj, toolName, parentSourcePath, defaultRunId))
        }
      }
    }

    // Check direct fields on details
    const directFromDetails = createReferenceFromItem(detailsObj, argsObj, toolName, parentSourcePath, defaultRunId)
    if (directFromDetails) {
      addReference(directFromDetails)
    }
  }

  // 2. Structured or direct paths from resultObj or argsObj
  if (resultObj) {
    const ref = createReferenceFromItem(resultObj, argsObj, toolName, parentSourcePath)
    if (ref) addReference(ref)
  }

  if (argsObj) {
    const ref = createReferenceFromItem(argsObj, undefined, toolName, parentSourcePath)
    if (ref) addReference(ref)
  }

  // 3. Fallback: string pattern matching on resultContent or args
  if (!results.length) {
    let targetFile: string | undefined

    if (typeof resultContent === 'string') {
      targetFile = extractFilePathCandidate(resultContent, isSubagentTool)
    }
    if (!targetFile && typeof args === 'string') {
      targetFile = extractFilePathCandidate(args, isSubagentTool)
    }

    // If tool is explicitly a subagent tool and sessionId is given without extension
    if (!targetFile && (argsObj || resultObj) && isSubagentTool) {
      const rawId = stringValue(resultObj?.sessionId ?? argsObj?.sessionId)
      if (rawId && !rawId.includes('/')) {
        targetFile = `subagent-artifacts/${rawId}.jsonl`
      }
    }

    if (targetFile) {
      const normalized = normalizeSessionRelativePath(targetFile, parentSourcePath)
      const agentName = stringValue(argsObj?.agent)
        ?? stringValue(argsObj?.agentName)
        ?? stringValue(argsObj?.name)
        ?? stringValue(resultObj?.agent)
        ?? stringValue(resultObj?.agentName)
        ?? (isSubagentTool && toolName.toLowerCase() !== 'task' ? toolName : undefined)

      const task = stringValue(argsObj?.task)
        ?? stringValue(argsObj?.prompt)
        ?? stringValue(argsObj?.instruction)
        ?? stringValue(argsObj?.query)

      addReference({
        targetFile: normalized,
        token: encodeSessionToken(normalized),
        agentName,
        task,
      })
    }
  }

  return results
}

export function extractSubagentReference(
  toolName: string,
  args?: unknown,
  resultContent?: unknown,
  details?: unknown,
  parentSourcePath?: string,
): SubagentReference | undefined {
  const references = extractSubagentReferences(toolName, args, resultContent, details, parentSourcePath)
  return references[0]
}

/** pi-subagents transcript mirror: `<runId>_<agent>_transcript.jsonl`. */
const SUBAGENT_TRANSCRIPT_REGEX = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_(.+)_transcript\.jsonl$/i

/**
 * Session files a subagent reference may resolve to, most useful first.
 *
 * Two spellings appear in tool results: Pi reports the runnable session
 * (`<parent-session-dir>/<runId>/run-0/session.jsonl`), while pi-subagents
 * reports its transcript mirror
 * (`<project-dir>/subagent-artifacts/<runId>_<agent>_transcript.jsonl`). The
 * viewer prefers the runnable session and falls back to the mirror, which is
 * only readable inside the session root.
 *
 * Returns paths relative to the session root, deduplicated, in priority order:
 * runnable run sessions first, the transcript mirror last.
 */
export function subagentTargetCandidates(targetFile: string, parentSourcePath?: string): string[] {
  const clean = (value: string): string => value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
  const target = clean(targetFile)
  if (!target) return []

  const transcript = SUBAGENT_TRANSCRIPT_REGEX.exec(target.split('/').pop() ?? '')
  // A runnable run session renders as a full Pi session, so it is tried before
  // the transcript mirror, which is pi-subagents' own format.
  if (!transcript) return [target]
  const candidates: string[] = []

  const runId = transcript[1]
  const artifactDir = target.includes('/') ? target.slice(0, target.lastIndexOf('/')) : ''
  const projectDir = artifactDir.includes('subagent-artifacts')
    ? artifactDir.slice(0, artifactDir.lastIndexOf('subagent-artifacts')).replace(/\/+$/, '')
    : artifactDir

  const parentStem = parentSourcePath
    ? clean(parentSourcePath).split('/').pop()?.replace(/\.jsonl$/, '')
    : undefined

  const runSession = (base: string) => (base ? `${base}/${runId}/run-0/session.jsonl` : `${runId}/run-0/session.jsonl`)
  if (projectDir && parentStem) candidates.push(runSession(`${projectDir}/${parentStem}`))
  if (projectDir) candidates.push(runSession(projectDir))
  candidates.push(target)

  return [...new Set(candidates.filter(Boolean))]
}
