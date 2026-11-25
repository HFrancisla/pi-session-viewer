import type { PersistedSystemState } from './types'
import { getToolStateChanges } from '@earendil-works/pi-ai/utils/transcript'

interface StateChange {
  kind: 'content' | 'section' | 'tool'
  name: string
  before?: unknown
  after?: unknown
}

export function diffPersistedState(state: PersistedSystemState): StateChange[] | undefined {
  if (!state.previous) return undefined
  const previous = state.previous.message
  const current = state.message
  const changes: StateChange[] = []
  if (previous.content !== current.content) changes.push({ kind: 'content', name: 'content', before: previous.content, after: current.content })
  const oldSections = previous.sections ?? {}
  const newSections = current.sections ?? {}
  for (const name of new Set([...Object.keys(oldSections), ...Object.keys(newSections)])) {
    const before = Object.hasOwn(oldSections, name) ? oldSections[name] : undefined
    const after = Object.hasOwn(newSections, name) ? newSections[name] : undefined
    if (before !== after) changes.push({ kind: 'section', name, before, after })
  }
  const oldTools = previous.toolsAdded ?? []
  const newTools = current.toolsAdded ?? []
  const delta = getToolStateChanges(oldTools, newTools)
  for (const name of new Set([...delta.toolsRemoved, ...delta.toolsAdded].map(tool => tool.name))) {
    changes.push({ kind: 'tool', name, before: oldTools.find(tool => tool.name === name), after: newTools.find(tool => tool.name === name) })
  }
  return changes
}

type DiffLineType = 'added' | 'removed' | 'unchanged'

export interface DiffLine {
  type: DiffLineType
  text: string
  oldLineNumber?: number
  newLineNumber?: number
}

export function computeLineDiff(oldText: string, newText: string): {
  lines: DiffLine[]
  addedCount: number
  removedCount: number
  unchangedCount: number
} {
  const oldLines = oldText ? oldText.split('\n') : []
  const newLines = newText ? newText.split('\n') : []

  if (oldText === newText) {
    const lines: DiffLine[] = oldLines.map((text, idx) => ({
      type: 'unchanged',
      text,
      oldLineNumber: idx + 1,
      newLineNumber: idx + 1,
    }))
    return {
      lines,
      addedCount: 0,
      removedCount: 0,
      unchangedCount: lines.length,
    }
  }

  // 1. Common prefix
  let prefixCount = 0
  const maxPrefix = Math.min(oldLines.length, newLines.length)
  while (prefixCount < maxPrefix && oldLines[prefixCount] === newLines[prefixCount]) {
    prefixCount++
  }

  // 2. Common suffix
  let suffixCount = 0
  const maxSuffix = Math.min(oldLines.length - prefixCount, newLines.length - prefixCount)
  while (
    suffixCount < maxSuffix &&
    oldLines[oldLines.length - 1 - suffixCount] === newLines[newLines.length - 1 - suffixCount]
  ) {
    suffixCount++
  }

  const midOld = oldLines.slice(prefixCount, oldLines.length - suffixCount)
  const midNew = newLines.slice(prefixCount, newLines.length - suffixCount)

  // 3. Compute LCS for the middle slice
  const m = midOld.length
  const n = midNew.length
  const dp: number[][] = Array.from(
    { length: m + 1 },
    () => Array.from({ length: n + 1 }, () => 0),
  )

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (midOld[i - 1] === midNew[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // 4. Backtrack to find diff items
  let i = m
  let j = n
  const midDiff: Array<{ type: DiffLineType; text: string }> = []

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && midOld[i - 1] === midNew[j - 1]) {
      midDiff.push({ type: 'unchanged', text: midOld[i - 1] })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      midDiff.push({ type: 'added', text: midNew[j - 1] })
      j--
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      midDiff.push({ type: 'removed', text: midOld[i - 1] })
      i--
    }
  }

  midDiff.reverse()

  // 5. Assemble all lines and assign line numbers
  const allDiff: Array<{ type: DiffLineType; text: string }> = []
  for (let p = 0; p < prefixCount; p++) {
    allDiff.push({ type: 'unchanged', text: oldLines[p] })
  }
  for (const item of midDiff) {
    allDiff.push(item)
  }
  for (let s = oldLines.length - suffixCount; s < oldLines.length; s++) {
    allDiff.push({ type: 'unchanged', text: oldLines[s] })
  }

  let oldLineNum = 1
  let newLineNum = 1
  let addedCount = 0
  let removedCount = 0
  let unchangedCount = 0

  const lines: DiffLine[] = allDiff.map((item) => {
    if (item.type === 'added') {
      addedCount++
      return {
        type: 'added',
        text: item.text,
        newLineNumber: newLineNum++,
      }
    }
    if (item.type === 'removed') {
      removedCount++
      return {
        type: 'removed',
        text: item.text,
        oldLineNumber: oldLineNum++,
      }
    }
    unchangedCount++
    return {
      type: 'unchanged',
      text: item.text,
      oldLineNumber: oldLineNum++,
      newLineNumber: newLineNum++,
    }
  })

  return {
    lines,
    addedCount,
    removedCount,
    unchangedCount,
  }
}

export function formatDiffLineTooltip(
  line: DiffLine,
  labels?: { current?: string; baseline?: string }
): string | undefined {
  const currentLabel = labels?.current ?? '当前'
  const baselineLabel = labels?.baseline ?? '基准'

  if (line.type === 'added') {
    return line.newLineNumber ? `Line ${line.newLineNumber} (${currentLabel})` : undefined
  }
  if (line.type === 'removed') {
    return line.oldLineNumber ? `Line ${line.oldLineNumber} (${baselineLabel})` : undefined
  }
  const lineNum = line.newLineNumber ?? line.oldLineNumber
  return lineNum ? `Line ${lineNum}` : undefined
}


// 对各原生字段独立做逐行比较，保留字段边界和未修改的行。
export function diffPersistedStateLines(state: PersistedSystemState) {
  const changes = diffPersistedState(state)
  if (!changes || !state.previous) return undefined
  const lines: DiffLine[] = []
  let oldLine = 1
  let newLine = 1
  const append = (before: string, after: string) => {
    for (const line of computeLineDiff(before, after).lines) {
      lines.push({
        type: line.type, text: line.text,
        ...(line.type !== 'added' ? { oldLineNumber: oldLine++ } : {}),
        ...(line.type !== 'removed' ? { newLineNumber: newLine++ } : {}),
      })
    }
  }
  const previous = state.previous.message
  const current = state.message
  const text = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  append(text(previous.content), text(current.content))
  const oldSections = previous.sections ?? {}
  const newSections = current.sections ?? {}
  const section = (name: string, value: string | null | undefined) => value == null ? '' : `[Section: ${name}]\n${value}`
  for (const name of new Set([...Object.keys(oldSections), ...Object.keys(newSections)])) {
    append(section(name, Object.hasOwn(oldSections, name) ? oldSections[name] : undefined),
      section(name, Object.hasOwn(newSections, name) ? newSections[name] : undefined))
  }
  for (const change of changes.filter(change => change.kind === 'tool')) {
    const tool = (value: unknown) => value === undefined ? '' : `[Tool: ${change.name}]\n${text(value)}`
    append(tool(change.before), tool(change.after))
  }
  return {
    lines,
    addedCount: lines.filter(line => line.type === 'added').length,
    removedCount: lines.filter(line => line.type === 'removed').length,
    unchangedCount: lines.filter(line => line.type === 'unchanged').length,
  }
}
