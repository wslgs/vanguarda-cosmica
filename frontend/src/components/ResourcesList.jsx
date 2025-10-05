export default function ResourcesList({ resources }) {
  return (
    <article className="panel resources">
      <h2>Recursos Orbitais</h2>
      <p>APIs, catálogos e ferramentas recomendadas para acelerar experimentos.</p>
      <ul>
        {resources.map((resource) => (
          <li key={resource.url}>
            <div>
              <strong>{resource.name}</strong>
              <span className="resource__category">{resource.category}</span>
            </div>
            <a href={resource.url} target="_blank" rel="noreferrer">
              Acessar recurso →
            </a>
          </li>
        ))}
      </ul>
    </article>
  );
}
