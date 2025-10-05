import { useMemo, useState } from 'react';

const INITIAL_STATE = {
  team_name: '',
  contact_email: '',
  challenge_id: '',
  concept_title: '',
  summary: '',
};

export default function IdeaForm({ challenges, onSubmit, loading }) {
  const [values, setValues] = useState(INITIAL_STATE);

  const isValid = useMemo(() => {
    return (
      values.team_name.trim() &&
      values.contact_email.trim() &&
      values.challenge_id !== '' &&
      values.concept_title.trim() &&
      values.summary.trim().length >= 20
    );
  }, [values]);

  function handleChange(event) {
    const { name, value } = event.target;
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!isValid || loading) {
      return;
    }

    const payload = {
      ...values,
      challenge_id: Number(values.challenge_id),
    };

    await onSubmit(payload);
    setValues(INITIAL_STATE);
  }

  return (
    <form className="idea-form" onSubmit={handleSubmit}>
      <label>
        Nome do time
        <input
          type="text"
          name="team_name"
          value={values.team_name}
          onChange={handleChange}
          placeholder="ex: Aurora Atlântica"
          required
        />
      </label>
      <label>
        E-mail de contato
        <input
          type="email"
          name="contact_email"
          value={values.contact_email}
          onChange={handleChange}
          placeholder="voce@equipe.space"
          required
        />
      </label>
      <label>
        Desafio focado
        <select
          name="challenge_id"
          value={values.challenge_id}
          onChange={handleChange}
          required
        >
          <option value="" disabled>
            Selecione um desafio
          </option>
          {challenges.map((challenge) => (
            <option key={challenge.id} value={challenge.id}>
              #{challenge.id} — {challenge.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        Título da solução
        <input
          type="text"
          name="concept_title"
          value={values.concept_title}
          onChange={handleChange}
          placeholder="ex: Sentinel Shield"
          required
        />
      </label>
      <label>
        Visão geral (mínimo 20 caracteres)
        <textarea
          name="summary"
          value={values.summary}
          onChange={handleChange}
          rows={4}
          placeholder="Como a solução combina dados orbitais e acionáveis?"
          required
        />
      </label>

      <button type="submit" disabled={!isValid || loading}>
        {loading ? 'Transmitindo...' : 'Enviar proposta' }
      </button>
    </form>
  );
}
