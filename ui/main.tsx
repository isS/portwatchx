import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from 'next-themes'
import * as Tooltip from '@radix-ui/react-tooltip'
import { App } from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <Tooltip.Provider delayDuration={400} skipDelayDuration={150}>
        <App />
      </Tooltip.Provider>
    </ThemeProvider>
  </StrictMode>,
)
