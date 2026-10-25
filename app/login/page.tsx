'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Logo from '@/components/Logo';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const ref = params.get('ref') ?? '';
  const [mode, setMode] = useState<'in' | 'up'>(ref || params.get('mode') === 'up' ? 'up' : 'in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(params.get('error') ? 'That confirmation link did not work. Try signing in.' : null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const supabase = createClient();
    if (mode === 'in') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMessage('Email or password is incorrect.');
      else router.replace('/dashboard');
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${location.origin}/auth/callback`,
          data: ref ? { referral_code: ref.toUpperCase() } : {},
        },
      });
      if (error) setMessage(error.message);
      else if (data.session) {
        await fetch('/api/referrals/apply', { method: 'POST' });
        router.replace('/dashboard');
      } else setMessage('Check your email for a confirmation link, then sign in.');
    }
    setBusy(false);
  }

  return (
    <main className="auth">
      <div className="auth-head">
        <Logo size={44} />
        <h1>{mode === 'in' ? 'Welcome back' : 'Create your account'}</h1>
        <p className="dim">{mode === 'in' ? 'Sign in to continue to Nexora.' : 'Play, compete and rise with Nexora.'}</p>
      </div>
      <div className="auth-card">
        {ref ? <p className="notice">You were invited with code {ref.toUpperCase()}.</p> : null}
        <form onSubmit={onSubmit} className="page" style={{ gap: 14 }}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" required minLength={8} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {message ? <p role="alert" className="notice">{message}</p> : null}
          <button className="btn primary" type="submit" disabled={busy}>{mode === 'in' ? 'Sign in' : 'Create account'}</button>
        </form>
        <button className="btn ghost" type="button" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setMessage(null); }}>
          {mode === 'in' ? 'New here? Create an account' : 'Already have an account? Sign in'}
        </button>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
