import { createContext, useContext, useState, useCallback } from 'react'
import axios from 'axios'
import { logoutApi } from '../api/api'

const AuthContext = createContext(null)

const TOKEN_KEY = 'pje_token'
const USER_KEY  = 'pje_user'

/**
 * Read a value from localStorage first, fall back to sessionStorage.
 * This covers both "remember me" (localStorage) and session-only (sessionStorage) logins.
 */
function readStorage(key) {
  return localStorage.getItem(key) || sessionStorage.getItem(key) || null
}

/** Remove a key from both storages. */
function clearStorage(key) {
  localStorage.removeItem(key)
  sessionStorage.removeItem(key)
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => readStorage(TOKEN_KEY))
  const [user,  setUser]  = useState(() => {
    try {
      const raw = readStorage(USER_KEY)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  })

  const login = useCallback(async (username, password) => {
    const form = new URLSearchParams()
    form.append('username', username)
    form.append('password', password)

    const { data } = await axios.post('/api/auth/login', form, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })

    localStorage.setItem(TOKEN_KEY, data.access_token)
    localStorage.setItem(USER_KEY,  JSON.stringify({ username: data.username, role: data.role }))

    setToken(data.access_token)
    setUser({ username: data.username, role: data.role })
  }, [])

  /**
   * Sign out:
   *  1. Tell the backend to blacklist the token.
   *  2. Wipe credentials from all storages regardless of API result.
   *  3. Reset React state → app redirects to /login.
   */
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

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}
