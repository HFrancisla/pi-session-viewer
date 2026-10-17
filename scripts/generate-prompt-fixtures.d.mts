export interface PromptFixtureOptions {
  cwd: string
  selectedTools: string[]
  toolSnippets: Record<string, string>
  toolGuidelines?: Record<string, string[]>
  promptGuidelines: string[]
  appendSystemPrompt: string
  contextFiles: Array<{ path: string; content: string }>
  skills: Array<{
    name: string
    description: string
    filePath: string
    baseDir?: string
    disableModelInvocation?: boolean
  }>
}

export const FIXTURE_OPTIONS: PromptFixtureOptions

export function readPiToolContributions(
  piPackageDir: string
): Promise<Record<string, { snippet: string; guidelines: string[] }>>

export function vanillaFixtureOptions(piPackageDir: string): Promise<PromptFixtureOptions>

export function mcpFixtureOptions(
  piPackageDir: string
): Promise<PromptFixtureOptions & { sections: Record<string, string> }>

export function buildFixturePrompt(
  piPackageDir: string,
  variant?: 'full' | 'vanilla' | 'mcp'
): Promise<{ prompt: string; options: PromptFixtureOptions & { sections?: Record<string, string> } }>
