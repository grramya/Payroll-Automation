import { useState, useEffect, useCallback, useRef } from 'react';
import type { CSSProperties } from 'react';
import {
  Alert, CircularProgress, IconButton, Tooltip,
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

const TH: CSSProperties = {
  padding: '7px 10px', background: '#F1F5F9', fontWeight: 700,
  fontSize: '0.72rem', whiteSpace: 'nowrap', borderBottom: '1px solid #E2E8F0',
  color: '#334155', position: 'sticky', top: 0, zIndex: 2,
};
const TD: CSSProperties = {
  padding: '8px 10px', fontSize: '0.82rem', borderBottom: '1px solid #F1F5F9',
  whiteSpace: 'nowrap',
};
const TD_NUM: CSSProperties = { ...TD, textAlign: 'right', fontFamily: 'monospace' };
const TD_TOTAL: CSSProperties = {
  ...TD_NUM, fontWeight: 700, background: '#EFF6FF', color: '#1D4ED8',
};
const TR_SUM: CSSProperties = { background: '#F0FDF4' };
const TR_COST: CSSProperties = { background: '#FEF9C3' };

const TH_DARK: CSSProperties = {
  padding: '9px 10px',
  background: '#1E293B',
  color: '#CBD5E1',
  fontWeight: 700,
  fontSize: '0.7rem',
  whiteSpace: 'nowrap',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  borderRight: '1px solid #334155',
};

const INPUT_STYLE: CSSProperties = {
  width: '100%',
  height: '34px',
  padding: '0 10px',
  fontSize: '0.85rem',
  border: '1px solid #E2E8F0',
  borderRadius: 4,
  outline: 'none',
  background: '#fff',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};

// Shared sx for DatePicker — forces exact match with native INPUT_STYLE
const DATE_PICKER_SX = {
  width: '100%',
  // Lock root to same height as native inputs (padding 4px + ~13px line-height + 4px + 2px border)
  '& .MuiInputBase-root': {
    height: '34px',
    minHeight: 'unset',
    fontSize: '0.85rem',
    fontFamily: 'inherit',
    background: '#fff',
    borderRadius: '4px',
    paddingRight: '2px',
    paddingLeft: 0,
    boxSizing: 'border-box',
  },
  // The date-section spans live inside this; zero out default MUI padding
  '& .MuiPickersOutlinedInput-input, & .MuiInputBase-input': {
    padding: '0 0 0 10px',
    fontSize: '0.85rem',
    fontFamily: 'inherit',
    height: '100%',
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
  },
  '& .MuiOutlinedInput-notchedOutline': {
    borderColor: '#E2E8F0',
    borderRadius: '4px',
  },
  // Remove the notch so border looks like a plain rectangle (no label gap)
  '& .MuiOutlinedInput-notchedOutline legend': { width: '0 !important', padding: 0 },
  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#CBD5E1' },
  '& .MuiInputLabel-root': { display: 'none' },
  '& .MuiInputAdornment-root': { height: 'auto', maxHeight: 'none', marginLeft: 0 },
  '& .MuiIconButton-root': { padding: '1px 3px' },
  '& .MuiSvgIcon-root': { fontSize: '0.9rem', color: '#94A3B8' },
} as const;

interface FormState {
  geography: string;
  name: string;
  title: string;
  start_date: string;
  base_salary: string;
  bonus_pct: string;
  bonus_amount: string;
  taxes_benefits_pct: string;
  hike_cycle_pct: string;
  payroll_expenses: string;
  tech_stipend: string;
}

const EMPTY_FORM: FormState = {
  geography: '', name: '', title: '', start_date: '',
  base_salary: '', bonus_pct: '', bonus_amount: '',
  taxes_benefits_pct: '', hike_cycle_pct: '', payroll_expenses: '', tech_stipend: '',
};

const LS_KEY_EMP = 'portco_employee_cost_draft';

function loadEmpDraft(): FormState {
  try { return { ...EMPTY_FORM, ...JSON.parse(localStorage.getItem(LS_KEY_EMP) || '{}') }; }
  catch { return EMPTY_FORM; }
}

interface Props {
  year: number;
  userDept: string | null;
  isAdmin: boolean;
}

export default function EmployeeCostPage({ year, userDept, isAdmin }: Props) {
  const [rows, setRows]               = useState<EmployeeRecord[]>([]);
  const [loading, setLoading]         = useState(true);
  const [hasLoaded, setHasLoaded]     = useState(false);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [editId, setEditId]           = useState<number | null>(null);
  const [editForm, setEditFormState]  = useState<FormState>(EMPTY_FORM);
  const [form, setForm]               = useState<FormState>(() => isAdmin ? EMPTY_FORM : loadEmpDraft());
  const [formErrors, setFormErrors]   = useState<Partial<Record<keyof FormState, string>>>({});
  const [filterDept, setFilterDept]       = useState('');
  const [datePickerOpenNew, setDatePickerOpenNew] = useState(false);
  const [datePickerOpenEdit, setDatePickerOpenEdit] = useState(false);
  const [dateErrorNew, setDateErrorNew] = useState(false);
  const [dateErrorEdit, setDateErrorEdit] = useState(false);

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
      setError(e?.response?.data?.detail ?? 'Failed to load data');
    } finally {
      setLoading(false);
      setHasLoaded(true);
    }
  }, [year, isAdmin, filterDept]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!isAdmin && editId === null) {
      localStorage.setItem(LS_KEY_EMP, JSON.stringify(form));
    }
  }, [form, editId, isAdmin]);

  const isConcer = form.geography === 'Concertiv';

  function setField(k: keyof FormState, v: string) {
    setForm(prev => ({ ...prev, [k]: v }));
    setFormErrors(prev => ({ ...prev, [k]: undefined }));
  }

  function setEditField(k: keyof FormState, v: string) {
    setEditFormState(prev => ({ ...prev, [k]: v }));
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
    if (dateErrorNew) errs.start_date = 'Invalid date';
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function startEdit(emp: EmployeeRecord) {
    setEditId(emp.id);
    const bonus = resolveBonus(emp.base_salary, emp.bonus_pct, emp.bonus_amount);
    setEditFormState({
      geography:          emp.geography,
      name:               emp.name,
      title:              emp.title,
      start_date:         emp.start_date ?? '',
      base_salary:        String(emp.base_salary),
      bonus_pct:          emp.bonus_pct != null ? String(emp.bonus_pct * 100) : String((bonus.pct * 100).toFixed(4)),
      bonus_amount:       emp.bonus_amount != null ? String(emp.bonus_amount) : String(bonus.amount.toFixed(2)),
      taxes_benefits_pct: String((emp.taxes_benefits_pct ?? 0) * 100),
      hike_cycle_pct:     emp.hike_cycle_pct != null ? String(emp.hike_cycle_pct * 100) : '',
      payroll_expenses:   emp.payroll_expenses != null ? String(emp.payroll_expenses) : '',
      tech_stipend:       emp.tech_stipend != null ? String(emp.tech_stipend) : '',
    });
  }

  function cancelEdit() {
    setEditId(null);
    setEditFormState(EMPTY_FORM);
  }

  function copyEmp(emp: EmployeeRecord) {
    const bonus = resolveBonus(emp.base_salary, emp.bonus_pct, emp.bonus_amount);
    setForm({
      geography:          emp.geography,
      name:               emp.name,
      title:              emp.title,
      start_date:         emp.start_date ?? '',
      base_salary:        String(emp.base_salary),
      bonus_pct:          emp.bonus_pct != null ? String(emp.bonus_pct * 100) : String((bonus.pct * 100).toFixed(4)),
      bonus_amount:       emp.bonus_amount != null ? String(emp.bonus_amount) : String(bonus.amount.toFixed(2)),
      taxes_benefits_pct: String((emp.taxes_benefits_pct ?? 0) * 100),
      hike_cycle_pct:     emp.hike_cycle_pct != null ? String(emp.hike_cycle_pct * 100) : '',
      payroll_expenses:   emp.payroll_expenses != null ? String(emp.payroll_expenses) : '',
      tech_stipend:       emp.tech_stipend != null ? String(emp.tech_stipend) : '',
    });
    setFormErrors({});
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
      const { data: created } = await apiClient.post<EmployeeRecord>('/portco/budget/employee-cost', payload);
      setRows(prev => [...prev, created]);
      setForm(EMPTY_FORM);
      setFormErrors({});
      localStorage.removeItem(LS_KEY_EMP);
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit() {
    const ef = editForm;
    const errs: Partial<Record<keyof FormState, string>> = {};
    if (!ef.geography) errs.geography = 'Required';
    if (!ef.name.trim()) errs.name = 'Required';
    if (!ef.title.trim()) errs.title = 'Required';
    if (!ef.base_salary || isNaN(Number(ef.base_salary))) errs.base_salary = 'Required';
    if (ef.taxes_benefits_pct === '' || isNaN(Number(ef.taxes_benefits_pct))) errs.taxes_benefits_pct = 'Required';
    if (dateErrorEdit) errs.start_date = 'Invalid date';
    if (Object.keys(errs).length > 0) { setFormErrors(errs); return; }

    setSaving(true);
    setError(null);
    const pctToDecimal = (s: string) => s ? parseFloat(s) / 100 : null;
    const isC = ef.geography === 'Concertiv';
    const payload = {
      department:          userDept,
      year,
      geography:           ef.geography,
      name:                ef.name.trim(),
      title:               ef.title.trim(),
      start_date:          ef.start_date || null,
      base_salary:         parseFloat(ef.base_salary),
      bonus_pct:           ef.bonus_pct   ? pctToDecimal(ef.bonus_pct) : null,
      bonus_amount:        ef.bonus_amount ? parseFloat(ef.bonus_amount) : null,
      taxes_benefits_pct:  pctToDecimal(ef.taxes_benefits_pct) ?? 0,
      hike_cycle_pct:      isC && ef.hike_cycle_pct   ? pctToDecimal(ef.hike_cycle_pct)   : null,
      payroll_expenses:    isC && ef.payroll_expenses ? parseFloat(ef.payroll_expenses) : null,
      tech_stipend:        isC && ef.tech_stipend     ? parseFloat(ef.tech_stipend)     : null,
    };
    try {
      const { data: updated } = await apiClient.put<EmployeeRecord>(`/portco/budget/employee-cost/${editId}`, payload);
      setRows(prev => prev.map(r => r.id === editId ? updated : r));
      setEditId(null);
      setEditFormState(EMPTY_FORM);
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
            <EmployeeCostReport report={report} onDelete={handleDelete} />
          )}
        </div>
      </div>
    );
  }

  // ── user: loading state ───────────────────────────────────────────────────
  if (!hasLoaded) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <PageHeader title="Employee Cost" badge="Budget Entry"><StepNav currentStep={3} /></PageHeader>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <CircularProgress size={32} />
        </div>
      </div>
    );
  }

  // ── user: inline row table ────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <PageHeader title="Employee Cost" badge="Budget Entry">
        <StepNav currentStep={3} />
      </PageHeader>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

        <LocalizationProvider dateAdapter={AdapterDayjs}>
        <div style={{ overflowX: 'auto', border: '1px solid #334155', borderRadius: 8, boxShadow: '0 1px 6px rgba(0,0,0,0.07)' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: '0.78rem', minWidth: 1100 }}>
            <thead>
              <tr>
                <th style={{ ...TH_DARK, width: 44, textAlign: 'center' }}>#</th>
                <th style={{ ...TH_DARK, minWidth: 130 }}>GEOGRAPHY</th>
                <th style={{ ...TH_DARK, minWidth: 170 }}>NAME</th>
                <th style={{ ...TH_DARK, minWidth: 170 }}>TITLE</th>
                <th style={{ ...TH_DARK, minWidth: 145 }}>START DATE</th>
                <th style={{ ...TH_DARK, textAlign: 'right', minWidth: 130 }}>BASE ($)</th>
                <th style={{ ...TH_DARK, textAlign: 'right', minWidth: 100 }}>BONUS %</th>
                <th style={{ ...TH_DARK, textAlign: 'right', minWidth: 120 }}>BONUS ($)</th>
                <th style={{ ...TH_DARK, textAlign: 'right', minWidth: 110 }}>TAX/BEN %</th>
                <th style={{ ...TH_DARK, textAlign: 'right', minWidth: 100 }}>HIKE %</th>
                <th style={{ ...TH_DARK, textAlign: 'right', minWidth: 120 }}>PAY. EXP</th>
                <th style={{ ...TH_DARK, textAlign: 'right', minWidth: 115 }}>TECH STIP</th>
                <th style={{ ...TH_DARK, width: 100, borderRight: 'none' }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((emp, idx) => {
                const isEditing = editId === emp.id;
                const bonus = resolveBonus(emp.base_salary, emp.bonus_pct, emp.bonus_amount);
                const isEditConcer = editForm.geography === 'Concertiv';

                return (
                  <tr
                    key={emp.id}
                    style={{
                      background: isEditing ? '#F5F3FF' : '#fff',
                      borderBottom: '1px solid #F1F5F9',
                    }}
                  >
                    <td style={{ ...TD, textAlign: 'center', color: '#94A3B8', fontWeight: 600 }}>
                      {idx + 1}
                    </td>

                    {isEditing ? (
                      <>
                        <td style={TD}>
                          <select value={editForm.geography} onChange={e => setEditField('geography', e.target.value)} style={INPUT_STYLE}>
                            <option value="">Select...</option>
                            {GEOGRAPHIES.map(g => <option key={g} value={g}>{g}</option>)}
                          </select>
                        </td>
                        <td style={TD}><input value={editForm.name} onChange={e => setEditField('name', e.target.value)} style={INPUT_STYLE} /></td>
                        <td style={TD}><input value={editForm.title} onChange={e => setEditField('title', e.target.value)} style={INPUT_STYLE} /></td>
                        <td style={TD}>
                          <DatePicker
                            value={editForm.start_date ? dayjs(editForm.start_date) : null}
                            onChange={val => setEditField('start_date', val?.isValid() ? val.format('YYYY-MM-DD') : '')}
                            onError={(e) => setDateErrorEdit(!!e)}
                            open={datePickerOpenEdit}
                            onOpen={() => setDatePickerOpenEdit(true)}
                            onClose={() => setDatePickerOpenEdit(false)}
                            slotProps={{
                              textField: {
                                size: 'small',
                                onClick: () => setDatePickerOpenEdit(true),
                                sx: DATE_PICKER_SX,
                                error: dateErrorEdit,
                                helperText: dateErrorEdit ? "Invalid date" : undefined,
                              },
                            }}
                          />
                        </td>
                        <td style={TD}><input type="number" value={editForm.base_salary} onChange={e => setEditField('base_salary', e.target.value)} style={{ ...INPUT_STYLE, textAlign: 'right' }} /></td>
                        <td style={TD}><input type="number" value={editForm.bonus_pct} onChange={e => setEditField('bonus_pct', e.target.value)} style={{ ...INPUT_STYLE, textAlign: 'right' }} /></td>
                        <td style={TD}><input type="number" value={editForm.bonus_amount} onChange={e => setEditField('bonus_amount', e.target.value)} style={{ ...INPUT_STYLE, textAlign: 'right' }} /></td>
                        <td style={TD}><input type="number" value={editForm.taxes_benefits_pct} onChange={e => setEditField('taxes_benefits_pct', e.target.value)} style={{ ...INPUT_STYLE, textAlign: 'right' }} /></td>
                        <td style={TD}>{isEditConcer ? <input type="number" value={editForm.hike_cycle_pct} onChange={e => setEditField('hike_cycle_pct', e.target.value)} style={{ ...INPUT_STYLE, textAlign: 'right' }} /> : <span style={{ color: '#CBD5E1' }}>—</span>}</td>
                        <td style={TD}>{isEditConcer ? <input type="number" value={editForm.payroll_expenses} onChange={e => setEditField('payroll_expenses', e.target.value)} style={{ ...INPUT_STYLE, textAlign: 'right' }} /> : <span style={{ color: '#CBD5E1' }}>—</span>}</td>
                        <td style={TD}>{isEditConcer ? <input type="number" value={editForm.tech_stipend} onChange={e => setEditField('tech_stipend', e.target.value)} style={{ ...INPUT_STYLE, textAlign: 'right' }} /> : <span style={{ color: '#CBD5E1' }}>—</span>}</td>
                        <td style={{ ...TD, textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
                            <button
                              onClick={saveEdit}
                              disabled={saving}
                              style={{
                                padding: '3px 10px', fontSize: '0.72rem', fontWeight: 700,
                                background: BRAND, color: '#fff', border: 'none',
                                borderRadius: 4, cursor: saving ? 'default' : 'pointer',
                                opacity: saving ? 0.6 : 1,
                              }}
                            >
                              {saving ? '...' : 'Save'}
                            </button>
                            <button
                              onClick={cancelEdit}
                              style={{
                                padding: '3px 8px', fontSize: '0.72rem', fontWeight: 700,
                                background: '#F1F5F9', color: '#64748B', border: 'none',
                                borderRadius: 4, cursor: 'pointer',
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={TD}>
                          <span style={{
                            display: 'inline-block', padding: '2px 8px', borderRadius: 10,
                            fontSize: '0.7rem', fontWeight: 600,
                            background: emp.geography === 'Concertiv' ? '#EDE9F7' : '#E0F2FE',
                            color:      emp.geography === 'Concertiv' ? '#6D28D9' : '#0369A1',
                          }}>
                            {emp.geography}
                          </span>
                        </td>
                        <td style={TD}>{emp.name}</td>
                        <td style={TD}>{emp.title}</td>
                        <td style={TD}>{emp.start_date ?? '—'}</td>
                        <td style={TD_NUM}>{fmt(emp.base_salary)}</td>
                        <td style={TD_NUM}>{fmtPct(bonus.pct)}</td>
                        <td style={TD_NUM}>{fmt(bonus.amount)}</td>
                        <td style={TD_NUM}>{fmtPct(emp.taxes_benefits_pct ?? 0)}</td>
                        <td style={TD_NUM}>{emp.hike_cycle_pct != null ? fmtPct(emp.hike_cycle_pct) : <span style={{ color: '#CBD5E1' }}>—</span>}</td>
                        <td style={TD_NUM}>{emp.payroll_expenses != null ? fmt(emp.payroll_expenses) : <span style={{ color: '#CBD5E1' }}>—</span>}</td>
                        <td style={TD_NUM}>{emp.tech_stipend != null ? fmt(emp.tech_stipend) : <span style={{ color: '#CBD5E1' }}>—</span>}</td>
                        <td style={{ ...TD, textAlign: 'right' }}>
                          <Tooltip title="Edit">
                            <IconButton size="small" onClick={() => startEdit(emp)}>
                              <span className="material-icons-round" style={{ fontSize: 15, color: '#6366F1' }}>edit</span>
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Copy to new row">
                            <IconButton size="small" onClick={() => copyEmp(emp)}>
                              <span className="material-icons-round" style={{ fontSize: 15, color: '#64748B' }}>content_copy</span>
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Delete">
                            <IconButton size="small" onClick={() => handleDelete(emp.id)}>
                              <span className="material-icons-round" style={{ fontSize: 15, color: '#EF4444' }}>delete</span>
                            </IconButton>
                          </Tooltip>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}

              {/* New entry row */}
              <tr style={{ background: '#FAFBFC', borderBottom: '1px solid #F1F5F9' }}>
                <td style={{ ...TD, textAlign: 'center', color: '#CBD5E1', fontWeight: 600 }}>
                  {rows.length + 1}
                </td>
                <td style={TD}>
                  <select
                    value={form.geography}
                    onChange={e => {
                      setField('geography', e.target.value);
                      if (e.target.value !== 'Concertiv') {
                        setField('hike_cycle_pct', '');
                        setField('payroll_expenses', '');
                        setField('tech_stipend', '');
                      }
                    }}
                    style={{ ...INPUT_STYLE, borderColor: formErrors.geography ? '#EF4444' : '#E2E8F0' }}
                  >
                    <option value="">Select...</option>
                    {GEOGRAPHIES.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </td>
                <td style={TD}>
                  <input
                    value={form.name}
                    onChange={e => setField('name', e.target.value)}
                    placeholder="Employee name"
                    style={{ ...INPUT_STYLE, borderColor: formErrors.name ? '#EF4444' : '#E2E8F0' }}
                  />
                </td>
                <td style={TD}>
                  <input
                    value={form.title}
                    onChange={e => setField('title', e.target.value)}
                    placeholder="Title / Role"
                    style={{ ...INPUT_STYLE, borderColor: formErrors.title ? '#EF4444' : '#E2E8F0' }}
                  />
                </td>
                <td style={TD}>
                  <DatePicker
                    value={form.start_date ? dayjs(form.start_date) : null}
                    onChange={val => setField('start_date', val?.isValid() ? val.format('YYYY-MM-DD') : '')}
                    onError={(e) => setDateErrorNew(!!e)}
                    open={datePickerOpenNew}
                    onOpen={() => setDatePickerOpenNew(true)}
                    onClose={() => setDatePickerOpenNew(false)}
                    slotProps={{
                      textField: {
                        size: 'small',
                        onClick: () => setDatePickerOpenNew(true),
                        sx: DATE_PICKER_SX,
                        error: dateErrorNew,
                        helperText: dateErrorNew ? "Invalid date" : undefined,
                      },
                    }}
                  />
                </td>
                <td style={TD}>
                  <input
                    type="number"
                    value={form.base_salary}
                    onChange={e => {
                      setField('base_salary', e.target.value);
                      if (form.bonus_pct) {
                        const pct = parseFloat(form.bonus_pct) / 100;
                        setField('bonus_amount', String((parseFloat(e.target.value || '0') * pct).toFixed(2)));
                      }
                    }}
                    placeholder="0"
                    style={{ ...INPUT_STYLE, textAlign: 'right', borderColor: formErrors.base_salary ? '#EF4444' : '#E2E8F0' }}
                  />
                </td>
                <td style={TD}>
                  <input
                    type="number"
                    value={form.bonus_pct}
                    onChange={e => handleBonusPctChange(e.target.value)}
                    placeholder="0"
                    style={{ ...INPUT_STYLE, textAlign: 'right' }}
                  />
                </td>
                <td style={TD}>
                  <input
                    type="number"
                    value={form.bonus_amount}
                    onChange={e => handleBonusAmtChange(e.target.value)}
                    placeholder="0"
                    style={{ ...INPUT_STYLE, textAlign: 'right' }}
                  />
                </td>
                <td style={TD}>
                  <input
                    type="number"
                    value={form.taxes_benefits_pct}
                    onChange={e => setField('taxes_benefits_pct', e.target.value)}
                    placeholder="0"
                    style={{ ...INPUT_STYLE, textAlign: 'right', borderColor: formErrors.taxes_benefits_pct ? '#EF4444' : '#E2E8F0' }}
                  />
                </td>
                <td style={TD}>
                  {isConcer ? (
                    <input
                      type="number"
                      value={form.hike_cycle_pct}
                      onChange={e => setField('hike_cycle_pct', e.target.value)}
                      placeholder="0"
                      style={{ ...INPUT_STYLE, textAlign: 'right' }}
                    />
                  ) : (
                    <span style={{ color: '#CBD5E1', fontSize: '0.75rem', paddingLeft: 7 }}>—</span>
                  )}
                </td>
                <td style={TD}>
                  {isConcer ? (
                    <input
                      type="number"
                      value={form.payroll_expenses}
                      onChange={e => setField('payroll_expenses', e.target.value)}
                      placeholder="0"
                      style={{ ...INPUT_STYLE, textAlign: 'right' }}
                    />
                  ) : (
                    <span style={{ color: '#CBD5E1', fontSize: '0.75rem', paddingLeft: 7 }}>—</span>
                  )}
                </td>
                <td style={TD}>
                  {isConcer ? (
                    <input
                      type="number"
                      value={form.tech_stipend}
                      onChange={e => setField('tech_stipend', e.target.value)}
                      placeholder="0"
                      style={{ ...INPUT_STYLE, textAlign: 'right' }}
                    />
                  ) : (
                    <span style={{ color: '#CBD5E1', fontSize: '0.75rem', paddingLeft: 7 }}>—</span>
                  )}
                </td>
                <td style={{ ...TD, textAlign: 'right' }}>
                  <Tooltip title="Add row">
                    <IconButton size="small" onClick={handleSubmit} disabled={saving}>
                      <span className="material-icons-round" style={{ fontSize: 20, color: saving ? '#CBD5E1' : BRAND }}>
                        add_circle
                      </span>
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Clear">
                    <IconButton
                      size="small"
                      onClick={() => { setForm(EMPTY_FORM); setFormErrors({}); }}
                      disabled={saving}
                    >
                      <span className="material-icons-round" style={{ fontSize: 15, color: '#CBD5E1' }}>clear</span>
                    </IconButton>
                  </Tooltip>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {rows.length > 0 && (
          <div style={{ marginTop: 10, fontSize: '0.75rem', color: '#94A3B8', textAlign: 'right' }}>
            {rows.length} {rows.length === 1 ? 'employee' : 'employees'} · Total annual:{' '}
            <strong style={{ color: '#1D4ED8' }}>
              {fmt(rows.reduce((s, emp) => s + computeTotal(emp), 0))}
            </strong>
          </div>
        )}
        </LocalizationProvider>
      </div>
    </div>
  );
}

// ── Admin Report ──────────────────────────────────────────────────────────────
function EmployeeCostReport({ report, onDelete }: { report: ReturnType<typeof buildReport>; onDelete?: (id: number) => void }) {
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
            {onDelete && <th style={{ ...TH, minWidth: 60 }} />}
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
              {onDelete && (
                <td style={TD}>
                  <Tooltip title="Delete">
                    <IconButton size="small" onClick={() => onDelete(emp.id)}>
                      <span className="material-icons-round" style={{ fontSize: 15, color: '#EF4444' }}>delete</span>
                    </IconButton>
                  </Tooltip>
                </td>
              )}
            </tr>
          ))}

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

          <tr><td colSpan={12 + 12 + 1} style={{ padding: 4 }} /></tr>

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
