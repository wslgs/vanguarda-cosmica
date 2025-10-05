export default function MissionHero({ dashboard }) {
  return (
    <header className="hero">
      <div className="hero__content">
        <span className="badge">NASA Space Apps • MVP</span>
        <h1>{dashboard.mission_name}</h1>
        <p>{dashboard.objective}</p>
        <dl>
          <div>
            <dt>Janela de missão</dt>
            <dd>{dashboard.mission_window}</dd>
          </div>
          <div>
            <dt>Órbita</dt>
            <dd>{dashboard.orbital_body}</dd>
          </div>
        </dl>
      </div>
      <figure className="hero__image">
        <img src={dashboard.hero_image} alt="Visualização orbital da missão" />
        <figcaption>Registro oficial NASA/JPL-Caltech</figcaption>
      </figure>
      <blockquote className="hero__quote">
        “{dashboard.mentor_message}”
      </blockquote>
    </header>
  );
}
