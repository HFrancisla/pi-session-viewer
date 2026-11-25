import type { PersistedSystemState } from './native-state'
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
