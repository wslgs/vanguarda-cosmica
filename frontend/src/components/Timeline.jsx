function formatDate(value) {
  return new Intl.DateTimeFormat('pt-BR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(value));
}

export default function Timeline({ events }) {
  return (
    <article className="panel timeline">
      <h2>Órbita do Hackathon</h2>
      <ul>
        {events.map((event) => (
          <li key={event.title}>
            <span className="timeline__date" aria-label="Horário em UTC">
              {formatDate(event.datetime_utc)}
            </span>
            <div>
              <h3>{event.title}</h3>
              <p>{event.description}</p>
            </div>
          </li>
        ))}
      </ul>
    </article>
  );
}
