import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { en, type Translations } from './locales/en'
import { zhCN } from './locales/zh-CN'

export type Locale = 'en' | 'zh-CN'

const STORAGE_KEY = 'pi_session_viewer_locale'

const translations: Record<Locale, Translations> = {
  en,
  'zh-CN': zhCN,
}

interface I18nContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: Translations
  localizeTitle: (title: string) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

function detectInitialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'en' || saved === 'zh-CN') return saved
    if (typeof navigator !== 'undefined' && navigator.language && navigator.language.toLowerCase().startsWith('zh')) {
      return 'zh-CN'
    }
  } catch {
    // ignore localStorage/navigator error in non-browser environments
  }
  return 'en'
}

export function localizeEventTitle(title: string, locale: Locale): string {
  if (locale === 'en') return title

  // Common direct mappings
  const directMap: Record<string, string> = {
    'User': '用户',
    'Pi Response': 'Pi 回复',
    'Thinking': 'Thinking',
    'Tool Definitions': '工具定义',
    'System Prompt': '系统提示词',
    'System prompt': '系统提示词',
    'System prompt update': '系统提示词更新',
    'System prompt unrecorded': '系统提示词未记录',
    'System prompt missing': '系统提示词快照缺失',
    'Model Switch': '模型切换',
    'Thinking Level Switch': 'Thinking 等级切换',
    'Context Compaction': '上下文压缩',
    'Branch Summary': '分支摘要',
    'Branch label': '分支标签',
    'Session info': '会话信息',
    'Session setup': '会话设置',
    'Current branch': '当前分支',
    'Unknown Project': '未知项目',
    'Unknown working directory': '未知工作目录',
    'Base Template': '基础模板',
    'Available Tools': '可用工具',
    'Guidelines': '行为准则',
    'System Documentation': '系统文档指引',
    'Append Instructions': '追加指令',
    'Project Context': '项目上下文',
    'Skills': 'Skills',
    'Working Directory': '工作目录',
  }

  if (directMap[title]) return directMap[title]

  // Pattern matches
  const callMatch = title.match(/^Call (.+)$/)
  if (callMatch) return `调用 ${callMatch[1]}`

  const failedMatch = title.match(/^(.+) failed$/)
  if (failedMatch) return `${failedMatch[1]} 返回失败`

  const resultMatch = title.match(/^(.+) result$/)
  if (resultMatch) return `${resultMatch[1]} 返回结果`

  const messageMatch = title.match(/^Message: (.+)$/)
  if (messageMatch) return `消息：${messageMatch[1]}`

  const customMatch = title.match(/^Custom event: (.+)$/)
  if (customMatch) return `自定义事件：${customMatch[1]}`

  const customMsgMatch = title.match(/^Custom message: (.+)$/)
  if (customMsgMatch) return `自定义消息：${customMsgMatch[1]}`

  const histBranchMatch = title.match(/^Historical branch (\d+)$/)
  if (histBranchMatch) return `历史分支 ${histBranchMatch[1]}`

  const turnMatch = title.match(/^Turn (\d+)$/)
  if (turnMatch) return `第 ${turnMatch[1]} 轮`

  const unknownMatch = title.match(/^Unknown event: (.+)$/)
  if (unknownMatch) return `未知事件：${unknownMatch[1]}`

  return title
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => detectInitialLocale())

  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale)
    try {
      localStorage.setItem(STORAGE_KEY, nextLocale)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const t = useMemo(() => translations[locale], [locale])
  const localizeTitle = useCallback((title: string) => localizeEventTitle(title, locale), [locale])

  const value = useMemo(
    () => ({ locale, setLocale, t, localizeTitle }),
    [locale, setLocale, t, localizeTitle],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext)
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider')
  }
  return context
}
