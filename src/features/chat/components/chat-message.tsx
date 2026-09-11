import type { ChatMessage as ChatMessageModel } from '../chat.reducer'

interface ChatMessageProps {
  message: ChatMessageModel
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user'

  return (
    <article className={`message message--${message.role}`} aria-label={isUser ? '你的消息' : 'Codex 回复'}>
      <div className="message__meta">
        <span className={`avatar avatar--${message.role}`} aria-hidden="true">
          {isUser ? 'Y' : 'C'}
        </span>
        <span>{isUser ? 'You' : 'Codex'}</span>
      </div>
      <div className="message__content">{message.content}</div>
    </article>
  )
}
