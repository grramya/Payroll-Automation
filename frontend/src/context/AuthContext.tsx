import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import type { ReactNode } from 'react'
import axios from 'axios'
import { logoutApi } from '../api/api'

export interface User {
  username: string
  role: string
  can_access_payroll: boolean
  can_access_fpa: boolean
  can_access_portco: boolean
  portco_dept?: string | null
}

interface LoginResponse {
  username: string
  role: string
  can_access_payroll: boolean
  can_access_fpa: boolean
  can_access_portco: boolean
  portco_dept?: string | null
}

interface AuthContextValue {
  user: User | null
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  isAuthenticated: boolean
  /** True once the initial /me session check has resolved. */
  sessionVerified: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

// We store only the non-sensitive user profile (no token) in localStorage.
// The actual JWT lives in an httpOnly cookie that JS cannot read.
const USER_KEY = 'pje_user'

function readUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? (JSON.parse(raw) as User) : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,            setUser]            = useState<User | null>(readUser)
  const [sessionVerified, setSessionVerified] = useState(false)

  // On mount: verify the httpOnly cookie session is still valid via /api/auth/me.
  // If the server returns 401 the cookie has expired or been revoked — clear local state.
  useEffect(() => {
    const storedUser = localStorage.getItem(USER_KEY)
    if (!storedUser) {
      // Nothing stored — no need to verify, just mark ready
      setSessionVerified(true)
      return
    }
    axios
      .get<User>('/api/auth/me', { withCredentials: true })
      .then((res) => {
        // Refresh stored profile with latest server data (roles/permissions may have changed)
        localStorage.setItem(USER_KEY, JSON.stringify(res.data))
        setUser(res.data)
      })
      .catch(() => {
        // Cookie expired, revoked, or server unreachable — force re-login
        localStorage.removeItem(USER_KEY)
        setUser(null)
      })
      .finally(() => setSessionVerified(true))
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    const form = new URLSearchParams()
    form.append('username', username)
    form.append('password', password)

    // withCredentials = true so the browser stores the httpOnly cookie from Set-Cookie
    const { data } = await axios.post<LoginResponse>('/api/auth/login', form, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      withCredentials: true,
    })

    const userObj: User = {
      username:           data.username,
      role:               data.role,
      can_access_payroll: data.can_access_payroll,
      can_access_fpa:     data.can_access_fpa,
      can_access_portco:  data.can_access_portco,
      portco_dept:        data.portco_dept ?? null,
    }

    // Store user profile (non-sensitive) for instant UI hydration on next page load
    localStorage.setItem(USER_KEY, JSON.stringify(userObj))
    setUser(userObj)
  }, [])

  const logout = useCallback(async () => {
    try {
      await logoutApi()
    } catch {
      // Always clear local credentials even if the server call fails
    } finally {
      localStorage.removeItem(USER_KEY)
      setUser(null)
    }
  }, [])

  return (
    <AuthContext.Provider
      value={{
        user,
        login,
        logout,
        isAuthenticated: !!user,
        sessionVerified,
      }}
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
