function formatDate(value) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value));
}

export default function IdeaList({ ideas, challengesById }) {
  return (
    <aside className="panel idea-list">
      <h2>Latest submissions</h2>
      {ideas.length === 0 ? (
        <p className="empty-state">
          No ideas have been registered yet. Be the first team to submit a proposal!
        </p>
      ) : (
        <ul>
          {ideas.map((idea) => {
            const challenge = challengesById.get(idea.submission.challenge_id);
            return (
              <li key={idea.id}>
                <header>
                  <strong>{idea.submission.team_name}</strong>
                  <span>{formatDate(idea.received_at)}</span>
                </header>
                <p className="idea-title">{idea.submission.concept_title}</p>
                <p>{idea.submission.summary}</p>
                <footer>
                  <span className="challenge-pill">
                    Challenge #{idea.submission.challenge_id} · {challenge?.title ?? 'Unknown'}
                  </span>
                </footer>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
