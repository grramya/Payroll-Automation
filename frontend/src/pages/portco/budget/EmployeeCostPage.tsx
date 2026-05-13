import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CSSProperties } from 'react';
import {
  Button, TextField, MenuItem, Alert,
  CircularProgress, IconButton, Tooltip,
} from '@mui/material';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs from 'dayjs';
import { apiClient } from '../../../api/api';
import { StepNav } from '../components/WorkflowBanner';
import {
  buildReport, fmt, fmtPct,
  MONTH_LABELS,
  resolveBonus, computeTotal,
} from './employeeCostCalc';
import type { EmployeeRecord } from './employeeCostCalc';

const BRAND = '#512D6D';
const GEOGRAPHIES = ['Concertiv', 'Vearc'];
const DEPARTMENTS = [
  'Product Development', 'Sales', 'Marketing', 'Customer Success', 'Finance',
];

// ── table cell styles ─────────────────────────────────────────────────────────
const TH: CSSProperties = {
  padding: '7px 10px', background: '#F1F5F9', fontWeight: 700,
  fontSize: '0.72rem', whiteSpace: 'nowrap', borderBottom: '1px solid #E2E8F0',
  color: '#334155', position: 'sticky', top: 0, zIndex: 2,
};
const TD: CSSProperties = {
  padding: '6px 10px', fontSize: '0.78rem', borderBottom: '1px solid #F1F5F9',
  whiteSpace: 'nowrap',
};
const TD_NUM: CSSProperties = { ...TD, textAlign: 'right', fontFamily: 'monospace' };
const TD_TOTAL: CSSProperties = {
  ...TD_NUM, fontWeight: 700, background: '#EFF6FF', color: '#1D4ED8',
};
const TR_SUM: CSSProperties = { background: '#F0FDF4' };
const TR_COST: CSSProperties = { background: '#FEF9C3' };

// ── form field type ───────────────────────────────────────────────────────────
interface FormState {
  geography: string;
  name: string;
  title: string;
  start_date: string | null;
  base_salary: string;
  bonus_pct: string;
  bonus_amount: string;
  taxes_benefits_pct: string;
  hike_cycle_pct: string;
  payroll_expenses: string;
  tech_stipend: string;
}

const EMPTY_FORM: FormState = {
  geography: '', name: '', title: '', start_date: null,
  base_salary: '', bonus_pct: '', bonus_amount: '',
  taxes_benefits_pct: '', hike_cycle_pct: '', payroll_expenses: '', tech_stipend: '',
};

interface Props {
  year: number;
  userDept: string | null;
  isAdmin: boolean;
}

export default function EmployeeCostPage({ year, userDept, isAdmin }: Props) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<EmployeeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 'idle' | 'submitted' | 'updated'
  const [submitState, setSubmitState] = useState<'idle' | 'submitted' | 'updated'>('idle');
  const [lastSubmittedId, setLastSubmittedId] = useState<number | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof FormState, string>>>({});

  // Admin: optional dept filter for the report
  const [filterDept, setFilterDept] = useState('');
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  // Prevent bonus % ↔ amount infinite update loops
  const bonusPctChanging = useRef(false);
  const bonusAmtChanging = useRef(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { year };
      if (isAdmin && filterDept) params.department = filterDept;
      const { data } = await apiClient.get<EmployeeRecord[]>('/portco/budget/employee-cost', { params });
      setRows(data);
    } catch (e: any) {
      if (isAdmin) setError(e?.response?.data?.detail ?? 'Failed to load data');
    } finally {
      setLoading(false);
      setHasLoaded(true);
    }
  }, [year, isAdmin, filterDept]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── form helpers ──────────────────────────────────────────────────────────
  const isConcer = form.geography === 'Concertiv';

  function setField(k: keyof FormState, v: string | null) {
    setForm(prev => ({ ...prev, [k]: v ?? '' }));
    setFormErrors(prev => ({ ...prev, [k]: undefined }));
  }

  function handleBonusPctChange(raw: string) {
    if (bonusAmtChanging.current) return;
    bonusPctChanging.current = true;
    const pct  = parseFloat(raw) / 100;
    const base = parseFloat(form.base_salary) || 0;
    const amt  = isNaN(pct) ? '' : String((base * pct).toFixed(2));
    setForm(prev => ({ ...prev, bonus_pct: raw, bonus_amount: amt }));
    setFormErrors(prev => ({ ...prev, bonus_pct: undefined, bonus_amount: undefined }));
    bonusPctChanging.current = false;
  }

  function handleBonusAmtChange(raw: string) {
    if (bonusPctChanging.current) return;
    bonusAmtChanging.current = true;
    const amt  = parseFloat(raw);
    const base = parseFloat(form.base_salary) || 0;
    const pct  = (isNaN(amt) || base === 0) ? '' : String(((amt / base) * 100).toFixed(4));
    setForm(prev => ({ ...prev, bonus_amount: raw, bonus_pct: pct }));
    setFormErrors(prev => ({ ...prev, bonus_pct: undefined, bonus_amount: undefined }));
    bonusAmtChanging.current = false;
  }

  function validate(): boolean {
    const errs: Partial<Record<keyof FormState, string>> = {};
    if (!form.geography) errs.geography = 'Required';
    if (!form.name.trim()) errs.name = 'Required';
    if (!form.title.trim()) errs.title = 'Required';
    if (!form.base_salary || isNaN(Number(form.base_salary))) errs.base_salary = 'Required numeric';
    if (form.taxes_benefits_pct === '' || isNaN(Number(form.taxes_benefits_pct)))
      errs.taxes_benefits_pct = 'Required numeric';
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function startEdit(emp: EmployeeRecord) {
    setEditId(emp.id);
    const bonus = resolveBonus(emp.base_salary, emp.bonus_pct, emp.bonus_amount);
    setForm({
      geography:          emp.geography,
      name:               emp.name,
      title:              emp.title,
      start_date:         emp.start_date,
      base_salary:        String(emp.base_salary),
      bonus_pct:          emp.bonus_pct != null ? String(emp.bonus_pct * 100) : String((bonus.pct * 100).toFixed(4)),
      bonus_amount:       emp.bonus_amount != null ? String(emp.bonus_amount) : String(bonus.amount.toFixed(2)),
      taxes_benefits_pct: String((emp.taxes_benefits_pct ?? 0) * 100),
      hike_cycle_pct:     emp.hike_cycle_pct != null ? String(emp.hike_cycle_pct * 100) : '',
      payroll_expenses:   emp.payroll_expenses != null ? String(emp.payroll_expenses) : '',
      tech_stipend:       emp.tech_stipend != null ? String(emp.tech_stipend) : '',
    });
    setFormErrors({});
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditId(null);
    setForm(EMPTY_FORM);
    setFormErrors({});
    setSubmitState('idle');
  }

  function submitAnother() {
    setEditId(null);
    setForm(EMPTY_FORM);
    setFormErrors({});
    setSubmitState('idle');
  }

  async function handleSubmit() {
    if (!validate()) return;
    setSaving(true);
    setError(null);
    const pctToDecimal = (s: string) => s ? parseFloat(s) / 100 : null;
    const payload = {
      department:          userDept,
      year,
      geography:           form.geography,
      name:                form.name.trim(),
      title:               form.title.trim(),
      start_date:          form.start_date || null,
      base_salary:         parseFloat(form.base_salary),
      bonus_pct:           form.bonus_pct   ? pctToDecimal(form.bonus_pct) : null,
      bonus_amount:        form.bonus_amount ? parseFloat(form.bonus_amount) : null,
      taxes_benefits_pct:  pctToDecimal(form.taxes_benefits_pct) ?? 0,
      hike_cycle_pct:      isConcer && form.hike_cycle_pct   ? pctToDecimal(form.hike_cycle_pct)   : null,
      payroll_expenses:    isConcer && form.payroll_expenses ? parseFloat(form.payroll_expenses) : null,
      tech_stipend:        isConcer && form.tech_stipend     ? parseFloat(form.tech_stipend)     : null,
    };
    try {
      if (editId != null) {
        const { data: updated } = await apiClient.put<EmployeeRecord>(`/portco/budget/employee-cost/${editId}`, payload);
        setRows(prev => prev.map(r => r.id === editId ? updated : r));
        setLastSubmittedId(editId);
        setSubmitState('updated');
      } else {
        const { data: created } = await apiClient.post<EmployeeRecord>('/portco/budget/employee-cost', payload);
        setRows(prev => [...prev, created]);
        setLastSubmittedId(created.id);
        setSubmitState('submitted');
      }
      setEditId(null);
      setForm(EMPTY_FORM);
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm('Delete this entry?')) return;
    try {
      await apiClient.delete(`/portco/budget/employee-cost/${id}`);
      setRows(prev => prev.filter(r => r.id !== id));
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? 'Delete failed');
    }
  }

  // ── admin: consolidated report ────────────────────────────────────────────
  if (isAdmin) {
    const report = buildReport(rows, year);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <PageHeader title="Employee Cost — Consolidated Report" badge="Admin View">
          <select
            value={filterDept}
            onChange={e => setFilterDept(e.target.value)}
            style={{
              padding: '4px 8px', borderRadius: 6, border: '1px solid #CBD5E1',
              fontSize: '0.75rem', background: '#fff', cursor: 'pointer',
            }}
          >
            <option value="">All Departments</option>
            {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <button
            onClick={loadData}
            disabled={loading}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', borderRadius: 6, cursor: loading ? 'default' : 'pointer',
              background: '#fff', border: '1px solid #CBD5E1',
              fontSize: '0.75rem', fontWeight: 600, color: '#475569',
            }}
          >
            <span className="material-icons-round" style={{ fontSize: 14 }}>refresh</span>
            Refresh
          </button>
        </PageHeader>
        <div style={{ flex: 1, overflowX: 'auto', overflowY: 'auto', padding: 16 }}>
          {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
              <CircularProgress size={32} />
            </div>
          ) : (
            <EmployeeCostReport report={report} />
          )}
        </div>
      </div>
    );
  }

  // ── user: confirmation screen ────────────────────────────────────────────
  if (submitState === 'submitted' || submitState === 'updated') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <PageHeader title="Employee Cost" badge="Budget Entry"><StepNav currentStep={3} /></PageHeader>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <div style={{
            background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12,
            padding: '48px 40px', maxWidth: 440, width: '100%', textAlign: 'center',
            boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%', background: '#DCFCE7',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 20px',
            }}>
              <span className="material-icons-round" style={{ fontSize: 30, color: '#16A34A' }}>check</span>
            </div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#111827', marginBottom: 8 }}>
              {submitState === 'updated' ? 'Changes Saved' : 'Submitted Successfully'}
            </div>
            <div style={{ fontSize: '0.85rem', color: '#6B7280', marginBottom: 32 }}>
              {submitState === 'updated'
                ? 'Your entry has been updated.'
                : 'Your employee cost entry has been recorded.'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Button
                variant="contained"
                onClick={() => {
                  const emp = rows.find(r => r.id === lastSubmittedId);
                  setSubmitState('idle');
                  if (emp) startEdit(emp);
                }}
                fullWidth
                sx={{ background: BRAND, '&:hover': { background: '#3D1F57' }, py: 1.1, fontWeight: 700 }}
              >
                Edit Response
              </Button>
            </div>

            {/* Next step nudge */}
            <div style={{
              marginTop: 24, paddingTop: 20,
              borderTop: '1px solid #E2E8F0',
            }}>
              <div style={{ fontSize: '0.75rem', color: '#94A3B8', marginBottom: 10, fontWeight: 500 }}>
                NEXT STEP
              </div>
              <button
                onClick={() => navigate('/portco/budget/other-cost')}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 14px', borderRadius: 10,
                  background: '#F8FAFC', border: '1.5px solid #E2E8F0',
                  cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = '#EDE9F7';
                  e.currentTarget.style.borderColor = '#C4B5D9';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = '#F8FAFC';
                  e.currentTarget.style.borderColor = '#E2E8F0';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%',
                    background: '#EDE9F7',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    <span className="material-icons-round" style={{ fontSize: 16, color: BRAND }}>receipt_long</span>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#1E293B' }}>
                      Step 4 — Other Cost
                    </div>
                    <div style={{ fontSize: '0.7rem', color: '#64748B', marginTop: 1 }}>
                      Add non-headcount budget items
                    </div>
                  </div>
                </div>
                <span className="material-icons-round" style={{ fontSize: 18, color: BRAND, flexShrink: 0 }}>
                  arrow_forward
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── user: loading state ──────────────────────────────────────────────────
  if (!hasLoaded) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <PageHeader title="Employee Cost — Add Entry" badge="Budget Entry"><StepNav currentStep={3} /></PageHeader>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <CircularProgress size={32} />
        </div>
      </div>
    );
  }

  // ── user: already submitted (read-only view) ─────────────────────────────
  if (hasLoaded && rows.length > 0 && editId === null) {
    const existing = rows[0];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <PageHeader title="Employee Cost" badge="Budget Entry"><StepNav currentStep={3} /></PageHeader>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <div style={{
            background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12,
            padding: '48px 40px', maxWidth: 440, width: '100%', textAlign: 'center',
            boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%', background: '#EDE9F7',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 20px',
            }}>
              <span className="material-icons-round" style={{ fontSize: 30, color: BRAND }}>info</span>
            </div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#111827', marginBottom: 8 }}>
              Already Submitted
            </div>
            <div style={{ fontSize: '0.85rem', color: '#6B7280', marginBottom: 4 }}>
              You have already submitted an entry for <strong>{existing.name}</strong>.
            </div>
            <div style={{ fontSize: '0.8rem', color: '#94A3B8', marginBottom: 32 }}>
              Only one response is allowed per user. You can edit your existing entry below.
            </div>

            <Button
              variant="contained"
              onClick={() => startEdit(existing)}
              fullWidth
              sx={{ background: BRAND, '&:hover': { background: '#3D1F57' }, py: 1.1, fontWeight: 700, mb: 3 }}
            >
              Edit Response
            </Button>

            {/* Next step nudge */}
            <div style={{ paddingTop: 20, borderTop: '1px solid #E2E8F0' }}>
              <div style={{ fontSize: '0.75rem', color: '#94A3B8', marginBottom: 10, fontWeight: 500 }}>
                NEXT STEP
              </div>
              <button
                onClick={() => navigate('/portco/budget/other-cost')}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 14px', borderRadius: 10,
                  background: '#F8FAFC', border: '1.5px solid #E2E8F0',
                  cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = '#EDE9F7';
                  e.currentTarget.style.borderColor = '#C4B5D9';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = '#F8FAFC';
                  e.currentTarget.style.borderColor = '#E2E8F0';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%', background: '#EDE9F7',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    <span className="material-icons-round" style={{ fontSize: 16, color: BRAND }}>receipt_long</span>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#1E293B' }}>Step 4 — Other Cost</div>
                    <div style={{ fontSize: '0.7rem', color: '#64748B', marginTop: 1 }}>Add non-headcount budget items</div>
                  </div>
                </div>
                <span className="material-icons-round" style={{ fontSize: 18, color: BRAND, flexShrink: 0 }}>arrow_forward</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── user: inline input form ───────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <PageHeader
        title={editId != null ? 'Employee Cost — Edit Entry' : 'Employee Cost — Add Entry'}
        badge="Budget Entry"
      ><StepNav currentStep={3} /></PageHeader>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

        {/* ── Inline form ─────────────────────────────────────────────────── */}
        <LocalizationProvider dateAdapter={AdapterDayjs}>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{
              background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12,
              padding: '32px 36px', marginBottom: 28,
              boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
              width: '100%', maxWidth: 480,
            }}>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: '#1E293B', marginBottom: 24, textAlign: 'center' }}>
                {editId != null ? 'Edit Employee Details' : 'Employee Details'}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

                {/* Geography */}
                <TextField
                  select label="Geography" size="small" required fullWidth
                  value={form.geography}
                  onChange={e => {
                    setField('geography', e.target.value);
                    if (e.target.value !== 'Concertiv') {
                      setField('hike_cycle_pct', '');
                      setField('payroll_expenses', '');
                      setField('tech_stipend', '');
                    }
                  }}
                  error={!!formErrors.geography} helperText={formErrors.geography}
                >
                  {GEOGRAPHIES.map(g => <MenuItem key={g} value={g}>{g}</MenuItem>)}
                </TextField>

                {/* Name */}
                <TextField
                  label="Employee Name" size="small" required fullWidth
                  value={form.name}
                  onChange={e => setField('name', e.target.value)}
                  error={!!formErrors.name} helperText={formErrors.name}
                />

                {/* Title */}
                <TextField
                  label="Title / Role" size="small" required fullWidth
                  value={form.title}
                  onChange={e => setField('title', e.target.value)}
                  error={!!formErrors.title} helperText={formErrors.title}
                />

                {/* Start Date */}
                <DatePicker
                  label="Start Date"
                  value={form.start_date ? dayjs(form.start_date) : null}
                  onChange={val => setField('start_date', val ? val.format('YYYY-MM-DD') : null)}
                  open={datePickerOpen}
                  onOpen={() => setDatePickerOpen(true)}
                  onClose={() => setDatePickerOpen(false)}
                  slotProps={{
                    textField: {
                      size: 'small', fullWidth: true,
                      onClick: () => setDatePickerOpen(true),
                      sx: { cursor: 'pointer' },
                    },
                  }}
                />

                {/* Base Salary */}
                <TextField
                  label="Base Salary ($)" size="small" required fullWidth
                  slotProps={{ htmlInput: { inputMode: 'numeric', pattern: '[0-9]*' } }}
                  value={form.base_salary}
                  onChange={e => {
                    setField('base_salary', e.target.value);
                    if (form.bonus_pct) {
                      const pct = parseFloat(form.bonus_pct) / 100;
                      setField('bonus_amount', String((parseFloat(e.target.value || '0') * pct).toFixed(2)));
                    }
                  }}
                  error={!!formErrors.base_salary} helperText={formErrors.base_salary}
                />

                {/* Bonus % */}
                <TextField
                  label="Bonus %" size="small" fullWidth
                  type="number" slotProps={{ htmlInput: { min: 0, max: 100, step: 0.1 } }}
                  value={form.bonus_pct}
                  onChange={e => handleBonusPctChange(e.target.value)}
                />

                {/* Bonus Amount */}
                <TextField
                  label="Bonus Amount ($)" size="small" fullWidth
                  type="number" slotProps={{ htmlInput: { min: 0 } }}
                  value={form.bonus_amount}
                  onChange={e => handleBonusAmtChange(e.target.value)}
                />

                {/* Taxes / Benefits % */}
                <TextField
                  label="Taxes / Benefits %" size="small" required fullWidth
                  type="number" slotProps={{ htmlInput: { min: 0, max: 100, step: 0.1 } }}
                  value={form.taxes_benefits_pct}
                  onChange={e => setField('taxes_benefits_pct', e.target.value)}
                  error={!!formErrors.taxes_benefits_pct}
                  helperText={formErrors.taxes_benefits_pct}
                />

                {/* Concertiv-only fields */}
                {isConcer && (
                  <>
                    <TextField
                      label="Hike Cycle %" size="small" fullWidth
                      type="number" slotProps={{ htmlInput: { min: 0, max: 100, step: 0.1 } }}
                      value={form.hike_cycle_pct}
                      onChange={e => setField('hike_cycle_pct', e.target.value)}
                    />
                    <TextField
                      label="Payroll Expenses ($/mo)" size="small" fullWidth
                      type="number" slotProps={{ htmlInput: { min: 0 } }}
                      value={form.payroll_expenses}
                      onChange={e => setField('payroll_expenses', e.target.value)}
                    />
                    <TextField
                      label="Tech Stipend ($/mo)" size="small" fullWidth
                      type="number" slotProps={{ htmlInput: { min: 0 } }}
                      value={form.tech_stipend}
                      onChange={e => setField('tech_stipend', e.target.value)}
                    />
                  </>
                )}

                {/* Action buttons */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
                  <Button
                    variant="contained"
                    onClick={handleSubmit}
                    disabled={saving}
                    fullWidth
                    sx={{ background: BRAND, '&:hover': { background: '#3D1F57' }, py: 1.2, fontWeight: 700 }}
                  >
                    {saving
                      ? <CircularProgress size={18} color="inherit" />
                      : editId != null ? 'Save Changes' : 'Submit'
                    }
                  </Button>
                  {editId != null && (
                    <Button variant="outlined" onClick={cancelEdit} disabled={saving} fullWidth>
                      Cancel
                    </Button>
                  )}
                </div>

              </div>
            </div>
          </div>
        </LocalizationProvider>

      </div>
    </div>
  );
}

// ── Admin Report ──────────────────────────────────────────────────────────────
function EmployeeCostReport({ report }: { report: ReturnType<typeof buildReport> }) {
  const { rows, totalStaffCosts, geoCounts, payrollExpensesLine, techStipendLine } = report;
  const hasPayroll = payrollExpensesLine.some(v => v > 0);
  const hasTech    = techStipendLine.some(v => v > 0);

  if (rows.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0', color: '#94A3B8' }}>
        <span className="material-icons-round" style={{ fontSize: 48, display: 'block', marginBottom: 8 }}>bar_chart</span>
        No employee cost data submitted yet.
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: '0.76rem', minWidth: 1000 }}>
        <thead>
          <tr>
            <th style={{ ...TH, minWidth: 90 }}>Department</th>
            <th style={{ ...TH, minWidth: 90 }}>Geography</th>
            <th style={{ ...TH, minWidth: 100 }}>Name</th>
            <th style={{ ...TH, minWidth: 120 }}>Title</th>
            <th style={{ ...TH, minWidth: 85 }}>Start Date</th>
            <th style={{ ...TH, textAlign: 'right' }}>Base</th>
            <th style={{ ...TH, textAlign: 'right' }}>Bonus%</th>
            <th style={{ ...TH, textAlign: 'right' }}>Bonus</th>
            <th style={{ ...TH, textAlign: 'right' }}>Tax/Ben</th>
            <th style={{ ...TH, textAlign: 'right', background: '#E0F2FE' }}>Total</th>
            <th style={{ ...TH, textAlign: 'right' }}>Hike%</th>
            {MONTH_LABELS.map(m => (
              <th key={m} style={{ ...TH, textAlign: 'right', minWidth: 72 }}>{m}</th>
            ))}
            <th style={{ ...TH, textAlign: 'right', minWidth: 90, background: '#DBEAFE' }}>Annual Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ emp, bonus, taxesAmt, total, months, annualTotal }) => (
            <tr key={emp.id}>
              <td style={TD}>{emp.department}</td>
              <td style={TD}>
                <span style={{
                  display: 'inline-block', padding: '1px 7px', borderRadius: 10,
                  fontSize: '0.7rem', fontWeight: 600,
                  background: emp.geography === 'Concertiv' ? '#EDE9F7' : '#E0F2FE',
                  color:      emp.geography === 'Concertiv' ? '#6D28D9' : '#0369A1',
                }}>{emp.geography}</span>
              </td>
              <td style={TD}>{emp.name}</td>
              <td style={TD}>{emp.title}</td>
              <td style={TD}>{emp.start_date ?? '—'}</td>
              <td style={TD_NUM}>{fmt(emp.base_salary)}</td>
              <td style={TD_NUM}>{fmtPct(bonus.pct)}</td>
              <td style={TD_NUM}>{fmt(bonus.amount)}</td>
              <td style={TD_NUM}>{fmt(taxesAmt)}</td>
              <td style={{ ...TD_NUM, fontWeight: 700 }}>{fmt(total)}</td>
              <td style={TD_NUM}>{emp.hike_cycle_pct != null ? fmtPct(emp.hike_cycle_pct) : '—'}</td>
              {months.map((v, i) => (
                <td key={i} style={v == null ? { ...TD, color: '#CBD5E1', textAlign: 'right' } : TD_NUM}>
                  {v == null ? '—' : fmt(v)}
                </td>
              ))}
              <td style={TD_TOTAL}>{fmt(annualTotal)}</td>
            </tr>
          ))}

          {/* Total Staff Costs */}
          <tr style={TR_SUM}>
            <td colSpan={11} style={{ ...TD, fontWeight: 700, color: '#166534' }}>Total Staff Costs</td>
            {totalStaffCosts.map((v, i) => (
              <td key={i} style={{ ...TD_NUM, fontWeight: 700, color: '#166534', background: '#F0FDF4' }}>
                {fmt(v)}
              </td>
            ))}
            <td style={{ ...TD_TOTAL, background: '#DCFCE7', color: '#166534' }}>
              {fmt(totalStaffCosts.reduce((s, v) => s + v, 0))}
            </td>
          </tr>

          {/* Spacer */}
          <tr><td colSpan={12 + 12 + 1} style={{ padding: 4 }} /></tr>

          {/* Employee counts per geography */}
          {geoCounts.map(({ geo, counts }) => (
            <tr key={geo}>
              <td colSpan={2} style={{ ...TD, fontWeight: 600, color: '#475569' }}>Employees ({geo})</td>
              <td colSpan={9} />
              {counts.map((c, i) => (
                <td key={i} style={{ ...TD_NUM, color: '#475569' }}>{c > 0 ? c : '—'}</td>
              ))}
              <td style={TD} />
            </tr>
          ))}

          {/* Payroll Expenses */}
          {hasPayroll && (
            <tr style={TR_COST}>
              <td colSpan={11} style={{ ...TD, fontWeight: 700, color: '#92400E' }}>Payroll Expenses (Concertiv)</td>
              {payrollExpensesLine.map((v, i) => (
                <td key={i} style={{ ...TD_NUM, color: '#92400E' }}>{v > 0 ? fmt(v) : '—'}</td>
              ))}
              <td style={{ ...TD_TOTAL, background: '#FEF3C7', color: '#92400E' }}>
                {fmt(payrollExpensesLine.reduce((s, v) => s + v, 0))}
              </td>
            </tr>
          )}

          {/* Tech Stipend */}
          {hasTech && (
            <tr style={TR_COST}>
              <td colSpan={11} style={{ ...TD, fontWeight: 700, color: '#92400E' }}>Tech Stipend (Concertiv)</td>
              {techStipendLine.map((v, i) => (
                <td key={i} style={{ ...TD_NUM, color: '#92400E' }}>{v > 0 ? fmt(v) : '—'}</td>
              ))}
              <td style={{ ...TD_TOTAL, background: '#FEF3C7', color: '#92400E' }}>
                {fmt(techStipendLine.reduce((s, v) => s + v, 0))}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Shared page header ────────────────────────────────────────────────────────
function PageHeader({
  title, badge, children,
}: {
  title: string;
  badge: string;
  children?: React.ReactNode;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '8px 20px', background: '#FAFBFC',
      borderBottom: '1px solid #E5E7EB', flexShrink: 0, flexWrap: 'wrap', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1E293B' }}>{title}</span>
        <span style={{
          fontSize: '0.68rem', fontWeight: 700, color: '#7C3AED',
          background: '#EDE9F7', borderRadius: 4, padding: '2px 8px',
        }}>{badge}</span>
      </div>
      {children && <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{children}</div>}
    </div>
  );
}
