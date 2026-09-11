import type { AgentActivity as AgentActivityModel } from '../chat.reducer'

interface AgentActivityProps {
  activities: AgentActivityModel[]
}

const kindLabel: Record<string, string> = {
  reasoning: 'Reasoning',
  tool: 'Tool',
  command: 'Command',
  file: 'File',
  web: 'Web',
  todo: 'Plan',
  error: 'Error',
}

export function AgentActivity({ activities }: AgentActivityProps) {
  if (activities.length === 0) return null

  return (
    <aside className="activity" aria-label="Agent activity">
      <div className="activity__header">
        <span>Agent activity</span>
        <span className="activity__count">{activities.length}</span>
      </div>
      <ol className="activity__list">
        {activities.map((activity) => (
          <li className="activity__item" key={activity.id}>
            <span
              className={`activity__status activity__status--${activity.status}`}
              aria-label={activity.status}
              title={activity.status}
            />
            <div className="activity__body">
              <div className="activity__title-row">
                <span className="activity__kind">{kindLabel[activity.kind] ?? activity.kind}</span>
                <span className="activity__label">{activity.summary}</span>
              </div>
              {activity.detail ? <p>{activity.detail}</p> : null}
            </div>
          </li>
        ))}
      </ol>
    </aside>
  )
}
