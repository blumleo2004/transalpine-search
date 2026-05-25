'use client';

import React, { useState } from 'react';
import styles from './page.module.css';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      if (res.ok) {
        // Redirect to main search interface
        window.location.href = '/';
      } else {
        const data = await res.json();
        setError(data.error || 'Ungültiges Passwort');
      }
    } catch (err: any) {
      setError('Verbindungsfehler. Bitte versuchen Sie es erneut.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.loginContainer}>
      <div className={styles.loginCard}>
        <div className={styles.header}>
          <div className={styles.logoBadge}>PROJEKT-SCHUTZ</div>
          <h1 className={styles.title}>Servus. Grüezi. Hallo.</h1>
          <p className={styles.subtitle}>
            Gegen unbefugten Zugriff geschützte transalpine KI-Suchmaschine. Bitte geben Sie das Zugangspasswort ein.
          </p>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.inputGroup}>
            <label htmlFor="password-input" className={styles.label}>Passwort</label>
            <input
              id="password-input"
              type="password"
              className={styles.input}
              placeholder="Passwort eingeben..."
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
              autoFocus
            />
          </div>

          {error && <div className={styles.errorAlert}>{error}</div>}

          <button type="submit" className={styles.submitButton} disabled={loading}>
            {loading ? 'Verifizieren...' : 'Freischalten'}
          </button>
        </form>

        <div className={styles.footer}>
          Diese Seite enthält transkribierte und urheberrechtlich geschützte Podcast-Inhalte von ZEIT ONLINE.
          Der Zugriff ist für private Zwecke passwortgeschützt.
        </div>
      </div>
    </div>
  );
}
