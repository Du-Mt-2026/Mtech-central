'use client'

// Extracted verbatim from src/app/page.tsx (P2.1-split-4).
// All logic preserved — pure mechanical extraction.
// The login screen JSX is copied verbatim from the original `if (!loggedIn) { return (...) }`
// block of OctupusZapApp. All state and setters are passed as props with their original
// names so the inline event handlers (which call setLoginForm / setLoginError / etc.)
// work without any code modification.

import { motion } from 'framer-motion'
import {
  AlertTriangle, Lock, RefreshCw, ShieldCheck, XCircle, Zap,
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogDescription } from '@/components/ui/dialog'

export interface LoginScreenProps {
  loginForm: { email: string; password: string }
  setLoginForm: React.Dispatch<React.SetStateAction<{ email: string; password: string }>>
  loginLoading: boolean
  loginError: string
  loginErrorType: 'credentials' | 'locked' | 'database' | 'internal' | ''
  setLoginError: (v: string) => void
  setLoginErrorType: (v: 'credentials' | 'locked' | 'database' | 'internal' | '') => void
  forgotDialogOpen: boolean
  setForgotDialogOpen: (open: boolean) => void
  forgotForm: { newPassword: string; confirmPassword: string; verificationKey: string }
  setForgotForm: React.Dispatch<React.SetStateAction<{ newPassword: string; confirmPassword: string; verificationKey: string }>>
  forgotLoading: boolean
  handleLogin: () => void
  handleForgotPassword: () => void
}

export function LoginScreen(props: LoginScreenProps) {
  const {
    loginForm, setLoginForm, loginLoading, loginError, loginErrorType,
    setLoginError, setLoginErrorType,
    forgotDialogOpen, setForgotDialogOpen,
    forgotForm, setForgotForm, forgotLoading,
    handleLogin, handleForgotPassword,
  } = props

  return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900 p-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="w-full max-w-md">
          <Card className="shadow-2xl border-zinc-700/50 bg-zinc-900/80 backdrop-blur-xl">
            <CardHeader className="text-center pb-2">
              <div className="flex justify-center mb-4">
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.2, duration: 0.4 }}
                  className="flex size-20 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 shadow-xl shadow-emerald-500/25"
                >
                  <Zap className="size-10 text-white" />
                </motion.div>
              </div>
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
                <CardTitle className="text-2xl text-white">OctupusZap</CardTitle>
                <CardDescription className="text-zinc-400">Faça login para acessar o painel</CardDescription>
              </motion.div>
            </CardHeader>
            <CardContent className="space-y-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="space-y-4">
                {/* Login Error Banner */}
                {loginError && (
                  <motion.div
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`rounded-lg p-3 text-sm flex items-start gap-2 ${
                      loginErrorType === 'locked'
                        ? 'bg-amber-500/15 border border-amber-500/30 text-amber-300'
                        : loginErrorType === 'database'
                        ? 'bg-sky-500/15 border border-sky-500/30 text-sky-300'
                        : loginErrorType === 'credentials'
                        ? 'bg-rose-500/15 border border-rose-500/30 text-rose-300'
                        : 'bg-rose-500/15 border border-rose-500/30 text-rose-300'
                    }`}
                  >
                    {loginErrorType === 'locked' ? <AlertTriangle className="size-4 mt-0.5 shrink-0" /> : <XCircle className="size-4 mt-0.5 shrink-0" />}
                    <span>{loginError}</span>
                  </motion.div>
                )}
                <div className="space-y-2">
                  <Label className="text-zinc-300">Email</Label>
                  <Input
                    placeholder="seu@email.com"
                    value={loginForm.email}
                    onChange={e => { setLoginForm(p => ({ ...p, email: e.target.value })); setLoginError(''); setLoginErrorType('') }}
                    className="bg-zinc-800/50 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-emerald-500 focus:ring-emerald-500/20"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-zinc-300">Senha</Label>
                  <Input
                    type="password"
                    placeholder="••••••"
                    value={loginForm.password}
                    onChange={e => { setLoginForm(p => ({ ...p, password: e.target.value })); setLoginError(''); setLoginErrorType('') }}
                    onKeyDown={e => e.key === 'Enter' && handleLogin()}
                    className="bg-zinc-800/50 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-emerald-500 focus:ring-emerald-500/20"
                  />
                </div>
                <Button
                  className="w-full gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-lg shadow-emerald-500/25 text-white font-semibold h-11"
                  onClick={handleLogin}
                  disabled={loginLoading || !loginForm.email || !loginForm.password}
                >
                  {loginLoading ? <RefreshCw className="size-4 animate-spin" /> : <Lock className="size-4" />}
                  {loginLoading ? 'Entrando...' : 'Entrar'}
                </Button>
                <div className="flex items-center justify-center">
                  <button
                    type="button"
                    className="text-xs text-zinc-500 hover:text-emerald-400 transition-colors underline underline-offset-2"
                    onClick={() => setForgotDialogOpen(true)}
                  >
                    Esqueceu a senha?
                  </button>
                </div>
              </motion.div>
            </CardContent>
          </Card>

          {/* Forgot Password Dialog */}
          <Dialog open={forgotDialogOpen} onOpenChange={setForgotDialogOpen}>
            <DialogContent className="bg-zinc-900 border-zinc-700 text-white">
              <DialogHeader>
                <DialogTitle className="text-white">Redefinir Senha</DialogTitle>
                <DialogDescription className="text-zinc-400">
                  Crie uma nova senha para acessar o painel. A recuperação é protegida pelo código de segurança do servidor.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label className="text-zinc-300">Código de Segurança (AUTH_SECRET)</Label>
                  <Input
                    type="password"
                    placeholder="Cole o AUTH_SECRET do arquivo .env do servidor"
                    value={forgotForm.verificationKey}
                    onChange={e => setForgotForm(p => ({ ...p, verificationKey: e.target.value }))}
                    className="bg-zinc-800/50 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-emerald-500"
                  />
                  <p className="text-xs text-zinc-500">Encontre no servidor: /opt/octupuszap/.env → AUTH_SECRET</p>
                </div>
                <div className="space-y-2">
                  <Label className="text-zinc-300">Nova Senha</Label>
                  <Input
                    type="password"
                    placeholder="Mínimo 6 caracteres"
                    value={forgotForm.newPassword}
                    onChange={e => setForgotForm(p => ({ ...p, newPassword: e.target.value }))}
                    className="bg-zinc-800/50 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-emerald-500"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-zinc-300">Confirmar Nova Senha</Label>
                  <Input
                    type="password"
                    placeholder="Repita a nova senha"
                    value={forgotForm.confirmPassword}
                    onChange={e => setForgotForm(p => ({ ...p, confirmPassword: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && handleForgotPassword()}
                    className="bg-zinc-800/50 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-emerald-500"
                  />
                </div>
                <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 flex items-start gap-2">
                  <AlertTriangle className="size-4 text-amber-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-400">Por segurança, é necessário informar o AUTH_SECRET (do arquivo .env do servidor) para redefinir a senha. Isso garante que apenas administradores com acesso ao servidor possam alterar a senha.</p>
                </div>
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline" className="border-zinc-700 text-zinc-300 hover:bg-zinc-800">Cancelar</Button>
                </DialogClose>
                <Button
                  className="gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white"
                  onClick={handleForgotPassword}
                  disabled={forgotLoading || !forgotForm.newPassword || !forgotForm.confirmPassword || !forgotForm.verificationKey}
                >
                  {forgotLoading ? <RefreshCw className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                  {forgotLoading ? 'Redefinindo...' : 'Redefinir Senha'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </motion.div>
      </div>
  )
}
