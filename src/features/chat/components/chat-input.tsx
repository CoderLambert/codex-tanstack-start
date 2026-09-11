import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'

interface ChatInputProps {
  disabled?: boolean
  onSubmit: (value: string) => void | Promise<void>
}

export function ChatInput({ disabled = false, onSubmit }: ChatInputProps) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const hintId = useId()
  const canSend = value.trim().length > 0 && !disabled

  async function submit() {
    const nextValue = value.trim()
    if (!nextValue || disabled) return

    setValue('')
    await onSubmit(nextValue)
    textareaRef.current?.focus()
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void submit()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void submit()
    }
  }

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <label className="sr-only" htmlFor="chat-composer">
        给 Codex 发送消息
      </label>
      <textarea
        ref={textareaRef}
        id="chat-composer"
        className="composer__input"
        value={value}
        rows={1}
        placeholder="Ask Codex about your project…"
        aria-describedby={hintId}
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <button className="send-button" type="submit" disabled={!canSend} aria-label="发送消息">
        <SendIcon />
      </button>
      <span id={hintId} className="composer__hint">
        Enter 发送 · Shift+Enter 换行
      </span>
    </form>
  )
}

function SendIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 19V5M6 11l6-6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
