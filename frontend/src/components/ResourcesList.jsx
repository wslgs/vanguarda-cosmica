export default function ResourcesList({ resources }) {
  return (
    <article className="panel resources">
      <h2>Orbital resources</h2>
      <p>APIs, catalogs, and tools we recommend to accelerate experiments.</p>
      <ul>
        {resources.map((resource) => (
          <li key={resource.url}>
            <div>
              <strong>{resource.name}</strong>
              <span className="resource__category">{resource.category}</span>
            </div>
            <a href={resource.url} target="_blank" rel="noreferrer">
              Open resource →
            </a>
          </li>
        ))}
      </ul>
    </article>
  );
}
