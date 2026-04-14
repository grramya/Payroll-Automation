import { createContext, useContext, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import axios from 'axios'
import { logoutApi } from '../api/api'

export interface User {
  username: string
  role: string
}

interface LoginResponse {
  access_token: string
  username: string
  role: string
}

interface AuthContextValue {
  token: string | null
  user: User | null
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  isAuthenticated: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

const TOKEN_KEY = 'pje_token'
const USER_KEY  = 'pje_user'

function readStorage(key: string): string | null {
  return localStorage.getItem(key) || sessionStorage.getItem(key) || null
}

function clearStorage(key: string): void {
  localStorage.removeItem(key)
  sessionStorage.removeItem(key)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => readStorage(TOKEN_KEY))
  const [user,  setUser]  = useState<User | null>(() => {
    try {
      const raw = readStorage(USER_KEY)
      return raw ? (JSON.parse(raw) as User) : null
    } catch {
      return null
    }
  })

  const login = useCallback(async (username: string, password: string) => {
    const form = new URLSearchParams()
    form.append('username', username)
    form.append('password', password)

    const { data } = await axios.post<LoginResponse>('/api/auth/login', form, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })

    localStorage.setItem(TOKEN_KEY, data.access_token)
    localStorage.setItem(USER_KEY,  JSON.stringify({ username: data.username, role: data.role }))

    setToken(data.access_token)
    setUser({ username: data.username, role: data.role })
  }, [])

  const logout = useCallback(async () => {
    try {
      await logoutApi()
    } catch {
      // Always clear local credentials even if the server call fails
    } finally {
      clearStorage(TOKEN_KEY)
      clearStorage(USER_KEY)
      setToken(null)
      setUser(null)
    }
  }, [])

  return (
    <AuthContext.Provider
      value={{ token, user, login, logout, isAuthenticated: !!token }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}
