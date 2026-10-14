import { useState } from 'react';
import { supabase } from '../supabaseClient.js';
import '../../styles/lobby.css'; // We can reuse the glass-panel lobby styles!

export default function AuthScreen({ onGuestLogin }) {
  const [loading, setLoading] = useState(false);

  const handleGoogleLogin = async () => {
    try {
      setLoading(true);
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin
        }
      });
      if (error) throw error;
    } catch (error) {
      alert(error.message);
      setLoading(false);
    }
  };

  return (
    <main className="lobby-screen">
      <section className="glass-panel lobby-panel" style={{ maxWidth: '480px', textAlign: 'center', padding: '40px 24px' }}>
        <p className="eyebrow" style={{ justifyContent: 'center' }}>Welcome to</p>
        <h1 style={{ marginBottom: '32px', color: 'var(--text-navy)' }}>Puzzle Party</h1>
        
        <div style={{ display: 'grid', gap: '16px' }}>
          <button 
            type="button" 
            className="primary-button" 
            onClick={handleGoogleLogin}
            disabled={loading}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '14px' }}
          >
            <span aria-hidden="true" style={{ fontSize: '1.2rem' }}>G</span> 
            {loading ? 'Connecting...' : 'Continue with Google'}
          </button>
          
          <div style={{ display: 'flex', alignItems: 'center', margin: '8px 0', color: 'var(--text-plum)', fontSize: '0.85rem' }}>
            <div style={{ flex: 1, height: '1px', background: 'rgba(26, 35, 58, 0.1)' }}></div>
            <span style={{ padding: '0 12px' }}>OR</span>
            <div style={{ flex: 1, height: '1px', background: 'rgba(26, 35, 58, 0.1)' }}></div>
          </div>

          <button 
            type="button" 
            className="secondary-button" 
            onClick={onGuestLogin}
            disabled={loading}
            style={{ padding: '14px' }}
          >
            Play as Guest
          </button>
        </div>
      </section>
    </main>
  );
}