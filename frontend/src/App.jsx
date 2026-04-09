import { useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { ToastProvider } from './context/ToastContext'
import { AppProvider } from './context/AppContext'
import { AuthProvider, useAuth } from './context/AuthContext'
import Toaster from './components/Toaster'
import AppHeader from './components/AppHeader'
import Sidebar from './components/Sidebar'
import Login from './pages/Login'
import ForgotPassword from './pages/ForgotPassword'
import Step1Generate from './pages/Step1Generate'
import Step2Preview from './pages/Step2Preview'
import Step3Mapping from './pages/Step3Mapping'
import Step4QuickBooks from './pages/Step4QuickBooks'
import Step5ActivityLog from './pages/Step5ActivityLog'
import UserManagement from './pages/UserManagement'

function ProtectedApp() {
  const { isAuthenticated, user, logout } = useAuth()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  if (!isAuthenticated) return <Navigate to="/login" replace />

  return (
    <AppProvider>
      <div className="app-shell">
        <AppHeader user={user} onLogout={logout} />
        <div className="app-body">
          <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(v => !v)} />
          <main className="main-content">
            <Routes>
              <Route path="/" element={<Navigate to="/step/1" replace />} />
              <Route path="/step/1" element={<Step1Generate />} />
              <Route path="/step/2" element={<Step2Preview />} />
              <Route path="/step/3" element={<Step3Mapping />} />
              <Route path="/step/4" element={<Step4QuickBooks />} />
              <Route path="/step/5" element={<Navigate to="/activity-log" replace />} />
              <Route path="/activity-log" element={<Step5ActivityLog />} />
              <Route path="/users" element={<AdminRoute user={user}><UserManagement /></AdminRoute>} />
            </Routes>
          </main>
        </div>
      </div>
    </AppProvider>
  )
}

export default function App() {
  return (
    <ToastProvider>
      {/* Toaster renders outside AuthProvider so it works on every page including login */}
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

function PublicRoute({ children }) {
  const { isAuthenticated } = useAuth()
  return isAuthenticated ? <Navigate to="/step/1" replace /> : children
}

function AdminRoute({ user, children }) {
  return user?.role === 'admin' ? children : <Navigate to="/step/1" replace />
}
