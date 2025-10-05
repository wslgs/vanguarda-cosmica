function formatDate(value) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value));
}

export default function IdeaList({ ideas, challengesById }) {
  return (
    <aside className="panel idea-list">
      <h2>Últimas propostas</h2>
      {ideas.length === 0 ? (
        <p className="empty-state">
          Nenhuma ideia registrada ainda. Seja a primeira equipe a enviar uma proposta!
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
                    Desafio #{idea.submission.challenge_id} · {challenge?.title ?? 'Desconhecido'}
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
