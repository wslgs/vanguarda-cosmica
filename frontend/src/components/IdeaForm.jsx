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
        Team name
        <input
          type="text"
          name="team_name"
          value={values.team_name}
          onChange={handleChange}
          placeholder="e.g., Aurora Vanguard"
          required
        />
      </label>
      <label>
        Contact email
        <input
          type="email"
          name="contact_email"
          value={values.contact_email}
          onChange={handleChange}
          placeholder="you@team.space"
          required
        />
      </label>
      <label>
        Target challenge
        <select
          name="challenge_id"
          value={values.challenge_id}
          onChange={handleChange}
          required
        >
          <option value="" disabled>
            Select a challenge
          </option>
          {challenges.map((challenge) => (
            <option key={challenge.id} value={challenge.id}>
              #{challenge.id} — {challenge.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        Solution title
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
        Overview (minimum 20 characters)
        <textarea
          name="summary"
          value={values.summary}
          onChange={handleChange}
          rows={4}
          placeholder="How does the solution combine orbital and actionable data?"
          required
        />
      </label>

      <button type="submit" disabled={!isValid || loading}>
        {loading ? 'Transmitting...' : 'Submit proposal' }
      </button>
    </form>
  );
}
