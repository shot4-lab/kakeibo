"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Wallet, LogIn, UserPlus, Mail, Lock, User } from "lucide-react";

export default function LoginPage() {
  const [emailOrUsername, setEmailOrUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [username, setUsername] = useState(""); // Sign up only
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (isSignUp) {
        if (!username) throw new Error("ユーザーIDを入力してください。");
        // サインアップ時はメールアドレスとして処理
        const { error } = await supabase.auth.signUp({
          email: emailOrUsername.includes("@") ? emailOrUsername : `${emailOrUsername}@kakeibo.local`,
          password,
          options: {
            data: { username },
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });
        if (error) throw error;
        alert("アカウントを作成しました。ログインしてください。");
        setIsSignUp(false);
      } else {
        // ログイン時はID（英数字）かメールアドレスか判別
        const loginEmail = emailOrUsername.includes("@") 
          ? emailOrUsername 
          : `${emailOrUsername}@kakeibo.local`;

        const { error } = await supabase.auth.signInWithPassword({
          email: loginEmail,
          password,
        });
        if (error) throw error;
        router.push("/");
        router.refresh();
      }
    } catch (err: any) {
      setError(err.message || "認証に失敗しました。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="bg-white rounded-3xl shadow-xl p-8 ring-1 ring-slate-100">
          <div className="flex flex-col items-center gap-4 mb-8 text-center">
            <div className="rounded-2xl bg-slate-900 p-3 text-white shadow-lg">
              <Wallet className="h-8 w-8" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">
                {isSignUp ? "アカウント作成" : "ログイン"}
              </h1>
              <p className="text-sm text-slate-500 mt-1">
                {isSignUp ? "新しい家計簿を始めましょう" : "家計簿にアクセスして管理しましょう"}
              </p>
            </div>
          </div>

          <form onSubmit={handleAuth} className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <User className="h-3 w-3" /> ユーザーID または メールアドレス
              </label>
              <input
                type="text"
                required
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-500/10"
                value={emailOrUsername}
                onChange={(e) => setEmailOrUsername(e.target.value)}
                placeholder="ID（英数字）または email@example.com"
              />
            </div>

            {isSignUp && (
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <User className="h-3 w-3" /> 表示名（ユーザー名）
                </label>
                <input
                  type="text"
                  required
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-500/10"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="お名前（例：お母さん）"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Lock className="h-3 w-3" /> パスワード
              </label>
              <input
                type="password"
                required
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-500/10"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="text-xs font-bold text-rose-500 bg-rose-50 p-3 rounded-xl border border-rose-100">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-2xl bg-slate-900 py-4 text-sm font-bold text-white shadow-lg shadow-slate-900/20 transition active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? (
                "処理中..."
              ) : isSignUp ? (
                <>
                  <UserPlus className="h-4 w-4" />
                  アカウント作成
                </>
              ) : (
                <>
                  <LogIn className="h-4 w-4" />
                  ログイン
                </>
              )}
            </button>
          </form>

          <div className="mt-8 pt-8 border-t border-slate-100 text-center">
            <button
              type="button"
              onClick={() => setIsSignUp(!isSignUp)}
              className="text-sm font-bold text-sky-600 hover:text-sky-700 transition"
            >
              {isSignUp ? "すでにアカウントをお持ちの方" : "新しくアカウントを作成する"}
            </button>
          </div>
        </div>
      </motion.div>
    </main>
  );
}
