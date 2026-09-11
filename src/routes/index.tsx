import { createFileRoute } from '@tanstack/react-router'
import { ChatPage } from '../features/chat/components/chat-page'
import { useChatController } from '../features/chat/use-chat-controller'

export const Route = createFileRoute('/')({
  component: HomePage,
})

function HomePage() {
  const { state, sendMessage, newChat } = useChatController()

  return (
    <ChatPage
      messages={state.messages}
      activities={state.activities}
      status={state.status}
      error={state.error}
      onSend={sendMessage}
      onNewChat={newChat}
    />
  )
}
