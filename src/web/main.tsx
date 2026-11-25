// Web application entrypoint.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { CopyFeedbackProvider } from './components/CopyButton'
import { I18nProvider } from './i18n'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <CopyFeedbackProvider>
        <App />
      </CopyFeedbackProvider>
    </I18nProvider>
  </StrictMode>,
)
