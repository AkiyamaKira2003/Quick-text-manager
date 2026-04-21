import type React from 'react'

type ElectronWebviewTag = HTMLElement & {
  executeJavaScript?: <T = unknown>(code: string, userGesture?: boolean) => Promise<T>
  getURL?: () => string
  focus?: () => void
  sendInputEvent?: (event: { type: string; keyCode?: string; modifiers?: string[] }) => void
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<ElectronWebviewTag>, ElectronWebviewTag> & {
        src?: string
        partition?: string
        useragent?: string
        allowpopups?: boolean | string
        disablewebsecurity?: boolean | string
      }
    }
  }
}

export {}
