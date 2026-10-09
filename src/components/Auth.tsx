import { useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Eye, EyeOff, Loader2, Lock, Sprout, User } from 'lucide-react';
import { loginUser, registerUser, validateUsername } from '../services/authService';

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const usernameHint = !isLogin && username ? validateUsername(username) : null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isLogin) await loginUser(username, password);
      else await registerUser(username, password);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Ocorreu um erro.');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (login: boolean) => {
    setIsLogin(login);
    setError('');
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 p-4 pt-[calc(1rem+var(--sat))] pb-[calc(1rem+var(--sab))]">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-purple-600/20 blur-[100px]" />
        <div className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-blue-600/20 blur-[100px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 w-full max-w-md rounded-3xl border border-white/10 bg-slate-900/80 p-8 shadow-2xl backdrop-blur-xl"
      >
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-4 rounded-xl bg-gradient-to-tr from-purple-600 to-blue-600 p-3 shadow-lg shadow-purple-500/20">
            <Sprout size={32} className="text-white" />
          </div>
          <h1 className="mb-1 text-3xl font-bold text-white">DApp NFT Farm</h1>
          <p className="text-sm text-gray-400">Choque ovos, faça stake e ganhe DAPPF</p>
        </div>

        <div className="mb-6 flex rounded-xl bg-slate-800/50 p-1" role="tablist">
          {[
            { label: 'Entrar', login: true },
            { label: 'Criar conta', login: false },
          ].map((tab) => (
            <button
              key={tab.label}
              type="button"
              role="tab"
              aria-selected={isLogin === tab.login}
              onClick={() => switchMode(tab.login)}
              className={`flex-1 rounded-lg py-2.5 text-sm font-bold transition-all ${
                isLogin === tab.login ? 'bg-purple-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="username" className="ml-1 text-xs font-bold text-gray-400 uppercase">
              Usuário
            </label>
            <div className="relative">
              <User className="absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2 text-gray-500" />
              <input
                id="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))}
                placeholder="seu_usuario"
                className="w-full rounded-xl border border-white/10 bg-slate-800/50 py-3.5 pr-4 pl-12 text-white transition-colors placeholder:text-gray-600 focus:border-purple-500 focus:outline-none"
                required
                maxLength={20}
              />
            </div>
            {usernameHint && <p className="ml-1 text-xs text-amber-400">{usernameHint}</p>}
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="ml-1 text-xs font-bold text-gray-400 uppercase">
              Senha
            </label>
            <div className="relative">
              <Lock className="absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2 text-gray-500" />
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={isLogin ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isLogin ? 'Sua senha' : 'Mínimo de 8 caracteres'}
                className="w-full rounded-xl border border-white/10 bg-slate-800/50 py-3.5 pr-12 pl-12 text-white transition-colors placeholder:text-gray-600 focus:border-purple-500 focus:outline-none"
                required
                minLength={isLogin ? 6 : 8}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute top-1/2 right-3 -translate-y-1/2 rounded-lg p-1.5 text-gray-500 hover:text-white"
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {!isLogin && (
              <p className="ml-1 text-xs text-gray-500">
                Não há recuperação de senha por e-mail. Guarde sua senha em um lugar seguro.
              </p>
            )}
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="rounded-lg border border-red-500/20 bg-red-500/10 py-2 text-center text-sm text-red-400"
              role="alert"
            >
              {error}
            </motion.div>
          )}

          <button
            type="submit"
            disabled={loading || Boolean(usernameHint)}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 py-4 font-bold text-white shadow-lg shadow-purple-500/20 transition-all hover:from-purple-500 hover:to-blue-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                {isLogin ? 'Entrar na plataforma' : 'Criar conta grátis'}
                <ArrowRight className="h-5 w-5" />
              </>
            )}
          </button>
        </form>
      </motion.div>
    </div>
  );
};

export default Auth;
