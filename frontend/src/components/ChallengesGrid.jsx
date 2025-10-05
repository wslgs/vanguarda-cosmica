export default function ChallengesGrid({ challenges }) {
  return (
    <article className="panel challenges">
      <h2>Desafios Prioritários</h2>
      <div className="challenges__grid">
        {challenges.map((challenge) => (
          <div key={challenge.id} className="challenge-card">
            <span className="challenge-card__id">#{challenge.id}</span>
            <h3>{challenge.title}</h3>
            <p>{challenge.summary}</p>
            <ul className="tags">
              {challenge.tags.map((tag) => (
                <li key={tag}>{tag}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </article>
  );
}
