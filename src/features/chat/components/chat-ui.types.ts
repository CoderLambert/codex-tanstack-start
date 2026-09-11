import type { AgentActivity, ChatMessage, ChatRunStatus } from '../chat.reducer'

export interface ChatPageProps {
  title?: string
  subtitle?: string
  messages: ChatMessage[]
  activities: AgentActivity[]
  status: ChatRunStatus
  error: string | null
  onSend: (message: string) => Promise<void>
  onNewChat: () => void
}
