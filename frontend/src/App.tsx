import { useState } from 'react'
import type { ReactNode } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { ToastProvider } from './context/ToastContext'
import { AppProvider } from './context/AppContext'
import { AuthProvider, useAuth } from './context/AuthContext'
import { FpaResultProvider } from './context/FpaResultContext'
import type { User } from './context/AuthContext'
import Toaster from './components/Toaster'
import AppHeader from './components/AppHeader'
import Sidebar from './components/Sidebar'
import Login from './pages/Login'
import ForgotPassword from './pages/ForgotPassword'
import HomePage from './pages/HomePage'
import Step1Generate from './pages/Step1Generate'
import Step2Preview from './pages/Step2Preview'
import Step3Mapping from './pages/Step3Mapping'
import Step4QuickBooks from './pages/Step4QuickBooks'
import Step5ActivityLog from './pages/Step5ActivityLog'
import UserManagement from './pages/UserManagement'

// FP&A pages (lazy-loaded as JSX, Vite handles them fine)
import FpaGenerate        from './pages/fpa/GeneratePage'
import FpaDashboard       from './pages/fpa/DashboardPage'
import FpaStaging         from './pages/fpa/StagingPage'
import FpaBaseBS          from './pages/fpa/BaseBSPage'
import FpaBSIndividual    from './pages/fpa/BSIndividualPage'
import FpaPLIndividual    from './pages/fpa/PLIndividualPage'
import FpaComparativePL   from './pages/fpa/ComparativePLPage'
import FpaComparativePLBD from './pages/fpa/ComparativePLBDPage'

function ProtectedApp() {
  const { isAuthenticated, user, logout } = useAuth()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [darkMode, setDarkMode] = useState(false)

  const toggleDark = () => {
    setDarkMode(d => {
      document.documentElement.setAttribute('data-theme', d ? 'light' : 'dark')
      return !d
    })
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />

  return (
    <AppProvider>
      <FpaResultProvider>
        <div className="app-shell">
          <AppHeader user={user} onLogout={logout} darkMode={darkMode} onToggleDark={toggleDark} />
          <div className="app-body">
            <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(v => !v)} />
            <main className="main-content">
              <Routes>
                <Route path="/" element={<HomePage />} />

                {/* Payroll JE routes */}
                <Route path="/step/1" element={<PayrollRoute user={user}><Step1Generate /></PayrollRoute>} />
                <Route path="/step/2" element={<PayrollRoute user={user}><Step2Preview /></PayrollRoute>} />
                <Route path="/step/3" element={<PayrollRoute user={user}><Step3Mapping /></PayrollRoute>} />
                <Route path="/step/4" element={<PayrollRoute user={user}><Step4QuickBooks /></PayrollRoute>} />
                <Route path="/step/5" element={<Navigate to="/activity-log" replace />} />
                <Route path="/activity-log" element={<PayrollRoute user={user}><Step5ActivityLog /></PayrollRoute>} />

                {/* FP&A routes */}
                <Route path="/fpa/" element={<FpaRoute user={user}><FpaGenerate /></FpaRoute>} />
                <Route path="/fpa/dashboard"        element={<FpaRoute user={user}><FpaDashboard /></FpaRoute>} />
                <Route path="/fpa/staging"          element={<FpaRoute user={user}><FpaStaging /></FpaRoute>} />
                <Route path="/fpa/base-bs"          element={<FpaRoute user={user}><FpaBaseBS /></FpaRoute>} />
                <Route path="/fpa/bs-individual"    element={<FpaRoute user={user}><FpaBSIndividual /></FpaRoute>} />
                <Route path="/fpa/pl-individual"    element={<FpaRoute user={user}><FpaPLIndividual /></FpaRoute>} />
                <Route path="/fpa/comparative-pl"   element={<FpaRoute user={user}><FpaComparativePL /></FpaRoute>} />
                <Route path="/fpa/comparative-pl-bd" element={<FpaRoute user={user}><FpaComparativePLBD /></FpaRoute>} />

                {/* Admin */}
                <Route path="/users" element={<AdminRoute user={user}><UserManagement /></AdminRoute>} />
              </Routes>
            </main>
          </div>
        </div>
      </FpaResultProvider>
    </AppProvider>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <Toaster />
      <AuthProvider>
        <Routes>
          <Route path="/login"           element={<PublicRoute><Login /></PublicRoute>} />
          <Route path="/forgot-password" element={<PublicRoute><ForgotPassword /></PublicRoute>} />
          <Route path="/*" element={<ProtectedApp />} />
        </Routes>
      </AuthProvider>
    </ToastProvider>
  )
}

function PublicRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth()
  return isAuthenticated ? <Navigate to="/" replace /> : <>{children}</>
}

function AdminRoute({ user, children }: { user: User | null; children: ReactNode }) {
  return user?.role === 'admin' ? <>{children}</> : <Navigate to="/" replace />
}

function PayrollRoute({ user, children }: { user: User | null; children: ReactNode }) {
  const ok = user?.role === 'admin' || user?.can_access_payroll
  return ok ? <>{children}</> : <Navigate to="/" replace />
}

function FpaRoute({ user, children }: { user: User | null; children: ReactNode }) {
  const ok = user?.role === 'admin' || user?.can_access_fpa
  return ok ? <>{children}</> : <Navigate to="/" replace />
}
