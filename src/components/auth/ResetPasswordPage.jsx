import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Field, Input, makeStyles, tokens } from '@fluentui/react-components';

const useStyles = makeStyles({
  container: { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', backgroundColor: tokens.colorNeutralBackground2 },
  card: { backgroundColor: tokens.colorNeutralBackground1, borderRadius: '8px', padding: '40px', width: '400px', boxShadow: tokens.shadow16 },
  form: { display: 'flex', flexDirection: 'column', gap: '16px' },
  error: { color: tokens.colorPaletteRedForeground1, fontSize: '14px' },
});

export default function ResetPasswordPage() {
  const styles = useStyles();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (pw !== confirm) return setError('Passwords do not match');
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password: pw }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Password not accepted. Please try a different password.');
      navigate('/login');
    } catch (err) {
      setError(err.message || 'Password not accepted. Please try a different password.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h2>Set new password</h2>
        <form className={styles.form} onSubmit={handleSubmit}>
          <Field label="New password"><Input type="password" value={pw} onChange={e => setPw(e.target.value)} required /></Field>
          <Field label="Confirm password"><Input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required /></Field>
          {error && <div className={styles.error}>{error}</div>}
          <Button appearance="primary" type="submit" disabled={loading}>{loading ? 'Working...' : 'Set password'}</Button>
        </form>
      </div>
    </div>
  );
}
