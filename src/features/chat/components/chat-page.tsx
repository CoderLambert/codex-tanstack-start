import { useEffect, useRef } from 'react'
import { AgentActivity } from './agent-activity'
import { ChatInput } from './chat-input'
import { ChatMessage } from './chat-message'
import type { ChatPageProps } from './chat-ui.types'

export function ChatPage({
  title = 'Codex Chat',
  subtitle = 'Personal agent runtime demo',
  messages,
  activities,
  status,
  error,
  onSend,
  onNewChat,
}: ChatPageProps) {
  const scrollAnchorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, activities, status])

  return (
    <main className="chat-shell">
      <header className="topbar">
        <div>
          <div className="brand-row">
            <span className="brand-mark" aria-hidden="true">C</span>
            <h1>{title}</h1>
          </div>
          <p>{subtitle}</p>
        </div>
        <button className="secondary-button" type="button" onClick={onNewChat}>
          <PlusIcon />
          New Chat
        </button>
      </header>

      <section className="chat-panel" aria-label="Chat conversation">
        <div className="conversation" aria-live="polite" aria-busy={status === 'running'}>
          <div className="conversation__inner">
            {messages.length === 0 ? <WelcomeMessage /> : null}
            {messages.map((message) => <ChatMessage key={message.id} message={message} />)}
            {status === 'running' ? <RunningIndicator /> : null}
            <AgentActivity activities={activities} />
            {error ? (
              <div className="error-banner" role="alert">
                <strong>Request failed</strong>
                <span>{error}</span>
              </div>
            ) : null}
            <div ref={scrollAnchorRef} />
          </div>
        </div>

        <div className="composer-wrap">
          <ChatInput disabled={status === 'running'} onSubmit={onSend} />
        </div>
      </section>
    </main>
  )
}

function WelcomeMessage() {
  return (
    <div className="message message--assistant">
      <div className="message__meta">
        <span className="avatar avatar--assistant" aria-hidden="true">C</span>
        <span>Codex</span>
      </div>
      <div className="message__content">
        Ready when you are. Ask me to inspect, explain, or reason about this project.
      </div>
    </div>
  )
}

function RunningIndicator() {
  return (
    <div className="running-indicator" role="status">
      <span className="running-indicator__dot" />
      <span>Codex is working</span>
    </div>
  )
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
