import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, useEffect, Component, lazy, Suspense } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { ToastProvider } from './context/ToastContext'
import { AppProvider } from './context/AppContext'
import { AuthProvider, useAuth } from './context/AuthContext'
import { FpaResultProvider } from './context/FpaResultContext'
import { PortcoProvider } from './context/PortcoContext'
import type { User } from './context/AuthContext'
import Toaster from './components/Toaster'
import AppHeader from './components/AppHeader'
import Sidebar from './components/Sidebar'
import Spinner from './components/Spinner'

// Eagerly load auth pages (tiny, needed immediately)
import Login from './pages/Login'
import ForgotPassword from './pages/ForgotPassword'

// Lazy-load heavy pages so they only download when the user navigates to them.
// Each group lives in the same Vite chunk (see vite.config.ts manualChunks).
const HomePage        = lazy(() => import('./pages/HomePage'))
const Step1Generate   = lazy(() => import('./pages/Step1Generate'))
const Step2Preview    = lazy(() => import('./pages/Step2Preview'))
const Step3Mapping    = lazy(() => import('./pages/Step3Mapping'))
const Step4QuickBooks = lazy(() => import('./pages/Step4QuickBooks'))
const Step5ActivityLog = lazy(() => import('./pages/Step5ActivityLog'))
const UserManagement  = lazy(() => import('./pages/UserManagement'))

const FpaGenerate        = lazy(() => import('./pages/fpa/GeneratePage'))
const FpaDashboard       = lazy(() => import('./pages/fpa/DashboardPage'))
const FpaStaging         = lazy(() => import('./pages/fpa/StagingPage'))
const FpaBaseBS          = lazy(() => import('./pages/fpa/BaseBSPage'))
const FpaBSIndividual    = lazy(() => import('./pages/fpa/BSIndividualPage'))
const FpaPLIndividual    = lazy(() => import('./pages/fpa/PLIndividualPage'))
const FpaComparativePL   = lazy(() => import('./pages/fpa/ComparativePLPage'))
const FpaComparativePLBD = lazy(() => import('./pages/fpa/ComparativePLBDPage'))
const FpaMapping         = lazy(() => import('./pages/fpa/MappingPage'))

const PortcoApp = lazy(() => import('./pages/portco/index'))

const ChatWidget = lazy(() => import('./components/chat/ChatWidget'))

// ── Error Boundary ────────────────────────────────────────────────────────────

interface EBState { hasError: boolean; error: Error | null }

class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, EBState> {
  state: EBState = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): EBState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.label ?? 'page'}]`, error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '40px 32px',
          maxWidth: 560,
          margin: '80px auto',
          background: 'var(--surface, #fff)',
          borderRadius: 12,
          boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
          textAlign: 'center',
        }}>
          <span
            className="material-icons-round"
            style={{ fontSize: 48, color: '#d32f2f', display: 'block', marginBottom: 16 }}
          >
            error_outline
          </span>
          <h2 style={{ margin: '0 0 12px', fontSize: 20, color: '#d32f2f' }}>
            Something went wrong
          </h2>
          <p style={{ color: 'var(--muted, #666)', marginBottom: 24, fontSize: 14 }}>
            {this.state.error?.message ?? 'An unexpected error occurred.'}
          </p>
          <button
            className="btn btn-primary"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Try again
          </button>
          <button
            className="btn btn-secondary"
            style={{ marginLeft: 12 }}
            onClick={() => window.location.href = '/'}
          >
            Go home
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// ── Suspense wrapper ──────────────────────────────────────────────────────────

function PageSuspense({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ErrorBoundary label={label}>
      <Suspense fallback={<Spinner label="Loading…" />}>
        {children}
      </Suspense>
    </ErrorBoundary>
  )
}

// ── Route guards ──────────────────────────────────────────────────────────────

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

function PortcoRoute({ user, children }: { user: User | null; children: ReactNode }) {
  const ok = user?.role === 'admin' || user?.can_access_portco
  return ok ? <>{children}</> : <Navigate to="/" replace />
}

// ── Protected shell ───────────────────────────────────────────────────────────

function ProtectedApp() {
  const { isAuthenticated, sessionVerified, user, logout } = useAuth()
  const [sidebarCollapsed,   setSidebarCollapsed]   = useState(false)
  const [mobileSidebarOpen,  setMobileSidebarOpen]  = useState(false)
  const location = useLocation()

  useEffect(() => { setMobileSidebarOpen(false) }, [location.pathname])

  // While verifying the session cookie don't render anything — avoids a flash
  // of the login page for already-authenticated users.
  if (!sessionVerified) return <Spinner label="Checking session…" />
  if (!isAuthenticated) return <Navigate to="/login" replace />

  return (
    <AppProvider>
      <FpaResultProvider>
      <PortcoProvider>
        <div className="app-shell">
          <AppHeader
            user={user}
            onLogout={logout}
            onMobileToggle={() => setMobileSidebarOpen(v => !v)}
            mobileOpen={mobileSidebarOpen}
          />
          <div className="app-body">
            <Sidebar
              collapsed={sidebarCollapsed}
              onToggle={() => setSidebarCollapsed(v => !v)}
              mobileOpen={mobileSidebarOpen}
              onMobileClose={() => setMobileSidebarOpen(false)}
            />
            <main id="main-content" className="main-content" tabIndex={-1}>
              <Routes>
                <Route path="/" element={<PageSuspense label="home"><HomePage /></PageSuspense>} />

                {/* Payroll JE */}
                <Route path="/step/1" element={<PayrollRoute user={user}><PageSuspense label="step1"><Step1Generate /></PageSuspense></PayrollRoute>} />
                <Route path="/step/2" element={<PayrollRoute user={user}><PageSuspense label="step2"><Step2Preview /></PageSuspense></PayrollRoute>} />
                <Route path="/step/3" element={<PayrollRoute user={user}><PageSuspense label="step3"><Step3Mapping /></PageSuspense></PayrollRoute>} />
                <Route path="/step/4" element={<PayrollRoute user={user}><PageSuspense label="step4"><Step4QuickBooks /></PageSuspense></PayrollRoute>} />
                <Route path="/step/5" element={<Navigate to="/activity-log" replace />} />
                <Route path="/activity-log" element={<PayrollRoute user={user}><PageSuspense label="activity-log"><Step5ActivityLog /></PageSuspense></PayrollRoute>} />

                {/* FP&A */}
                <Route path="/fpa/"               element={<FpaRoute user={user}><PageSuspense label="fpa-generate"><FpaGenerate /></PageSuspense></FpaRoute>} />
                <Route path="/fpa/dashboard"       element={<FpaRoute user={user}><PageSuspense label="fpa-dashboard"><FpaDashboard /></PageSuspense></FpaRoute>} />
                <Route path="/fpa/staging"         element={<FpaRoute user={user}><PageSuspense label="fpa-staging"><FpaStaging /></PageSuspense></FpaRoute>} />
                <Route path="/fpa/base-bs"         element={<FpaRoute user={user}><PageSuspense label="fpa-base-bs"><FpaBaseBS /></PageSuspense></FpaRoute>} />
                <Route path="/fpa/bs-individual"   element={<FpaRoute user={user}><PageSuspense label="fpa-bsi"><FpaBSIndividual /></PageSuspense></FpaRoute>} />
                <Route path="/fpa/pl-individual"   element={<FpaRoute user={user}><PageSuspense label="fpa-pli"><FpaPLIndividual /></PageSuspense></FpaRoute>} />
                <Route path="/fpa/comparative-pl"  element={<FpaRoute user={user}><PageSuspense label="fpa-comp-pl"><FpaComparativePL /></PageSuspense></FpaRoute>} />
                <Route path="/fpa/comparative-pl-bd" element={<FpaRoute user={user}><PageSuspense label="fpa-comp-pl-bd"><FpaComparativePLBD /></PageSuspense></FpaRoute>} />
                <Route path="/fpa/mapping"         element={<FpaRoute user={user}><PageSuspense label="fpa-mapping"><FpaMapping /></PageSuspense></FpaRoute>} />

                {/* PortCo */}
                <Route path="/portco/*" element={<PortcoRoute user={user}><PageSuspense label="portco"><PortcoApp /></PageSuspense></PortcoRoute>} />

                {/* Admin */}
                <Route path="/users" element={<AdminRoute user={user}><PageSuspense label="user-mgmt"><UserManagement /></PageSuspense></AdminRoute>} />
              </Routes>
            </main>
          </div>
        </div>
        <PageSuspense label="chat-widget"><ChatWidget /></PageSuspense>
      </PortcoProvider>
      </FpaResultProvider>
    </AppProvider>
  )
}

// ── React Query client ────────────────────────────────────────────────────────

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

// ── Root ──────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <Toaster />
        <AuthProvider>
          <Routes>
            <Route path="/login"           element={<PublicRoute><Login /></PublicRoute>} />
            <Route path="/forgot-password" element={<PublicRoute><ForgotPassword /></PublicRoute>} />
            <Route path="/*"               element={<ProtectedApp />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  )
}
